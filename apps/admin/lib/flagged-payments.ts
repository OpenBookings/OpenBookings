import {
  ADMIN_ACTOR,
  outsideRefundKey,
  validateSplit,
  type OutsideSplit,
  type Queryable,
  type SplitError,
} from "@openbookings/db";
import { parseEuroInput } from "@openbookings/pricing/money";
import { PAYMENT_FLAG_ACTIONS } from "@openbookings/stripe";
import { bookingReference } from "@openbookings/db/booking-reference";
import { UUID_RE } from "./search";

/**
 * Payments flagged for staff to ask the host about: a refund the host made in
 * their own Stripe Dashboard, or a dispute the host lost. OpenBookings cannot
 * tell what that money was for (room price or tourist tax), so the host is
 * asked to explain. A Dashboard refund returned no commission (it is outside
 * OpenBookings; any goodwill return is made by hand); a lost dispute returned
 * it in proportion to the whole payment. The
 * business app's Stripe webhook writes these rows into `audit_log`.
 *
 * Resolving one adds a `payment.flag-resolved` row with the same dedupe key:
 * the audit log is append-only, so nothing is updated there.
 *
 * The webhook also writes the money onto the booking it paid, as a `refunds`
 * row (0053), with the whole amount counted as room price until the host
 * explains. Staff can enter the host's split when they resolve the flag.
 */
export const FLAG_ACTIONS: string[] = Object.values(PAYMENT_FLAG_ACTIONS);
export const FLAG_RESOLVED_ACTION = "payment.flag-resolved";

export type FlagKind = "refund-outside" | "dispute-lost";

export type FlaggedPayment = {
  id: string;
  kind: FlagKind;
  createdAt: Date;
  organizationId: string | null;
  organizationName: string | null;
  /** The organisation's owners, to email for an explanation. */
  ownerEmails: string[];
  /** The booking paid by this payment, when one was found. */
  bookingId: string | null;
  amountCents: number | null;
  stripeAccountId: string | null;
  chargeId: string | null;
  paymentIntentId: string | null;
  /** The refund or dispute id. */
  objectId: string | null;
  /** Stripe's refund or dispute reason, if any. */
  reason: string | null;
  resolvedAt: Date | null;
  resolvedNote: string | null;
  /**
   * The row on the booking for this money, when it was written (a payment
   * that paid no booking has none). `amountCents` may be less than the
   * flag's: a dispute takes only what was still on the booking.
   */
  record: { amountCents: number; split: { roomPriceCents: number; touristTaxCents: number } | null } | null;
};

/** The booking record's source for a flag action. */
const SOURCE = {
  [PAYMENT_FLAG_ACTIONS.refundOutside]: "stripe_dashboard",
  [PAYMENT_FLAG_ACTIONS.disputeLost]: "dispute",
} as const;

/** The booking reference guests and hosts see. */
export const bookingRef = bookingReference;

type Row = {
  id: string;
  action: string;
  created_at: Date;
  organization_id: string | null;
  organization_name: string | null;
  owner_emails: string[] | null;
  booking_id: string | null;
  detail: Record<string, unknown> | null;
  resolved_at: Date | null;
  resolved_note: string | null;
  record_cents: string | null;
  record_room_cents: string | null;
  record_tax_cents: string | null;
  record_explained: boolean | null;
};

const text = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Newest first. */
export async function loadFlaggedPayments(db: Queryable, limit = 200): Promise<FlaggedPayment[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.created_at, a.organization_id, a.detail,
            o.name AS organization_name,
            (SELECT array_agg(u.email ORDER BY u.email)
               FROM "member" m JOIN "user" u ON u.id = m."userId"
              WHERE m."organizationId" = a.organization_id AND m.role = 'owner') AS owner_emails,
            b.id AS booking_id,
            r.created_at AS resolved_at, r.reason AS resolved_note,
            rf.amount_cents AS record_cents,
            rf.accommodation_cents AS record_room_cents,
            rf.tourist_tax_cents AS record_tax_cents,
            rf.split_explained_at IS NOT NULL AS record_explained
       FROM audit_log a
       LEFT JOIN "organization" o ON o.id = a.organization_id
       LEFT JOIN LATERAL (
         SELECT id FROM bookings
          WHERE stripe_payment_intent_id = a.detail->>'paymentIntentId'
          ORDER BY created_at LIMIT 1
       ) b ON true
       LEFT JOIN LATERAL (
         SELECT created_at, reason FROM audit_log
          WHERE action = $2 AND detail->>'dedupeKey' = a.detail->>'dedupeKey'
          ORDER BY created_at LIMIT 1
       ) r ON true
       LEFT JOIN refunds rf ON rf.idempotency_key =
         (CASE a.action WHEN $4 THEN 'stripe_dashboard:' ELSE 'dispute:' END) || (a.detail->>'dedupeKey')
      WHERE a.action = ANY($1::text[])
      ORDER BY a.created_at DESC
      LIMIT $3`,
    [FLAG_ACTIONS, FLAG_RESOLVED_ACTION, limit, PAYMENT_FLAG_ACTIONS.refundOutside],
  );
  return (rows as Row[]).map((row) => {
    const d = row.detail ?? {};
    const dispute = row.action === PAYMENT_FLAG_ACTIONS.disputeLost;
    return {
      id: row.id,
      kind: dispute ? "dispute-lost" : "refund-outside",
      createdAt: row.created_at,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      ownerEmails: row.owner_emails ?? [],
      bookingId: row.booking_id,
      amountCents: typeof d.amount === "number" ? d.amount : null,
      stripeAccountId: text(d.stripeAccountId),
      chargeId: text(d.chargeId),
      paymentIntentId: text(d.paymentIntentId),
      objectId: text(dispute ? d.disputeId : d.refundId),
      reason: text(d.reason),
      resolvedAt: row.resolved_at,
      resolvedNote: row.resolved_note,
      record:
        row.record_cents === null
          ? null
          : {
              amountCents: Number(row.record_cents),
              split: row.record_explained
                ? { roomPriceCents: Number(row.record_room_cents), touristTaxCents: Number(row.record_tax_cents) }
                : null,
            },
    };
  });
}

export type ResolveResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "not_found" | "already_resolved" | "no_booking_record" | "split_not_an_amount" | SplitError };

/** The resolve form as staff fill it in: euros as typed, both empty for no split. */
export type ResolveInput = { flagId: string; note?: string; roomPrice?: string; touristTax?: string };

/** `resolvePaymentFlag`, from the form: a split only when either amount was typed; an empty one is €0. */
export function resolvePaymentFlagFromForm(db: Queryable, i: ResolveInput): Promise<ResolveResult> {
  const room = i.roomPrice?.trim() ?? "";
  const tax = i.touristTax?.trim() ?? "";
  if (room === "" && tax === "") return resolvePaymentFlag(db, { flagId: i.flagId, note: i.note });
  const roomPrice = room === "" ? { ok: true as const, cents: 0 } : parseEuroInput(room);
  const touristTax = tax === "" ? { ok: true as const, cents: 0 } : parseEuroInput(tax);
  if (!roomPrice.ok || !touristTax.ok) return Promise.resolve({ ok: false, error: "split_not_an_amount" });
  const roomPriceCents = roomPrice.cents;
  const touristTaxCents = touristTax.cents;
  return resolvePaymentFlag(db, { flagId: i.flagId, note: i.note, split: { roomPriceCents, touristTaxCents } });
}

/**
 * Marks a flag as dealt with (the host explained it), with an optional note,
 * and optionally the host's split of the money into room price and tourist
 * tax, which must add up to what was recorded on the booking.
 *
 * Writes one `payment.flag-resolved` row, tied to the same organisation and
 * keyed by the flag's own dedupe key; a second resolve writes nothing. The
 * split goes onto the booking's row in the same statement, so a flag is
 * never resolved with its split half-written.
 */
export async function resolvePaymentFlag(
  db: Queryable,
  i: { flagId: string; note?: string; split?: OutsideSplit },
): Promise<ResolveResult> {
  if (typeof i.flagId !== "string" || !UUID_RE.test(i.flagId)) return { ok: false, error: "invalid" };
  const note = i.note?.trim() || null;

  let record: { id: string } | null = null;
  if (i.split) {
    const { rows: flags } = await db.query(
      `SELECT action, detail->>'dedupeKey' AS dedupe_key FROM audit_log WHERE id = $1::uuid AND action = ANY($2::text[])`,
      [i.flagId, FLAG_ACTIONS],
    );
    const flag = flags[0] as { action: keyof typeof SOURCE; dedupe_key: string | null } | undefined;
    if (!flag) return { ok: false, error: "not_found" };
    const { rows: found } = flag.dedupe_key
      ? await db.query(
          `SELECT id, amount_cents AS cents FROM refunds WHERE idempotency_key = $1 AND source <> 'openbookings'`,
          [outsideRefundKey(SOURCE[flag.action], flag.dedupe_key)],
        )
      : { rows: [] };
    const row = found[0] as { id: string; cents: string } | undefined;
    if (!row) return { ok: false, error: "no_booking_record" };
    const valid = validateSplit(Number(row.cents), i.split);
    if (!valid.ok) return valid;
    record = { id: row.id };
  }

  const { rows } = await db.query(
    `WITH flag AS (
       SELECT id, action, organization_id, detail->>'dedupeKey' AS dedupe_key
         FROM audit_log WHERE id = $1::uuid AND action = ANY($2::text[])
     ), inserted AS (
       INSERT INTO audit_log (action, actor_user_id, organization_id, reason, detail)
       SELECT $3, $4, f.organization_id, $5,
              jsonb_build_object('dedupeKey', f.dedupe_key, 'flagId', f.id, 'flagAction', f.action)
                || CASE WHEN $6::uuid IS NULL THEN '{}'::jsonb
                        ELSE jsonb_build_object('roomPriceCents', $7::bigint, 'touristTaxCents', $8::bigint) END
         FROM flag f
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_log WHERE action = $3 AND detail->>'dedupeKey' = f.dedupe_key
        )
       RETURNING id
     ), explained AS (
       UPDATE refunds
          SET accommodation_cents = $7::bigint, tourist_tax_cents = $8::bigint,
              split_explained_at = NOW(), split_explained_by = $4
        WHERE id = $6::uuid AND EXISTS (SELECT 1 FROM inserted)
          AND amount_cents = $7::bigint + $8::bigint
       RETURNING id, booking_id
     ), event AS (
       INSERT INTO booking_events (booking_id, kind, actor_kind, actor_id, reason, data, created_at)
       SELECT e.booking_id, 'outside_refund_explained', $9, $4, $5,
              jsonb_build_object('refundId', e.id, 'roomPriceCents', $7::bigint, 'touristTaxCents', $8::bigint),
              clock_timestamp()
         FROM explained e
       RETURNING id
     )
     SELECT (SELECT count(*)::int FROM flag) AS found, (SELECT count(*)::int FROM inserted) AS written,
            (SELECT count(*)::int FROM event) AS events`,
    [
      i.flagId,
      FLAG_ACTIONS,
      FLAG_RESOLVED_ACTION,
      ADMIN_ACTOR.id,
      note,
      record?.id ?? null,
      i.split?.roomPriceCents ?? null,
      i.split?.touristTaxCents ?? null,
      ADMIN_ACTOR.kind,
    ],
  );
  const { found, written } = rows[0] as { found: number; written: number };
  if (found === 0) return { ok: false, error: "not_found" };
  return written === 0 ? { ok: false, error: "already_resolved" } : { ok: true };
}

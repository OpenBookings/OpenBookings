import { ADMIN_ACTOR, type Queryable } from "@openbookings/db";
import { PAYMENT_FLAG_ACTIONS } from "@openbookings/stripe";
import { UUID_RE } from "./search";

/**
 * Payments flagged for staff to ask the host about: a refund the host made in
 * their own Stripe Dashboard, or a dispute the host lost. OpenBookings cannot
 * tell what that money was for (room price or tourist tax), so the commission
 * went back on the whole payment and the host is asked to explain. The
 * business app's Stripe webhook writes these rows into `audit_log`.
 *
 * Resolving one adds a `payment.flag-resolved` row with the same dedupe key:
 * the audit log is append-only, so nothing is updated.
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
};

/** The booking reference guests and hosts see. */
export const bookingRef = (bookingId: string) => bookingId.slice(0, 8).toUpperCase();

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
            r.created_at AS resolved_at, r.reason AS resolved_note
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
      WHERE a.action = ANY($1::text[])
      ORDER BY a.created_at DESC
      LIMIT $3`,
    [FLAG_ACTIONS, FLAG_RESOLVED_ACTION, limit],
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
    };
  });
}

export type ResolveResult = { ok: true } | { ok: false; error: "invalid" | "not_found" | "already_resolved" };

/**
 * Marks a flag as dealt with (the host explained it), with an optional note.
 * Writes one `payment.flag-resolved` row, tied to the same organisation and
 * keyed by the flag's own dedupe key; a second resolve writes nothing.
 */
export async function resolvePaymentFlag(db: Queryable, i: { flagId: string; note?: string }): Promise<ResolveResult> {
  if (typeof i.flagId !== "string" || !UUID_RE.test(i.flagId)) return { ok: false, error: "invalid" };
  const note = i.note?.trim() || null;
  const { rows } = await db.query(
    `WITH flag AS (
       SELECT id, action, organization_id, detail->>'dedupeKey' AS dedupe_key
         FROM audit_log WHERE id = $1::uuid AND action = ANY($2::text[])
     ), inserted AS (
       INSERT INTO audit_log (action, actor_user_id, organization_id, reason, detail)
       SELECT $3, $4, f.organization_id, $5,
              jsonb_build_object('dedupeKey', f.dedupe_key, 'flagId', f.id, 'flagAction', f.action)
         FROM flag f
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_log WHERE action = $3 AND detail->>'dedupeKey' = f.dedupe_key
        )
       RETURNING id
     )
     SELECT (SELECT count(*)::int FROM flag) AS found, (SELECT count(*)::int FROM inserted) AS written`,
    [i.flagId, FLAG_ACTIONS, FLAG_RESOLVED_ACTION, ADMIN_ACTOR.id, note],
  );
  const { found, written } = rows[0] as { found: number; written: number };
  if (found === 0) return { ok: false, error: "not_found" };
  return written === 0 ? { ok: false, error: "already_resolved" } : { ok: true };
}

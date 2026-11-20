/**
 * Money that left a booking outside OpenBookings (0053): a refund the host made
 * in their own Stripe Dashboard (or on their own keys), or a dispute they lost.
 *
 * Each is a `refunds` row with `source` 'stripe_dashboard' or 'dispute',
 * written `succeeded` (Stripe already moved it) and keyed by its Stripe id, so
 * a redelivered webhook writes nothing new. Because it is a refund row,
 * everything that adds up a booking's refunds counts it: what is left for
 * OpenBookings' own refunds (`loadBookingState`), the host's reservation page,
 * the DAC7 consideration.
 *
 * OpenBookings cannot tell how much of it was room price and how much tourist
 * tax until the host explains. Until then the whole amount sits in
 * `accommodation_amount` (tourist tax 0) and `split_explained_at` is NULL:
 * revenue and consideration go down by all of it, the tourist tax owed stays
 * as booked, and pages say the split is not explained yet. Staff enter the
 * host's split when they resolve the flag (`explainOutsideRefund`).
 */
import type { Queryable } from "./reservation-policy";
import { recordBookingEvent } from "./booking-events";

export type OutsideSource = "stripe_dashboard" | "dispute";

/** The row's idempotency key: one row per Stripe refund or dispute. */
export function outsideRefundKey(source: OutsideSource, stripeId: string): string {
  return `${source}:${stripeId}`;
}

export type OutsideRefundInput = {
  source: OutsideSource;
  /** The Stripe refund (`re_…`) or dispute (`dp_…`) id. */
  stripeId: string;
  /** The guest's payment: the booking is the one paid by it. */
  paymentIntentId: string | null;
  chargeId: string | null;
  stripeAccountId: string;
  /** What left the charge, cents. */
  amountCents: number;
  /** When Stripe made the refund, or the dispute was lost. */
  occurredAt: Date;
  /** Stripe's refund or dispute reason, kept for the record. */
  reason?: string | null;
};

export type OutsideRefundRecorded =
  | { recorded: true; bookingId: string; refundId: string; amountCents: number }
  /**
   * `no_booking`: the payment paid no booking (or none is known), so only the flag stays.
   * `duplicate`: already recorded (a redelivered webhook).
   * `nothing_left`: everything on the booking was already refunded.
   */
  | { recorded: false; why: "no_booking" | "duplicate" | "nothing_left" | "invalid" };

/**
 * What the guest paid on a booking, cents: its nights (price and tourist tax),
 * else `total_cents`, else whole-euro `total_amount`. `b` is the bookings alias.
 */
const PAID_CENTS_SQL = `COALESCE(
  NULLIF((SELECT SUM(round((n->>'price')::numeric * 100) + round(COALESCE(n->>'touristTax', '0')::numeric * 100))
            FROM reservations r CROSS JOIN LATERAL jsonb_array_elements(r.nights) n
           WHERE r.booking_id = b.id), 0),
  NULLIF(b.total_cents, 0),
  b.total_amount * 100
)::bigint`;

/**
 * Write one outside refund or lost dispute onto the booking its payment paid.
 * Safe to repeat. The amount is capped at what is still on the booking (paid,
 * less refunds that went through): a dispute can only take what was left.
 */
export async function recordOutsideRefund(db: Queryable, i: OutsideRefundInput): Promise<OutsideRefundRecorded> {
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0 || !i.stripeId) return { recorded: false, why: "invalid" };
  if (!i.paymentIntentId) return { recorded: false, why: "no_booking" };

  const key = outsideRefundKey(i.source, i.stripeId);
  const { rows } = await db.query(
    `WITH target AS (
       SELECT id FROM bookings WHERE stripe_payment_intent_id = $1 ORDER BY created_at, id LIMIT 1 FOR UPDATE
     ), room AS (
       SELECT b.id,
              GREATEST(0, ${PAID_CENTS_SQL}
                - COALESCE((SELECT round(SUM(rf.amount) * 100) FROM refunds rf
                             WHERE rf.booking_id = b.id AND rf.status = 'succeeded'), 0))::bigint AS left_cents
         FROM target t JOIN bookings b ON b.id = t.id
     ), inserted AS (
       INSERT INTO refunds
         (booking_id, reservation_id, reason, source, accommodation_amount, tourist_tax_amount, amount,
          breakdown, status, stripe_refund_id, idempotency_key, created_by, created_at)
       SELECT r.id, NULL, NULL, $2, LEAST($3::bigint, r.left_cents) / 100.0, 0, LEAST($3::bigint, r.left_cents) / 100.0,
              $4::jsonb, 'succeeded', $5, $6, NULL, $7::timestamptz
         FROM room r
        WHERE LEAST($3::bigint, r.left_cents) > 0
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, booking_id, round(amount * 100)::bigint AS amount_cents
     )
     SELECT (SELECT id FROM room) AS booking_id,
            (SELECT left_cents FROM room) AS left_cents,
            (SELECT id FROM inserted) AS refund_id,
            (SELECT amount_cents FROM inserted) AS amount_cents,
            EXISTS (SELECT 1 FROM refunds WHERE idempotency_key = $6) AS existed`,
    [
      i.paymentIntentId,
      i.source,
      i.amountCents,
      JSON.stringify({
        stripeId: i.stripeId,
        chargeId: i.chargeId,
        stripeAccountId: i.stripeAccountId,
        stripeAmount: i.amountCents,
        reason: i.reason ?? null,
      }),
      i.source === "stripe_dashboard" ? i.stripeId : null,
      key,
      i.occurredAt,
    ],
  );
  const row = rows[0] as {
    booking_id: string | null;
    left_cents: string | number | null;
    refund_id: string | null;
    amount_cents: string | number | null;
    existed: boolean;
  };
  if (!row.booking_id) return { recorded: false, why: "no_booking" };
  if (!row.refund_id) {
    // The EXISTS ran on the statement's snapshot: it sees a row from an earlier
    // delivery, never the one this statement would have inserted.
    if (row.existed) return { recorded: false, why: "duplicate" };
    return { recorded: false, why: Number(row.left_cents) > 0 ? "duplicate" : "nothing_left" };
  }
  const amountCents = Number(row.amount_cents);
  await recordBookingEvent(db, {
    bookingId: row.booking_id,
    kind: "outside_refund",
    actor: { kind: "system", id: null },
    data: { refundId: row.refund_id, source: i.source, stripeId: i.stripeId, amount: amountCents / 100 },
  });
  return { recorded: true, bookingId: row.booking_id, refundId: row.refund_id, amountCents };
}

/** The host's explanation of an outside refund: how much was room price and how much tourist tax, cents. */
export type OutsideSplit = { roomPriceCents: number; touristTaxCents: number };

export type SplitError = "split_not_whole_cents" | "split_negative" | "split_sum_mismatch";

/** Both parts whole, non-negative cents, adding up to exactly `amountCents`. */
export function validateSplit(amountCents: number, split: OutsideSplit): { ok: true } | { ok: false; error: SplitError } {
  const { roomPriceCents: room, touristTaxCents: tax } = split;
  if (!Number.isInteger(room) || !Number.isInteger(tax)) return { ok: false, error: "split_not_whole_cents" };
  if (room < 0 || tax < 0) return { ok: false, error: "split_negative" };
  if (room + tax !== amountCents) return { ok: false, error: "split_sum_mismatch" };
  return { ok: true };
}

/** Euros as typed by staff ("12,50", "12.5", "") → cents, or null when it isn't an amount. */
export function parseEuroCents(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** One outside refund as a booking page shows it. */
export type OutsideRefundLine = {
  id: string;
  source: OutsideSource;
  amount: number;
  /** When Stripe made it, or the dispute was lost. */
  at: Date;
  /** Null until the host's split is entered. */
  split: { roomPrice: number; touristTax: number } | null;
};

/** The outside refund rows of a booking, oldest first. */
export async function loadOutsideRefunds(db: Queryable, bookingId: string): Promise<OutsideRefundLine[]> {
  const { rows } = await db.query(
    `SELECT id, source, amount::float8 AS amount, created_at,
            accommodation_amount::float8 AS accommodation, tourist_tax_amount::float8 AS tourist_tax,
            split_explained_at
       FROM refunds WHERE booking_id = $1::uuid AND source <> 'openbookings'
      ORDER BY created_at, id`,
    [bookingId],
  );
  return (
    rows as {
      id: string;
      source: OutsideSource;
      amount: number;
      created_at: Date;
      accommodation: number;
      tourist_tax: number;
      split_explained_at: Date | null;
    }[]
  ).map((r) => ({
    id: r.id,
    source: r.source,
    amount: r.amount,
    at: r.created_at,
    split: r.split_explained_at ? { roomPrice: r.accommodation, touristTax: r.tourist_tax } : null,
  }));
}

/**
 * What a booking's refunds took off the room price and off the tourist tax,
 * euros, and how much of it is outside money not explained yet (counted as
 * room price until it is). For revenue and tourist-tax figures: the tourist
 * tax a host owes is the booked tax less `touristTax`, with `unexplained` to
 * be split once the host says how.
 */
export function refundedSplit(
  refunds: { source: string; status: string; accommodation: number; touristTax: number; explained: boolean }[],
): { roomPrice: number; touristTax: number; unexplained: number } {
  const c = (n: number) => Math.round(n * 100);
  let room = 0;
  let tax = 0;
  let unexplained = 0;
  for (const r of refunds) {
    if (r.status !== "succeeded") continue;
    room += c(r.accommodation);
    tax += c(r.touristTax);
    if (r.source !== "openbookings" && !r.explained) unexplained += c(r.accommodation) + c(r.touristTax);
  }
  return { roomPrice: room / 100, touristTax: tax / 100, unexplained: unexplained / 100 };
}

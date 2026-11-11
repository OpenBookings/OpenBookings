import type { ExtraGuestLine, PayAtPropertyLine, TouristTaxLine } from "@openbookings/pricing";
import { loadStayAvailability } from "./availability";
import { recordBookingEvent } from "./booking-events";
import type { VatTreatment } from "./billing-types";
// Type only: booking-lifecycle imports the package root at runtime, so a value import would be circular.
import type { LifecycleDb } from "./booking-lifecycle";
import { confirmBookingPolicy, type Queryable } from "./reservation-policy";

/**
 * One room of a guest's selection, priced on the server for its own party.
 * Amounts are euros (major units); `nights` sum to `stayTotal`.
 */
export type IntentRoomInput = {
  roomId: string;
  ratePlanId: string;
  adults: number;
  children: number;
  /** Under 2: no place, no fee (0042). */
  infants: number;
  /** Cots and extra beds booked with the room (0040). */
  cots: number;
  extraBeds: number;
  /** What the cots and extra beds cost, paid at the property: never in `nights` or `stayTotal` (0042). */
  payAtProperty: number;
  /** The stay discount already in `nights`, for checkout to show (0042). */
  discount: { label: string; amount: number } | null;
  /** Base rate per night, before extra guests and discount (0044). */
  rateNights: { date: string; price: number }[];
  /** Guests above base occupancy, already in `stayTotal` (0044). */
  extraGuests: ExtraGuestLine[];
  /** The lines behind `payAtProperty` (0044). */
  payAtPropertyLines: PayAtPropertyLine[];
  nights: { date: string; price: number }[];
  stayTotal: number;
  touristTax: number;
  touristTaxLines: TouristTaxLine[];
};

/**
 * What the guest was shown when the intent was made. `commissionCents` is on
 * `roomsTotal` only (never the tourist tax), and 0 while the application fee
 * is switched off.
 */
export type IntentSnapshot = {
  roomsTotal: number;
  touristTaxTotal: number;
  total: number;
  commissionCents: number;
  /**
   * The split of `commissionCents` into net and VAT, fixed when the intent was
   * made. The treatment and parts are null while the host has no billing
   * profile. Intents made before the split existed have none of these fields.
   */
  commissionRate: number;
  commissionVatTreatment: VatTreatment | null;
  commissionNetCents: number | null;
  commissionVatCents: number | null;
  currency: "EUR";
  rooms: {
    roomId: string;
    ratePlanId: string;
    roomName: string;
    ratePlanName: string;
    isRefundable: boolean;
    freeCancellationUntil: string | null;
  }[];
};

/** How long an intent holds its rooms while the guest pays. */
export const HOLD_MINUTES = 15;
const HOLD_MS = HOLD_MINUTES * 60_000;

export type BookingIntentStatus = "open" | "paid" | "expired" | "failed" | "abandoned" | "oversold" | "refunded_oversold";

export type BookingIntent = {
  id: string;
  userId: string;
  propertyId: string;
  propertySlug: string;
  checkIn: string;
  checkOut: string;
  status: BookingIntentStatus;
  holdExpiresAt: Date;
  snapshot: IntentSnapshot;
  /** In the order the guest picked them. */
  rooms: (IntentRoomInput & { id: string })[];
  paymentSessionId: string | null;
  paymentAccountId: string | null;
  bookingId: string | null;
};

/** A payment session of an intent this guest just replaced: it must be expired so it cannot be paid. */
export type AbandonedSession = { intentId: string; sessionId: string; accountId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown inside the transaction so it rolls back whole, abandoned intents included. */
class Unavailable extends Error {
  constructor(readonly roomIds: string[]) {
    super("unavailable");
  }
}

/**
 * Hold the guest's rooms for HOLD_MINUTES. This is the authoritative
 * availability check; `priceSelection` only checks early, without locks.
 *
 * One transaction, always taking its locks in the same order as payment
 * confirmation (intents first, then rooms by id) so the two never deadlock:
 *
 * 1. A per-guest advisory lock, so two "Book now"s from one guest run one
 *    after the other and the second sees (and abandons) the first's intent.
 *    Without it neither sees the other's uncommitted row and both stay open.
 * 2. The guest's open intents become `abandoned`. A guest holds one selection
 *    at a time, and their old hold must not count against their new one.
 *    Their payment sessions come back for the caller to expire.
 * 3. The requested rooms, locked `FOR UPDATE` in id order. A second guest
 *    after the same room waits here until this one commits, then counts this
 *    hold.
 * 4. Stock, counted on this transaction. Any room short, or not a room of this
 *    property, rolls everything back, so the guest keeps their previous hold.
 */
export async function createBookingIntent(
  db: LifecycleDb,
  i: {
    userId: string;
    propertyId: string;
    checkIn: string;
    checkOut: string;
    rooms: IntentRoomInput[];
    snapshot: IntentSnapshot;
    now: Date;
  },
): Promise<
  | { ok: true; intentId: string; holdExpiresAt: Date; abandoned: AbandonedSession[] }
  | { ok: false; error: "unavailable"; roomIds: string[] }
> {
  if (i.rooms.length === 0) throw new RangeError("A booking intent needs at least one room");
  const holdExpiresAt = new Date(i.now.getTime() + HOLD_MS);

  try {
    return await db.transaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`booking_intents:user:${i.userId}`]);

      const { rows: abandonedRows } = await tx.query(
        `UPDATE booking_intents SET status = 'abandoned', updated_at = now()
         WHERE user_id = $1 AND status = 'open'
         RETURNING id, payment_session_id, payment_account_id`,
        [i.userId],
      );
      const abandoned = (
        abandonedRows as { id: string; payment_session_id: string | null; payment_account_id: string | null }[]
      ).flatMap((r) =>
        r.payment_session_id && r.payment_account_id
          ? [{ intentId: r.id, sessionId: r.payment_session_id, accountId: r.payment_account_id }]
          : [],
      );

      const wanted = new Map<string, number>();
      for (const r of i.rooms) wanted.set(r.roomId, (wanted.get(r.roomId) ?? 0) + 1);
      const roomIds = [...wanted.keys()].filter((id) => UUID.test(id));
      const { rows: lockedRows } = await tx.query(
        `SELECT id FROM rooms WHERE id = ANY($1::uuid[]) AND property_id = $2 ORDER BY id FOR UPDATE`,
        [roomIds, i.propertyId],
      );
      const locked = new Set((lockedRows as { id: string }[]).map((r) => r.id));

      const availability = await loadStayAvailability(tx, {
        propertyId: i.propertyId,
        checkIn: i.checkIn,
        checkOut: i.checkOut,
        now: i.now,
        excludeIntentId: null,
      });
      const unitsLeft = new Map(availability.map((a) => [a.roomId, a.unitsLeft]));
      const short = [...wanted].filter(([id, n]) => !locked.has(id) || n > (unitsLeft.get(id) ?? 0)).map(([id]) => id);
      if (short.length > 0) throw new Unavailable(short);

      const { rows: intentRows } = await tx.query(
        `INSERT INTO booking_intents
           (user_id, property_id, check_in_date, check_out_date, status, hold_expires_at,
            snapshot, total_amount, tourist_tax_amount, commission_cents, currency)
         VALUES ($1, $2, $3::date, $4::date, 'open', $5, $6::jsonb, $7, $8, $9, $10)
         RETURNING id`,
        [
          i.userId,
          i.propertyId,
          i.checkIn,
          i.checkOut,
          holdExpiresAt,
          JSON.stringify(i.snapshot),
          i.snapshot.total,
          i.snapshot.touristTaxTotal,
          i.snapshot.commissionCents,
          i.snapshot.currency,
        ],
      );
      const intentId = (intentRows[0] as { id: string }).id;

      for (const [sortOrder, r] of i.rooms.entries()) {
        await tx.query(
          `INSERT INTO booking_intent_rooms
             (intent_id, room_id, rate_plan_id, adults, children, nights, stay_total,
              tourist_tax_amount, tourist_tax_lines, sort_order, cots, extra_beds,
              infants, pay_at_property_amount, discount_label, discount_amount,
              rate_nights, extra_guests, pay_at_property_lines)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16,
                   $17::jsonb, $18::jsonb, $19::jsonb)`,
          [
            intentId,
            r.roomId,
            r.ratePlanId,
            r.adults,
            r.children,
            JSON.stringify(r.nights),
            r.stayTotal,
            r.touristTax,
            JSON.stringify(r.touristTaxLines),
            sortOrder,
            r.cots,
            r.extraBeds,
            r.infants,
            r.payAtProperty,
            r.discount?.label ?? null,
            r.discount?.amount ?? null,
            JSON.stringify(r.rateNights),
            JSON.stringify(r.extraGuests),
            JSON.stringify(r.payAtPropertyLines),
          ],
        );
      }

      return { ok: true as const, intentId, holdExpiresAt, abandoned };
    });
  } catch (error) {
    if (error instanceof Unavailable) return { ok: false, error: "unavailable", roomIds: error.roomIds };
    throw error;
  }
}

type IntentRow = {
  id: string;
  user_id: string;
  property_id: string;
  property_slug: string;
  check_in: string;
  check_out: string;
  status: BookingIntentStatus;
  hold_expires_at: Date;
  snapshot: IntentSnapshot;
  payment_session_id: string | null;
  payment_account_id: string | null;
  booking_id: string | null;
  rooms: (IntentRoomInput & { id: string })[];
};

/** One intent with its rooms; `$where` filters `bi`. Numerics come back through JSON as numbers. */
const INTENT_SQL = (where: string) => `
SELECT
  bi.id, bi.user_id, bi.property_id, p.slug AS property_slug,
  bi.check_in_date::text AS check_in, bi.check_out_date::text AS check_out,
  bi.status, bi.hold_expires_at, bi.snapshot,
  bi.payment_session_id, bi.payment_account_id, bi.booking_id,
  COALESCE((
    SELECT json_agg(json_build_object(
      'id',              r.id,
      'roomId',          r.room_id,
      'ratePlanId',      r.rate_plan_id,
      'adults',          r.adults,
      'children',        r.children,
      'infants',         r.infants,
      'cots',            r.cots,
      'extraBeds',       r.extra_beds,
      'payAtProperty',   r.pay_at_property_amount,
      'discount',        CASE WHEN r.discount_label IS NULL THEN NULL
                              ELSE json_build_object('label', r.discount_label, 'amount', r.discount_amount) END,
      'rateNights',      r.rate_nights,
      'extraGuests',     r.extra_guests,
      'payAtPropertyLines', r.pay_at_property_lines,
      'nights',          r.nights,
      'stayTotal',       r.stay_total,
      'touristTax',      r.tourist_tax_amount,
      'touristTaxLines', r.tourist_tax_lines
    ) ORDER BY r.sort_order, r.id)
    FROM booking_intent_rooms r WHERE r.intent_id = bi.id
  ), '[]'::json) AS rooms
FROM booking_intents bi
JOIN properties p ON p.id = bi.property_id
WHERE ${where}
LIMIT 1
`;

function toIntent(row: IntentRow): BookingIntent {
  return {
    id: row.id,
    userId: row.user_id,
    propertyId: row.property_id,
    propertySlug: row.property_slug,
    checkIn: row.check_in,
    checkOut: row.check_out,
    status: row.status,
    holdExpiresAt: row.hold_expires_at,
    snapshot: row.snapshot,
    rooms: row.rooms,
    paymentSessionId: row.payment_session_id,
    paymentAccountId: row.payment_account_id,
    bookingId: row.booking_id,
  };
}

/** The guest's own intent, or null: someone else's reads as not found. */
export async function loadIntent(db: Queryable, i: { intentId: string; userId: string }): Promise<BookingIntent | null> {
  if (!UUID.test(i.intentId)) return null;
  const { rows } = await db.query(INTENT_SQL(`bi.id = $1::uuid AND bi.user_id = $2`), [i.intentId, i.userId]);
  return rows[0] ? toIntent(rows[0] as IntentRow) : null;
}

/** Return page only. The webhook finds its intent through session metadata (`bookingIntentId`), never through this. */
export async function loadIntentBySession(
  db: Queryable,
  i: { sessionId: string; userId: string },
): Promise<BookingIntent | null> {
  const { rows } = await db.query(INTENT_SQL(`bi.payment_session_id = $1 AND bi.user_id = $2`), [i.sessionId, i.userId]);
  return rows[0] ? toIntent(rows[0] as IntentRow) : null;
}

/** `attachPaymentSession` found the intent no longer open: the session just made must be expired. */
export class IntentNotOpenError extends Error {
  constructor(readonly intentId: string) {
    super(`Booking intent ${intentId} is no longer open`);
    this.name = "IntentNotOpenError";
  }
}

/**
 * Record the payment session made for an open intent. Throws when the intent
 * is no longer open (the guest replaced it, or its hold was expired): the
 * caller must then expire the session it just made, or it stays payable with
 * nothing holding the rooms. Checked on the same row the abandon step updates,
 * so either this attach wins and `createBookingIntent` returns the session to
 * expire, or the abandon wins and this throws.
 */
export async function attachPaymentSession(
  db: Queryable,
  i: { intentId: string; sessionId: string; accountId: string },
): Promise<void> {
  const { rows } = await db.query(
    `UPDATE booking_intents
     SET payment_session_id = $2, payment_account_id = $3, updated_at = now()
     WHERE id = $1 AND status = 'open'
     RETURNING id`,
    [i.intentId, i.sessionId, i.accountId],
  );
  if (rows.length === 0) throw new IntentNotOpenError(i.intentId);
}

/**
 * End an open intent's hold once it has run out (or straight away with
 * `force`), returning its payment session for the caller to expire. Any other
 * status, or a hold still running, is left alone and reads as null: a paid
 * intent is never downgraded.
 */
export async function expireIntent(
  db: Queryable,
  i: { intentId: string; now: Date; force?: boolean },
): Promise<{ sessionId: string | null; accountId: string | null } | null> {
  if (!UUID.test(i.intentId)) return null;
  const { rows } = await db.query(
    `UPDATE booking_intents SET status = 'expired', updated_at = now()
     WHERE id = $1::uuid AND status = 'open' AND ($3::boolean OR hold_expires_at <= $2::timestamptz)
     RETURNING payment_session_id, payment_account_id`,
    [i.intentId, i.now, i.force ?? false],
  );
  const row = rows[0] as { payment_session_id: string | null; payment_account_id: string | null } | undefined;
  return row ? { sessionId: row.payment_session_id, accountId: row.payment_account_id } : null;
}

/**
 * Whether this session is still the one the intent is paying with. An intent
 * whose unusable session was replaced also hears about the old one expiring,
 * and that must not end the hold the new session is paying against.
 */
export async function isCurrentPaymentSession(db: Queryable, i: { intentId: string; sessionId: string }): Promise<boolean> {
  if (!UUID.test(i.intentId)) return false;
  const { rows } = await db.query(`SELECT id FROM booking_intents WHERE id = $1::uuid AND payment_session_id = $2`, [
    i.intentId,
    i.sessionId,
  ]);
  return rows.length > 0;
}

/** A payment session whose outcome the database has not recorded. */
export type UnsettledPayment = { intentId: string; sessionId: string; accountId: string };

/**
 * Payment sessions to check with Stripe, because the webhook may never have
 * told us how they ended. Oldest first.
 *
 * - Skipped while younger than `graceMinutes`: the webhook normally settles a
 *   session within seconds, and Stripe's own retries start after that.
 * - Every `open` intent with a session: it stays a candidate until Stripe
 *   reports the session paid or expired, which settles it either way.
 * - `expired` and `abandoned` intents only while younger than `windowMinutes`:
 *   their session could still have been paid in its last minutes, but past the
 *   session's lifetime nothing more can happen to it. A bank debit that clears
 *   days later is settled by its own webhook (`async_payment_succeeded`).
 */
export async function listUnsettledPayments(
  db: Queryable,
  i: { now: Date; graceMinutes: number; windowMinutes: number; limit: number },
): Promise<UnsettledPayment[]> {
  const { rows } = await db.query(
    `SELECT id, payment_session_id, payment_account_id
     FROM booking_intents
     WHERE payment_session_id IS NOT NULL
       AND payment_account_id IS NOT NULL
       AND created_at <= $1::timestamptz - make_interval(mins => $2::int)
       AND (status = 'open'
            OR (status IN ('expired', 'abandoned') AND created_at > $1::timestamptz - make_interval(mins => $3::int)))
     ORDER BY created_at
     LIMIT $4`,
    [i.now, i.graceMinutes, i.windowMinutes, i.limit],
  );
  return (rows as { id: string; payment_session_id: string; payment_account_id: string }[]).map((r) => ({
    intentId: r.id,
    sessionId: r.payment_session_id,
    accountId: r.payment_account_id,
  }));
}

/** The payment failed: an open intent stops holding its rooms. Any other status is left as it is. */
export async function markIntentFailed(db: Queryable, i: { intentId: string }): Promise<void> {
  await db.query(
    `UPDATE booking_intents SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'open'`,
    [i.intentId],
  );
}

/**
 * What a payment became. `firstTime` is false when an earlier call already did
 * the work (a redelivered event, or a second payment for the same intent).
 *
 * The payment reference is always the one stored on the intent: on a first
 * call that is this call's payment, afterwards the payment that converted it.
 * A caller holding a different payment must refund it. `oversold` carries
 * `accountId` and `amountCents` from the call, so the caller can refund
 * without reading anything again.
 */
export type ConvertResult =
  | { outcome: "confirmed"; bookingId: string; firstTime: boolean; paymentReference: string }
  | { outcome: "oversold"; firstTime: boolean; paymentIntentId: string; accountId: string; amountCents: number };

/** No booking intent with this id. The payment cannot be matched to anything: alert, do not retry. */
export class IntentNotFoundError extends Error {
  constructor(readonly intentId: string) {
    super(`Booking intent ${intentId} not found`);
    this.name = "IntentNotFoundError";
  }
}

/**
 * Turn a paid intent into a confirmed booking, exactly once.
 *
 * One transaction, locking in `createBookingIntent`'s order (the intent, then
 * its rooms by id) so the two never deadlock. The intent lock makes redelivered
 * payment events queue up: the second sees `paid` (or `oversold`) and returns
 * what the first did.
 *
 * Any other status converts, `expired`, `abandoned` and `failed` included: the
 * guest was charged, so the stock is counted again (without this intent's own
 * hold). Short on any room, the intent becomes `oversold` and no booking is
 * made; the caller refunds the payment.
 *
 * The booking is inserted `confirmed`, never `pending`, so `confirmBookingPolicy`
 * only snapshots the policy here; `confirmed_at` and the `confirmed` event are
 * written by this function.
 */
export async function convertIntentToBooking(
  db: LifecycleDb,
  i: { intentId: string; paymentIntentId: string; accountId: string; amountCents: number; now: Date },
): Promise<ConvertResult> {
  const oversold = (firstTime: boolean, paymentIntentId: string): ConvertResult => ({
    outcome: "oversold",
    firstTime,
    paymentIntentId,
    accountId: i.accountId,
    amountCents: i.amountCents,
  });

  return db.transaction(async (tx) => {
    const { rows: locked } = UUID.test(i.intentId)
      ? await tx.query(
          `SELECT status, booking_id, payment_reference FROM booking_intents WHERE id = $1::uuid FOR UPDATE`,
          [i.intentId],
        )
      : { rows: [] };
    const current = locked[0] as
      | { status: BookingIntentStatus; booking_id: string | null; payment_reference: string | null }
      | undefined;
    if (!current) throw new IntentNotFoundError(i.intentId);
    if (current.status === "paid") {
      // Never a second booking for one intent, even if the first was deleted.
      if (!current.booking_id || !current.payment_reference) {
        throw new Error(`Paid booking intent ${i.intentId} has no booking or payment reference`);
      }
      return {
        outcome: "confirmed" as const,
        bookingId: current.booking_id,
        firstTime: false,
        paymentReference: current.payment_reference,
      };
    }
    if (current.status === "oversold" || current.status === "refunded_oversold") {
      // Always set on the way to oversold; the call's payment only if it somehow is not.
      return oversold(false, current.payment_reference ?? i.paymentIntentId);
    }

    const { rows } = await tx.query(INTENT_SQL(`bi.id = $1::uuid`), [i.intentId]);
    const intent = toIntent(rows[0] as IntentRow);

    const wanted = new Map<string, number>();
    for (const r of intent.rooms) wanted.set(r.roomId, (wanted.get(r.roomId) ?? 0) + 1);
    await tx.query(`SELECT id FROM rooms WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[...wanted.keys()]]);

    const availability = await loadStayAvailability(tx, {
      propertyId: intent.propertyId,
      checkIn: intent.checkIn,
      checkOut: intent.checkOut,
      now: i.now,
      excludeIntentId: intent.id,
    });
    const unitsLeft = new Map(availability.map((a) => [a.roomId, a.unitsLeft]));
    if ([...wanted].some(([id, n]) => n > (unitsLeft.get(id) ?? 0))) {
      await tx.query(
        `UPDATE booking_intents SET status = 'oversold', payment_reference = $2, updated_at = now() WHERE id = $1`,
        [intent.id, i.paymentIntentId],
      );
      return oversold(true, i.paymentIntentId);
    }

    const { rows: bookingRows } = await tx.query(
      `INSERT INTO bookings
         (hotel_id, user_id, check_in_date, check_out_date, status, confirmed_at,
          total_amount, booking_fee_amount, currency, stripe_payment_intent_id,
          rooms_total_cents, tourist_tax_cents, total_cents, commission_cents,
          commission_rate, commission_vat_treatment, commission_net_cents, commission_vat_cents)
       VALUES ($1, $2, $3::date, $4::date, 'confirmed', $5, $6, 0, $7, $8, $9::bigint, $10::bigint, $9::bigint + $10::bigint, $11,
               $12::numeric, $13, $14::bigint, $15::bigint)
       RETURNING id`,
      [
        intent.propertyId,
        intent.userId,
        intent.checkIn,
        intent.checkOut,
        i.now,
        Math.round(intent.snapshot.total),
        intent.snapshot.currency,
        i.paymentIntentId,
        Math.round(intent.snapshot.roomsTotal * 100),
        Math.round(intent.snapshot.touristTaxTotal * 100),
        intent.snapshot.commissionCents,
        // Read defensively: intents made before the split existed lack these.
        intent.snapshot.commissionRate ?? null,
        intent.snapshot.commissionVatTreatment ?? null,
        intent.snapshot.commissionNetCents ?? null,
        intent.snapshot.commissionVatCents ?? null,
      ],
    );
    const bookingId = (bookingRows[0] as { id: string }).id;

    const nightPrices: Record<string, { date: string; price: number }[]> = {};
    const touristTax: Record<string, number> = {};
    for (const r of intent.rooms) {
      const { rows: reservationRows } = await tx.query(
        `INSERT INTO reservations
           (booking_id, room_id, rate_plan_id, adults, children, total_nights, price_per_night,
            total_amount, tourist_tax_amount, tourist_tax_lines, cots, extra_beds,
            infants, pay_at_property_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
         RETURNING id`,
        [
          bookingId,
          r.roomId,
          r.ratePlanId,
          r.adults,
          r.children,
          r.nights.length,
          Math.round(r.stayTotal / r.nights.length),
          Math.round(r.stayTotal),
          r.touristTax,
          JSON.stringify(r.touristTaxLines),
          r.cots,
          r.extraBeds,
          r.infants,
          r.payAtProperty,
        ],
      );
      const reservationId = (reservationRows[0] as { id: string }).id;
      nightPrices[reservationId] = r.nights;
      touristTax[reservationId] = r.touristTax;
    }

    // The tax the guest was charged, not what the rules say now: they may have changed before a late payment.
    await confirmBookingPolicy(tx, { bookingId, confirmedAt: i.now, nightPrices, touristTax });
    await recordBookingEvent(tx, {
      bookingId,
      kind: "confirmed",
      actor: { kind: "system", id: null },
      // The bigint totals are whole euros; these keep the exact charge.
      data: {
        intentId: intent.id,
        paymentIntentId: i.paymentIntentId,
        amountCents: i.amountCents,
        snapshotTotal: intent.snapshot.total,
      },
    });
    await tx.query(
      `INSERT INTO transactions (booking_id, type, provider, provider_payment_id, amount, currency, status, metadata)
       VALUES ($1, 'charge', 'stripe', $2, $3, $4, 'succeeded', $5::jsonb)`,
      [
        bookingId,
        i.paymentIntentId,
        Math.round(i.amountCents / 100),
        intent.snapshot.currency,
        JSON.stringify({ amountCents: i.amountCents }),
      ],
    );
    await tx.query(
      `UPDATE booking_intents
       SET status = 'paid', booking_id = $2, payment_reference = $3, updated_at = now()
       WHERE id = $1`,
      [intent.id, bookingId, i.paymentIntentId],
    );

    return { outcome: "confirmed" as const, bookingId, firstTime: true, paymentReference: i.paymentIntentId };
  });
}

/** The oversold payment was refunded. True only for the `oversold` → `refunded_oversold` step itself. */
export async function markIntentRefundedOversold(db: Queryable, i: { intentId: string; refundId: string }): Promise<boolean> {
  if (!UUID.test(i.intentId)) return false;
  const { rows } = await db.query(
    `UPDATE booking_intents SET status = 'refunded_oversold', refund_reference = $2, updated_at = now()
     WHERE id = $1 AND status = 'oversold'
     RETURNING id`,
    [i.intentId, i.refundId],
  );
  return rows.length > 0;
}

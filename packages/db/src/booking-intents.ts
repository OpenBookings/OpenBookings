import type { TouristTaxLine } from "@openbookings/pricing";
import { loadStayAvailability } from "./availability";
// Type only: booking-lifecycle imports the package root at runtime, so a value import would be circular.
import type { LifecycleDb } from "./booking-lifecycle";
import type { Queryable } from "./reservation-policy";

/**
 * One room of a guest's selection, priced on the server for its own party.
 * Amounts are euros (major units); `nights` sum to `stayTotal`.
 */
export type IntentRoomInput = {
  roomId: string;
  ratePlanId: string;
  adults: number;
  children: number;
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
              tourist_tax_amount, tourist_tax_lines, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10)`,
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
  if (rows.length === 0) throw new Error(`Booking intent ${i.intentId} is no longer open`);
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

/** The payment failed: an open intent stops holding its rooms. Any other status is left as it is. */
export async function markIntentFailed(db: Queryable, i: { intentId: string }): Promise<void> {
  await db.query(
    `UPDATE booking_intents SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'open'`,
    [i.intentId],
  );
}

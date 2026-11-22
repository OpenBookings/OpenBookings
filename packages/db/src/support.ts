import type { CancellationTier } from "@openbookings/pricing";
import { query } from "./index";

/**
 * Reservation lookups for the support bot (apps/support-bot). These return
 * only what the bot is allowed to ground its replies in — no host payout or
 * commission data.
 */

export type SupportReservationRoom = {
  room_name: string;
  rate_plan_name: string;
} & SupportRoomPolicy & {
  adults: number;
  children: number;
  total_nights: number;
  /** The room's stay, VAT included, in cents: the sum of its nights. */
  stay_total_cents: number;
  /** Cots and extra beds, paid at the property, in cents. Not in any total. */
  pay_at_property_cents: number;
};

/**
 * A room's cancellation terms: the policy snapshot taken at booking (0027),
 * or, while the booking is still pending, the tier it would get now.
 */
export type SupportRoomPolicy = {
  cancellation_tier: CancellationTier;
  check_in_at: string | null;
  full_refund_until: string | null;
  cancelled_at: string | null;
};

/** The json_build_object pairs for SupportRoomPolicy. Needs `r` (reservations), `rp` and `p`. */
export const ROOM_POLICY_JSON = `
  'cancellation_tier', COALESCE(
    r.cancellation_tier::text,
    CASE WHEN rp.is_refundable THEN p.cancellation_tier::text ELSE 'non_refundable' END
  ),
  'check_in_at', r.check_in_at,
  'full_refund_until', r.full_refund_until,
  'cancelled_at', r.cancelled_at`;

export type SupportReservation = {
  booking_id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  /**
   * Money in cents. `bookings.total_amount` is whole euros, so it is never
   * read here: the support bot is told every amount is in cents.
   * `rooms_total_cents` and `tourist_tax_cents` are null on bookings from
   * before the split was stored (0035); `total_cents` then falls back to the
   * legacy whole-euro total.
   */
  total_cents: number;
  rooms_total_cents: number | null;
  tourist_tax_cents: number | null;
  currency: string;
  stripe_payment_intent_id: string | null;
  /**
   * The host's connected account, where the payment lives (direct charges).
   * For looking the payment up only; never shown to the guest or the model.
   */
  stripe_account_id: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  guest_email: string | null;
  property_name: string;
  property_city: string;
  property_country: string;
  check_in_time: string;
  check_out_time: string;
  /** The property's zone, for stating deadlines in local time. */
  timezone: string;
  confirmed_at: string | null;
  rooms: SupportReservationRoom[];
};

/**
 * A booking's money in cents, for any SELECT over `bookings b`. Shared with
 * the host lookups so both bots get the same units. `total_cents` is 0 only on
 * bookings from before 0035; those fall back to the whole-euro total.
 */
// ::int, not ::bigint: pg returns int8 as a string. A booking's cents fit int4.
export const BOOKING_CENTS_COLUMNS = `
    (CASE WHEN b.total_cents > 0 THEN b.total_cents ELSE b.total_amount * 100 END)::int AS total_cents,
    (CASE WHEN b.total_cents > 0 THEN b.rooms_total_cents END)::int AS rooms_total_cents,
    (CASE WHEN b.total_cents > 0 THEN b.tourist_tax_cents END)::int AS tourist_tax_cents`;

/**
 * A room's money in cents, as json_build_object pairs. Needs `r`
 * (reservations). The stay is the sum of the night prices snapshotted at
 * confirmation; `price_per_night` and `total_amount` are rounded whole euros,
 * so they are only the fallback for a reservation without nights.
 */
export const ROOM_CENTS_JSON = `
  'stay_total_cents', COALESCE(
    (SELECT round(sum((n->>'price')::numeric) * 100) FROM jsonb_array_elements(r.nights) n),
    r.total_amount * 100
  )::bigint,
  'pay_at_property_cents', round(r.pay_at_property_amount * 100)::bigint`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESERVATION_SELECT = `
  SELECT
    b.id::text AS booking_id,
    b.status::text AS status,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    ${BOOKING_CENTS_COLUMNS},
    b.currency,
    b.stripe_payment_intent_id,
    p.stripe_account_id,
    b.cancellation_reason,
    b.cancelled_at::text AS cancelled_at,
    b.created_at::text AS created_at,
    u.email AS guest_email,
    p.name AS property_name,
    p.city AS property_city,
    p.country AS property_country,
    p.check_in_time::text AS check_in_time,
    p.check_out_time::text AS check_out_time,
    p.timezone,
    b.confirmed_at::text AS confirmed_at,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'room_name', rm.name,
          'rate_plan_name', rp.name,
          ${ROOM_POLICY_JSON},
          'adults', r.adults,
          'children', r.children,
          'total_nights', r.total_nights,
          ${ROOM_CENTS_JSON}
        ) ORDER BY rm.name)
        FROM reservations r
        JOIN rooms rm ON rm.id = r.room_id
        JOIN rate_plans rp ON rp.id = r.rate_plan_id
        WHERE r.booking_id = b.id
      ),
      '[]'::json
    ) AS rooms
  FROM bookings b
  JOIN properties p ON p.id = b.hotel_id
  LEFT JOIN "user" u ON u.id = b.user_id
`;

/**
 * Look up a booking by its reference (the booking id guests receive in their
 * confirmation). Returns null when the reference is not a valid uuid or no
 * booking matches.
 */
export async function findReservationByReference(
  bookingReference: string,
): Promise<SupportReservation | null> {
  const ref = bookingReference.trim();
  if (!UUID_RE.test(ref)) return null;
  const rows = await query<SupportReservation>(
    `${RESERVATION_SELECT} WHERE b.id = $1`,
    [ref],
  );
  return rows[0] ?? null;
}

/**
 * Look up a guest's recent bookings by their account email (case-insensitive).
 * Newest first, capped so a long booking history can't blow up the model
 * context.
 */
export async function findReservationsByGuestEmail(
  guestEmail: string,
  limit = 5,
): Promise<SupportReservation[]> {
  return query<SupportReservation>(
    `${RESERVATION_SELECT}
     WHERE lower(u.email) = lower($1)
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [guestEmail.trim(), limit],
  );
}

/**
 * The account email of the guest whose user id is `userId`, or null when no
 * private (guest) account with that id has a verified email.
 *
 * The support bot uses this to turn a Chatwoot contact identifier (which
 * Chatwoot only accepts with our server's HMAC, and which for guests must be
 * the user id) into the email it scopes booking lookups by. The email on the
 * Chatwoot contact itself is not covered by that signature and is never used
 * for this. Host (business) accounts and unverified emails are excluded.
 */
export async function findGuestEmailByUserId(userId: string): Promise<string | null> {
  const rows = await query<{ email: string }>(
    `SELECT email FROM "user"
     WHERE id = $1 AND account_type = 'private' AND "emailVerified" = true`,
    [userId],
  );
  return rows[0]?.email ?? null;
}

/** processed_events helpers — webhook idempotency for the support bot. */

/**
 * Record an event id. Returns true when this call inserted the row (first
 * delivery), false when the event was already recorded (duplicate delivery).
 */
export async function recordProcessedEvent(eventId: string): Promise<boolean> {
  const rows = await query<{ event_id: string }>(
    `INSERT INTO processed_events (event_id)
     VALUES ($1)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId],
  );
  return rows.length > 0;
}

/** True when a guest-facing reply was already posted for this event. */
export async function hasRepliedToEvent(eventId: string): Promise<boolean> {
  const rows = await query<{ replied_at: string | null }>(
    `SELECT replied_at FROM processed_events WHERE event_id = $1`,
    [eventId],
  );
  return rows[0]?.replied_at != null;
}

/** Mark that the guest-facing reply (or escalation note) for this event was posted. */
export async function markEventReplied(eventId: string): Promise<void> {
  await query(
    `UPDATE processed_events SET replied_at = now() WHERE event_id = $1`,
    [eventId],
  );
}

/** support_context_cache helpers — recent turns per Chatwoot conversation. */

export type CachedTurn = { role: "user" | "assistant"; content: string };

export async function getConversationCache(
  conversationId: number,
  maxAgeMs: number,
): Promise<CachedTurn[] | null> {
  const rows = await query<{ turns: CachedTurn[]; updated_at: string }>(
    `SELECT turns, updated_at::text AS updated_at
     FROM support_context_cache
     WHERE conversation_id = $1`,
    [conversationId],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.updated_at).getTime() > maxAgeMs) return null;
  return row.turns;
}

export async function setConversationCache(
  conversationId: number,
  turns: CachedTurn[],
): Promise<void> {
  await query(
    `INSERT INTO support_context_cache (conversation_id, turns, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (conversation_id)
     DO UPDATE SET turns = EXCLUDED.turns, updated_at = now()`,
    [conversationId, JSON.stringify(turns)],
  );
}

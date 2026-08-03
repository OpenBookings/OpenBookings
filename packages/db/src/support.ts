import { query } from "./index";

/**
 * Reservation lookups for the support bot (apps/support-bot). These return
 * only what the bot is allowed to ground its replies in — no host payout or
 * commission data.
 */

export type SupportReservationRoom = {
  room_name: string;
  rate_plan_name: string;
  is_refundable: boolean;
  cancellation_policy: string | null;
  adults: number;
  children: number;
  total_nights: number;
  price_per_night: number;
  total_amount: number;
};

export type SupportReservation = {
  booking_id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  currency: string;
  stripe_payment_intent_id: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  guest_email: string | null;
  property_name: string;
  property_city: string;
  property_country: string;
  check_in_time: string;
  check_out_time: string;
  rooms: SupportReservationRoom[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESERVATION_SELECT = `
  SELECT
    b.id::text AS booking_id,
    b.status::text AS status,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    b.total_amount::bigint AS total_amount,
    b.currency,
    b.stripe_payment_intent_id,
    b.cancellation_reason,
    b.cancelled_at::text AS cancelled_at,
    b.created_at::text AS created_at,
    u.email AS guest_email,
    p.name AS property_name,
    p.city AS property_city,
    p.country AS property_country,
    p.check_in_time::text AS check_in_time,
    p.check_out_time::text AS check_out_time,
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'room_name', rm.name,
          'rate_plan_name', rp.name,
          'is_refundable', rp.is_refundable,
          'cancellation_policy', rp.cancellation_policy,
          'adults', r.adults,
          'children', r.children,
          'total_nights', r.total_nights,
          'price_per_night', r.price_per_night,
          'total_amount', r.total_amount
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

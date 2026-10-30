import { query } from '@openbookings/db';
import { toGuestBooking, type GuestBooking, type GuestBookingRow } from './shape';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The booking, only if it belongs to `userId`. Anyone else gets null — the
 * same answer as for a booking that does not exist, so a stranger learns
 * nothing from guessing ids. Pending rows are unpaid checkout intents, not
 * bookings, and are not shown.
 */
export const GUEST_BOOKING_SQL = `
  SELECT
    b.id AS booking_id,
    b.status,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    p.name AS property_name,
    p.city,
    p.timezone,
    to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
    to_char(p.check_in_until, 'HH24:MI') AS check_in_until,
    b.confirmed_at,
    COALESCE((SELECT SUM(rf.amount) FROM refunds rf
              WHERE rf.booking_id = b.id AND rf.status <> 'failed'), 0)::float8 AS refunded,
    COALESCE((
      SELECT json_agg(json_build_object(
        'reservation_id', r.id,
        'room_name', rm.name,
        'cancellation_tier', r.cancellation_tier,
        'check_in_at', r.check_in_at,
        'full_refund_until', r.full_refund_until,
        'nights', r.nights,
        'cancelled_at', r.cancelled_at
      ) ORDER BY r.created_at, r.id)
      FROM reservations r JOIN rooms rm ON rm.id = r.room_id
      WHERE r.booking_id = b.id
    ), '[]'::json) AS rooms
  FROM bookings b
  JOIN properties p ON p.id = b.hotel_id
  WHERE b.id = $1::uuid AND b.user_id = $2 AND b.status <> 'pending'
`;

export async function loadGuestBooking(
  bookingId: string,
  userId: string,
  run: (sql: string, values: unknown[]) => Promise<GuestBookingRow[]> = query,
  now: Date = new Date(),
): Promise<GuestBooking | null> {
  if (!UUID.test(bookingId)) return null;
  const [row] = await run(GUEST_BOOKING_SQL, [bookingId, userId]);
  return row ? toGuestBooking(row, now) : null;
}

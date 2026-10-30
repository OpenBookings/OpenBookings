import { getHostScopedDb, propertyReadAccessSql, type SessionLike } from "@openbookings/authz";
import { toHostReservation, type HostReservation, type HostReservationRow } from "./shape";

/** Bookings that ended more than this many days ago drop off the list. */
const PAST_DAYS = 30;

/**
 * Every paid booking at the properties this host can read, from a month ago
 * onwards. Pending rows are checkout intents, not bookings, and are left out.
 *
 * `$1` is the host (getHostScopedDb binds it).
 */
export const HOST_RESERVATIONS_SQL = `
  SELECT
    b.id AS booking_id,
    b.status,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    u.name AS guest_name,
    COALESCE((SELECT SUM(r.adults + r.children) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS guests,
    b.total_amount::float8 AS total_amount,
    p.timezone,
    to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
    to_char(p.check_in_until, 'HH24:MI') AS check_in_until,
    b.departed_early_on::text AS departed_early_on,
    b.confirmed_at,
    COALESCE((SELECT SUM(rf.amount) FROM refunds rf
              WHERE rf.booking_id = b.id AND rf.status <> 'failed'), 0)::float8 AS refunded,
    (SELECT COUNT(*) FROM refunds rf
     WHERE rf.booking_id = b.id AND rf.status IN ('pending', 'failed'))::int AS unsettled_refunds,
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
  LEFT JOIN "user" u ON u.id = b.user_id
  WHERE ${propertyReadAccessSql("$1")}
    AND b.status <> 'pending'
    AND b.check_out_date >= CURRENT_DATE - ${PAST_DAYS}
  ORDER BY b.check_in_date, b.created_at
`;

export async function loadHostReservations(
  session: SessionLike,
  host: Pick<ReturnType<typeof getHostScopedDb>, "query"> = getHostScopedDb(session),
  now: Date = new Date(),
): Promise<HostReservation[]> {
  const rows = await host.query<HostReservationRow>(HOST_RESERVATIONS_SQL);
  return rows.map((row) => toHostReservation(row, now));
}

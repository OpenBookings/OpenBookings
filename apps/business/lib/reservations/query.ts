import { isTestingMode } from "@openbookings/mode";
import { currentPropertySql, getPropertyScopedDb, type SessionLike } from "@openbookings/authz";
import { toHostReservation, type HostReservation, type HostReservationRow } from "./shape";
import { actionsForViewer, viewerCanRetryRefunds } from "./permissions";

/** Bookings that ended more than this many days ago drop off the list. */
const PAST_DAYS = 30;

/**
 * Every paid booking at the current hotel, from a month ago onwards. Pending
 * rows are checkout intents, not bookings, and are left out.
 *
 * `$1` is the host, `$2` the current hotel (getPropertyScopedDb binds both).
 */
const hostReservationsSql = (testing: boolean = isTestingMode()) => `
  SELECT
    b.id AS booking_id,
    b.status,
    b.check_in_date::text AS check_in_date,
    b.check_out_date::text AS check_out_date,
    u.name AS guest_name,
    -- No guest contact details here: they are behind break-the-glass
    -- (./break-glass.ts), fetched per booking and logged.
    COALESCE((SELECT SUM(r.adults + r.children) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS guests,
    COALESCE((SELECT SUM(r.adults) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS adults,
    COALESCE((SELECT SUM(r.children) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS children,
    -- Infants take no place; cots and extra beds are paid at the hotel (0042).
    COALESCE((SELECT SUM(r.infants) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS infants,
    COALESCE((SELECT SUM(r.cots) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS cots,
    COALESCE((SELECT SUM(r.extra_beds) FROM reservations r WHERE r.booking_id = b.id), 0)::int AS extra_beds,
    -- Money in cents throughout (0058). bigint sums come back as text, hence ::float8.
    COALESCE((SELECT SUM(r.pay_at_property_cents) FROM reservations r
              WHERE r.booking_id = b.id AND r.cancelled_at IS NULL), 0)::float8 AS pay_at_property_cents,
    b.total_cents::float8 AS total_cents,
    -- The viewer's role at this booking's property, so the list offers only
    -- the actions they may take (the server actions re-check every one). A
    -- pre-org property is readable only by its owner_user_id, who is its owner.
    CASE WHEN p.organization_id IS NULL THEN 'owner' ELSE (
      SELECT vm.role FROM "member" vm
      WHERE vm."organizationId" = p.organization_id AND vm."userId" = $1
    ) END AS viewer_role,
    EXISTS (
      SELECT 1 FROM "member" vm
      JOIN property_access vpa ON vpa.member_id = vm.id AND vpa.property_id = p.id
      WHERE vm."organizationId" = p.organization_id AND vm."userId" = $1
    ) AS viewer_has_access,
    p.timezone,
    to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
    to_char(p.check_in_until, 'HH24:MI') AS check_in_until,
    to_char(p.check_out_time, 'HH24:MI') AS check_out_time,
    b.departed_early_on::text AS departed_early_on,
    b.confirmed_at,
    COALESCE((SELECT SUM(rf.amount_cents) FROM refunds rf
              WHERE rf.booking_id = b.id AND rf.status <> 'failed'), 0)::float8 AS refunded_cents,
    (SELECT COUNT(*) FROM refunds rf
     WHERE rf.booking_id = b.id AND rf.status IN ('pending', 'failed'))::int AS unsettled_refunds,
    -- Money the host refunded in their own Stripe, or lost in a dispute (0053).
    -- Its split shows once the host has explained it to OpenBookings.
    COALESCE((
      SELECT json_agg(json_build_object(
        'source', rf.source,
        'amount_cents', rf.amount_cents,
        'at', rf.created_at,
        'room_price_cents', CASE WHEN rf.split_explained_at IS NOT NULL THEN rf.accommodation_cents END,
        'tourist_tax_cents', CASE WHEN rf.split_explained_at IS NOT NULL THEN rf.tourist_tax_cents END
      ) ORDER BY rf.created_at, rf.id)
      FROM refunds rf WHERE rf.booking_id = b.id AND rf.source <> 'openbookings' AND rf.status = 'succeeded'
    ), '[]'::json) AS outside_refunds,
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
  WHERE ${currentPropertySql(testing)}
    AND b.status <> 'pending'
    AND b.check_out_date >= CURRENT_DATE - ${PAST_DAYS}
  ORDER BY b.check_in_date, b.created_at
`;

/** The current hotel's bookings; none without a current hotel. `db` is a seam for the DB-backed tests. */
export async function loadHostReservations(
  session: SessionLike,
  propertyId: string | null,
  db?: Pick<ReturnType<typeof getPropertyScopedDb>, "query">,
  now: Date = new Date(),
  testing: boolean = isTestingMode(),
): Promise<HostReservation[]> {
  if (!propertyId) return [];
  const host = db ?? getPropertyScopedDb(session, propertyId);
  const rows = await host.query<HostReservationRow & { viewer_role: string | null; viewer_has_access: boolean }>(
    hostReservationsSql(testing),
  );
  return rows.map((row) => {
    const reservation = toHostReservation(row, now);
    const viewer = { role: row.viewer_role, hasPropertyAccess: row.viewer_has_access === true };
    return {
      ...reservation,
      actions: actionsForViewer(reservation.actions, viewer),
      canRetryRefunds: viewerCanRetryRefunds(viewer),
    };
  });
}

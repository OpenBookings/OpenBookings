import { getPool, type Queryable } from "@openbookings/db";
import { activeInstallation, deliveryForBooking, upcomingUndeliveredCount } from "@openbookings/db/apps";
import { todayInZone } from "@openbookings/pricing";

/**
 * What the Channel manager page and the booking detail show. Server-only and
 * plain: the caller has already checked that the user may see this property.
 */

export type ChannelManagerData = {
  connected: boolean;
  /** The HotelCode the hotel gives SiteMinder. Null when the property is not found. */
  propertyCode: string | null;
  /** The hotel's IANA timezone, for the times the page shows. */
  timezone: string;
  appName: "SiteMinder";
  /** ISO time of the active connection; null when not connected. */
  connectedAt: string | null;
  /** Upcoming bookings the app has not been told about: the tick box's N. 0 while connected. */
  upcomingCount: number;
  /** Active rooms with at least one future night of app inventory, of all active rooms. */
  roomsLinked: number;
  roomsTotal: number;
  /** ISO time of the app's latest availability, rate or restriction update; null when none yet. */
  lastUpdateAt: string | null;
  /** Bookings checking out today or later that the app could not take and the hotel must act on. */
  needsAttentionCount: number;
};

export async function loadChannelManager(
  propertyId: string,
  db: Queryable = getPool(),
  now: Date = new Date(),
): Promise<ChannelManagerData | null> {
  const property = (
    await db.query(`SELECT channel_code, timezone FROM properties WHERE id = $1::uuid`, [propertyId])
  ).rows[0] as { channel_code: string; timezone: string } | undefined;
  if (!property) return null;
  const today = todayInZone(property.timezone, now);

  const installation = await activeInstallation(db, propertyId);
  const base = {
    propertyCode: property.channel_code,
    timezone: property.timezone,
    appName: "SiteMinder" as const,
  };
  if (!installation) {
    return {
      ...base,
      connected: false,
      connectedAt: null,
      upcomingCount: await upcomingUndeliveredCount(db, propertyId, today),
      roomsLinked: 0,
      roomsTotal: 0,
      lastUpdateAt: null,
      needsAttentionCount: 0,
    };
  }

  const rooms = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (
              WHERE EXISTS (SELECT 1 FROM app_inventory ai WHERE ai.room_id = r.id AND ai.date >= $2::date)
            )::int AS linked
       FROM rooms r
      WHERE r.property_id = $1::uuid AND r.is_active AND r.archived_at IS NULL`,
    [propertyId, today],
  );
  const updates = await db.query(
    `SELECT max(received_at) AS last_update_at FROM (
       SELECT max(ai.received_at) AS received_at
         FROM app_inventory ai JOIN rooms r ON r.id = ai.room_id WHERE r.property_id = $1::uuid
       UNION ALL
       SELECT max(ar.received_at)
         FROM app_rates ar JOIN rate_plans p ON p.id = ar.rate_plan_id JOIN rooms r ON r.id = p.room_id
        WHERE r.property_id = $1::uuid
       UNION ALL
       SELECT max(rs.received_at)
         FROM app_restrictions rs JOIN rate_plans p ON p.id = rs.rate_plan_id JOIN rooms r ON r.id = p.room_id
        WHERE r.property_id = $1::uuid
     ) u`,
    [propertyId],
  );
  const attention = await db.query(
    `SELECT count(*)::int AS n
       FROM app_booking_delivery d JOIN bookings b ON b.id = d.booking_id
      WHERE d.installation_id = $1::uuid AND d.status = 'needs_attention' AND b.check_out_date >= $2::date`,
    [installation.id, today],
  );
  const counts = rooms.rows[0] as { total: number; linked: number };
  const last = (updates.rows[0] as { last_update_at: Date | null }).last_update_at;

  return {
    ...base,
    connected: true,
    connectedAt: installation.connectedAt,
    upcomingCount: 0,
    roomsLinked: counts.linked,
    roomsTotal: counts.total,
    lastUpdateAt: last ? last.toISOString() : null,
    needsAttentionCount: (attention.rows[0] as { n: number }).n,
  };
}

/**
 * How one booking of `propertyId` stands with the hotel's app, for the booking
 * detail; null when no app was ever told, or the booking is another hotel's.
 */
export function loadBookingDelivery(bookingId: string, propertyId: string, db: Queryable = getPool()) {
  return deliveryForBooking(db, bookingId, { propertyId });
}

/**
 * Delivery status of bookings to a connected app (spec §1 "Delivery status"):
 * the app reports per booking delivered (with SiteMinder's acknowledgement
 * time), retrying or needs attention (with a reason). One row per installation
 * and booking in app_booking_delivery (0060).
 *
 * The availability rule (managed-sql.ts, spec §3) reads `status` and
 * `acknowledged_at`. 0060's `app_delivery_booking_changed` trigger puts a
 * delivered row back to `pending` when a delivery-relevant booking event is
 * written, in the booking's own transaction.
 */
import type { DeliveryReport } from "@openbookings/apps-contract";
import type { Queryable } from "../reservation-policy";
import type { Installation } from "./installations";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Store the app's latest report for one booking of its property and return
 * the status it replaced (null when there was no row), so a caller can act
 * only on the transition into `needs_attention`.
 *
 * `acknowledged_at` keeps the latest successful delivery (R10): a `delivered`
 * report moves it forward to the reported time, never back, so a Modify that
 * reached the channel restarts the availability rule's 3/30-minute window. Any
 * other report leaves it as it is. `detail` is the report's.
 *
 * A booking of another property, or none at all, is `unknown-booking` and
 * writes nothing.
 */
export async function recordDelivery(
  db: Queryable,
  installation: Installation,
  bookingId: string,
  report: DeliveryReport,
  now: Date,
): Promise<{ result: "ok"; previousStatus: string | null } | { result: "unknown-booking" }> {
  if (!UUID_RE.test(bookingId)) return { result: "unknown-booking" };
  const acknowledgedAt = report.status === "delivered" ? report.acknowledgedAt : null;
  const values = [installation.id, bookingId, report.status, acknowledgedAt, report.detail, now];

  // A first report inserts the row. The booking must belong to the installation's property.
  const inserted = await db.query(
    `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at, detail, updated_at)
     SELECT $1::uuid, b.id, $3, $4::timestamptz, $5, $6
       FROM bookings b
      WHERE b.id = $2::uuid AND b.hotel_id = $7::uuid
     ON CONFLICT (installation_id, booking_id) DO NOTHING
     RETURNING booking_id`,
    [...values, installation.propertyId],
  );
  if (inserted.rows.length > 0) return { result: "ok", previousStatus: null };

  // Otherwise the row exists (or the booking is not this property's). Lock it
  // to read the status being replaced, then update.
  const previous = (
    await db.query(
      `SELECT d.status
         FROM app_booking_delivery d
         JOIN bookings b ON b.id = d.booking_id
        WHERE d.installation_id = $1::uuid AND d.booking_id = $2::uuid AND b.hotel_id = $3::uuid
        FOR UPDATE OF d`,
      [installation.id, bookingId, installation.propertyId],
    )
  ).rows[0] as { status: string } | undefined;
  if (!previous) return { result: "unknown-booking" };

  await db.query(
    `UPDATE app_booking_delivery
        SET status = $3,
            acknowledged_at = CASE WHEN $3 = 'delivered'
                                   THEN GREATEST(acknowledged_at, $4::timestamptz)
                                   ELSE acknowledged_at END,
            detail = $5,
            updated_at = $6
      WHERE installation_id = $1::uuid AND booking_id = $2::uuid`,
    values,
  );
  return { result: "ok", previousStatus: previous.status };
}

/**
 * How the booking stands with its property's app, for the host's booking
 * page: the active installation's row, else the most recently updated one
 * (a disconnected app's last word). Null when no app was ever told.
 */
export async function deliveryForBooking(
  db: Queryable,
  bookingId: string,
): Promise<{ appKey: string; status: string; acknowledgedAt: string | null; detail: string | null } | null> {
  if (!UUID_RE.test(bookingId)) return null;
  const row = (
    await db.query(
      `SELECT ai.app_key, d.status, d.acknowledged_at, d.detail
         FROM app_booking_delivery d
         JOIN app_installations ai ON ai.id = d.installation_id
         JOIN bookings b ON b.id = d.booking_id AND b.hotel_id = ai.property_id
        WHERE d.booking_id = $1::uuid
        ORDER BY (ai.status = 'active') DESC, d.updated_at DESC
        LIMIT 1`,
      [bookingId],
    )
  ).rows[0] as { app_key: string; status: string; acknowledged_at: Date | null; detail: string | null } | undefined;
  if (!row) return null;
  return {
    appKey: row.app_key,
    status: row.status,
    acknowledgedAt: row.acknowledged_at ? row.acknowledged_at.toISOString() : null,
    detail: row.detail,
  };
}

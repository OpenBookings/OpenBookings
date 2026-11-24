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
import { DELIVERY_EVENT_KINDS } from "./feed";
import type { Installation } from "./installations";

/**
 * The acknowledgement to store, given the stored one: the reported time ($4,
 * NULL unless delivered) capped at now ($6), kept only if later. Spelled out
 * because LEAST/GREATEST skip NULLs: LEAST(NULL, now) would be now.
 */
const ACKNOWLEDGED_SQL = (stored: string) =>
  `CASE WHEN $4::timestamptz IS NULL THEN ${stored}
        ELSE GREATEST(${stored}, LEAST($4::timestamptz, $6::timestamptz)) END`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Store the app's latest report for one booking of its property. Returns the
 * status it replaced (null when there was no row) and the status now stored,
 * so a caller can act only on a real transition into `needs_attention`.
 *
 * - `delivered` for the booking's current version (R13: `report.version` ≥ the
 *   max seq of its delivery-relevant events) stores `delivered`. For an older
 *   version it stores `pending`: the channel holds the booking but not the
 *   newer change, so it must keep counting against the app's limit
 *   (managed-sql.ts settles only `delivered` rows).
 * - Either way a `delivered` report moves `acknowledged_at` forward, never
 *   back (R10), to the reported time capped at `now` (R15): a Modify that
 *   reached the channel restarts the availability rule's 3/30-minute window,
 *   and a clock running ahead cannot settle a booking early. Other reports
 *   leave it as it is. `detail` is the report's.
 * - A report for an older version than the booking's current one is ignored
 *   (no write, ok with the stored status) while the stored row is `delivered`
 *   (R16): a stale retrying/needs_attention must not overwrite a newer success.
 * - A `not_sent` row is never changed (spec §3b: permanently not sent); the
 *   report is accepted and ignored, previous and stored status `not_sent`.
 * - A booking of another property, or none at all, is `unknown-booking` and
 *   writes nothing.
 *
 * Pass a transaction (READ COMMITTED, the default), as with connectApp. The
 * booking row is locked FOR SHARE first: every writer of a delivery-relevant
 * event holds a stronger lock on it until it commits, so the version read next
 * includes any change in flight, and a change that starts later waits for this
 * report and then puts the row back to `pending` through 0060's trigger.
 */
export async function recordDelivery(
  db: Queryable,
  installation: Installation,
  bookingId: string,
  report: DeliveryReport,
  now: Date,
): Promise<{ result: "ok"; previousStatus: string | null; status: string } | { result: "unknown-booking" }> {
  if (!UUID_RE.test(bookingId)) return { result: "unknown-booking" };
  const booking = await db.query(`SELECT id FROM bookings WHERE id = $1::uuid AND hotel_id = $2::uuid FOR SHARE`, [
    bookingId,
    installation.propertyId,
  ]);
  if (booking.rows.length === 0) return { result: "unknown-booking" };

  const current = (
    await db.query(
      `SELECT COALESCE(max(seq), 0)::text AS version FROM booking_events WHERE booking_id = $1::uuid AND kind = ANY ($2::text[])`,
      [bookingId, DELIVERY_EVENT_KINDS],
    )
  ).rows[0] as { version: string };
  const stale = report.status === "delivered" && BigInt(report.version) < BigInt(current.version);
  const status = stale ? "pending" : report.status;
  const acknowledgedAt = report.status === "delivered" ? report.acknowledgedAt : null;
  const values = [installation.id, bookingId, status, acknowledgedAt, report.detail, now];

  // A first report inserts the row.
  const inserted = await db.query(
    `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at, detail, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, ${ACKNOWLEDGED_SQL("NULL")}, $5, $6)
     ON CONFLICT (installation_id, booking_id) DO NOTHING
     RETURNING booking_id`,
    values,
  );
  if (inserted.rows.length > 0) return { result: "ok", previousStatus: null, status };

  // Otherwise lock the row to read the status being replaced, then update.
  const previous = (
    await db.query(
      `SELECT status FROM app_booking_delivery WHERE installation_id = $1::uuid AND booking_id = $2::uuid FOR UPDATE`,
      [installation.id, bookingId],
    )
  ).rows[0] as { status: string };
  if (previous.status === "not_sent") return { result: "ok", previousStatus: "not_sent", status: "not_sent" };
  // R16: a report about an older version than the booking's current one must
  // not overwrite a stored success (a stale retrying/needs_attention, or a
  // delayed delivered for v1 after v2 was delivered). Accepted, nothing written.
  if (previous.status === "delivered" && BigInt(report.version) < BigInt(current.version)) {
    return { result: "ok", previousStatus: "delivered", status: "delivered" };
  }

  await db.query(
    `UPDATE app_booking_delivery
        SET status = $3,
            acknowledged_at = ${ACKNOWLEDGED_SQL("acknowledged_at")},
            detail = $5,
            updated_at = $6
      WHERE installation_id = $1::uuid AND booking_id = $2::uuid`,
    values,
  );
  return { result: "ok", previousStatus: previous.status, status };
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

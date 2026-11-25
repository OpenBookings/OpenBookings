/**
 * The core side of "a booking never silently fails to reach the hotel" (spec
 * anti-goal; R28). The app reports each booking's delivery, but an app that is
 * down, stuck or losing reports would leave a booking pending forever with
 * nobody told. A scheduled job (apps/business/app/api/cron/app-delivery-watchdog)
 * runs these:
 *
 *   flagUnconfirmedDeliveries  a booking the app should have by now (its last
 *                              change, or the connection, is over 30 minutes
 *                              old) whose delivery row is missing, pending or
 *                              retrying becomes needs_attention.
 *   claimUnmailedAlerts        a needs_attention row whose mail never went out
 *                              (the process died between the report's commit
 *                              and its mail) is claimed for mailing.
 *
 * Mail goes out at most once per move into needs_attention: `mailed_at` is
 * set when a sender claims the row (claimAlert / claimUnmailedAlerts) and
 * cleared when the row leaves needs_attention (recordDelivery).
 */
import type { Queryable } from "../reservation-policy";
import { DELIVERY_EVENT_KINDS } from "./feed";

/** How long the app has to confirm a booking change before the hotel is told. */
export const DELIVERY_DEADLINE_MINUTES = 30;
/** A needs_attention row younger than this is left to the route that just stored it. */
const ROUTE_GRACE_MINUTES = 2;

/**
 * Boolean: the app is expected to have booking `b` of property `p` for active
 * installation `ai`: a delivery-relevant change since connecting, or a stay
 * that was upcoming when it connected (the backfill; a hotel that chose not
 * to send those has `not_sent` rows instead). Bookings that ended before the
 * connection, or were already completed then, were never sent and never will
 * be. $kinds is DELIVERY_EVENT_KINDS.
 */
export const EXPECTED_DELIVERY_SQL = (kinds: string) => `(
    EXISTS (
      SELECT 1 FROM booking_events e
       WHERE e.booking_id = b.id AND e.kind = ANY (${kinds}::text[]) AND e.created_at > ai.connected_at
    )
    OR (
      -- The connect snapshot's own rule (upcomingBookings in installations.ts):
      -- a booking already completed then (checked out that day, or left early)
      -- was never in it.
      b.status::text IN ('confirmed', 'checked_in')
      AND b.check_out_date >= (ai.connected_at AT TIME ZONE p.timezone)::date
    )
  )`;

/**
 * Mark every overdue booking needs_attention. Returns the rows it moved there
 * (mail them with claimAlert). $1 now, $2 kinds.
 */
export async function flagUnconfirmedDeliveries(
  db: Queryable,
  now: Date,
): Promise<{ installationId: string; bookingId: string; propertyId: string; appKey: string; detail: string }[]> {
  const { rows } = await db.query(
    `WITH due AS (
       SELECT ai.id AS installation_id, b.id AS booking_id,
              'Not confirmed by ' || CASE ai.app_key WHEN 'siteminder' THEN 'SiteMinder' ELSE 'the channel manager' END
                || ' within ${DELIVERY_DEADLINE_MINUTES} minutes' AS detail
         FROM app_installations ai
         JOIN properties p ON p.id = ai.property_id
         JOIN bookings b   ON b.hotel_id = ai.property_id
         LEFT JOIN app_booking_delivery d ON d.installation_id = ai.id AND d.booking_id = b.id
         LEFT JOIN LATERAL (
           SELECT max(e.created_at) AS at FROM booking_events e
            WHERE e.booking_id = b.id AND e.kind = ANY ($2::text[])
         ) ev ON TRUE
        WHERE ai.status = 'active'
          AND (d.status IS NULL OR d.status IN ('pending', 'retrying'))
          AND ${EXPECTED_DELIVERY_SQL("$2")}
          AND GREATEST(ev.at, ai.connected_at) <= $1::timestamptz - INTERVAL '${DELIVERY_DEADLINE_MINUTES} minutes'
     )
     INSERT INTO app_booking_delivery AS d (installation_id, booking_id, status, detail, updated_at)
     SELECT installation_id, booking_id, 'needs_attention', detail, $1 FROM due
     ON CONFLICT (installation_id, booking_id) DO UPDATE
        SET status = 'needs_attention', detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at, mailed_at = NULL
      WHERE d.status IN ('pending', 'retrying')
     RETURNING d.installation_id, d.booking_id, d.detail,
               (SELECT ai.property_id FROM app_installations ai WHERE ai.id = d.installation_id) AS property_id,
               (SELECT ai.app_key FROM app_installations ai WHERE ai.id = d.installation_id) AS app_key`,
    [now, DELIVERY_EVENT_KINDS],
  );
  return (rows as { installation_id: string; booking_id: string; detail: string; property_id: string; app_key: string }[]).map(
    (r) => ({ installationId: r.installation_id, bookingId: r.booking_id, propertyId: r.property_id, appKey: r.app_key, detail: r.detail }),
  );
}

/**
 * Claim one row's needs-attention mail: true for exactly one caller per move
 * into needs_attention, false when it is mailed already or not in that state.
 */
export async function claimAlert(db: Queryable, i: { installationId: string; bookingId: string; now: Date }): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE app_booking_delivery SET mailed_at = $3
      WHERE installation_id = $1::uuid AND booking_id = $2::uuid
        AND status = 'needs_attention' AND mailed_at IS NULL
      RETURNING booking_id`,
    [i.installationId, i.bookingId, i.now],
  );
  return rows.length > 0;
}

/**
 * Claim every needs_attention row of an active installation whose mail never
 * went out (older than a short grace, so a report being mailed right now is
 * left to its route). The caller sends the mails.
 */
export async function claimUnmailedAlerts(
  db: Queryable,
  now: Date,
): Promise<{ installationId: string; bookingId: string; propertyId: string; appKey: string; detail: string | null }[]> {
  const { rows } = await db.query(
    `UPDATE app_booking_delivery d SET mailed_at = $1
       FROM app_installations ai
      WHERE ai.id = d.installation_id AND ai.status = 'active'
        AND d.status = 'needs_attention' AND d.mailed_at IS NULL
        AND d.updated_at <= $1::timestamptz - INTERVAL '${ROUTE_GRACE_MINUTES} minutes'
      RETURNING d.installation_id, d.booking_id, d.detail, ai.property_id, ai.app_key`,
    [now],
  );
  return (rows as { installation_id: string; booking_id: string; detail: string | null; property_id: string; app_key: string }[]).map(
    (r) => ({ installationId: r.installation_id, bookingId: r.booking_id, propertyId: r.property_id, appKey: r.app_key, detail: r.detail }),
  );
}

/**
 * SQL shared by the two availability readers — `STAY_AVAILABILITY_SQL`
 * (packages/db/src/availability.ts: search, quote, intents, confirmation) and
 * the host rates grid's `AVAILABILITY_SQL` (apps/business/.../ari-query.ts) —
 * so both decide alike what a property a connected app manages has to sell
 * (spec §3).
 *
 * Plain strings, spliced into those queries. They rely on these names being in
 * scope where they are spliced:
 *
 *   r            a rooms row (MANAGED_PROPERTY_SQL)
 *   scope_rooms  CTE: id, property_id, managed (SETTLED_BOOKED_SQL)
 *   nights       CTE: d date, one row per night counted (SETTLED_BOOKED_SQL)
 *   clock        CTE: now timestamptz, one row (SETTLED_BOOKED_SQL)
 *
 * `clock` is how "now" gets in: the stay query binds its `now` parameter, so
 * tests decide what time it is; it is never SQL now() there.
 */

/** Boolean: the room's property has an active app installation. */
export const MANAGED_PROPERTY_SQL = `EXISTS (
    SELECT 1 FROM app_installations ai
    WHERE ai.property_id = r.property_id
      AND ai.status = 'active'
  )`;

/**
 * CTE body: (room_id, date, units) — per room and night, our reservations the
 * app has already counted in the units left it sent, so they must not be taken
 * off that number again.
 *
 * Only managed rooms, and only reservations that hold stock (the same rule as
 * the `booked` CTE both queries keep beside it: holding status, room not
 * cancelled, nights after an early departure freed). A reservation night is
 * settled when its booking's delivery row for the property's active
 * installation
 *   - is `not_sent` (the hotel already had it when it connected), or
 *   - was acknowledged by the app, and either a limit for that room and night
 *     arrived at least 3 minutes after the acknowledgement (the app's rounds
 *     can carry a number computed before it saw ours), or 30 minutes have
 *     passed since it (silence means the number already included ours).
 * A booking with no delivery row yet is unsettled.
 */
export const SETTLED_BOOKED_SQL = `
  SELECT res.room_id, n.d AS date, COUNT(*)::int AS units
  FROM reservations res
  JOIN bookings b              ON b.id = res.booking_id
  JOIN scope_rooms sr          ON sr.id = res.room_id AND sr.managed
  JOIN nights n                ON n.d >= b.check_in_date
                              AND n.d < LEAST(b.check_out_date, COALESCE(b.departed_early_on + 1, b.check_out_date))
  JOIN app_installations ai    ON ai.property_id = sr.property_id AND ai.status = 'active'
  JOIN app_booking_delivery dl ON dl.installation_id = ai.id AND dl.booking_id = b.id
  LEFT JOIN app_inventory inv  ON inv.room_id = res.room_id AND inv.date = n.d
  CROSS JOIN clock
  WHERE b.status::text IN ('confirmed', 'checked_in', 'completed')
    AND res.cancelled_at IS NULL
    AND (
      dl.status = 'not_sent'
      OR (
        dl.acknowledged_at IS NOT NULL
        AND (
          inv.received_at >= dl.acknowledged_at + INTERVAL '3 minutes'
          OR clock.now >= dl.acknowledged_at + INTERVAL '30 minutes'
        )
      )
    )
  GROUP BY res.room_id, n.d
`;

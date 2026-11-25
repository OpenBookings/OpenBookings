/**
 * Disconnect keeps the app's last values (spec §7: "Disconnect returns control
 * to OpenBookings, keeping the last values received").
 *
 * While a property is managed, search, the quote and the host grid read the
 * app's tables (app_inventory, app_rates, app_restrictions) and ignore the
 * host's own. When the app is switched off they go back to the host's tables,
 * so `carryAppValues` first writes what the app last sent into those tables,
 * for every night from today (property time) through MAX_ARI_SPAN_DAYS (750)
 * nights, or up to the last night the app sent anything for if that is later.
 * Guests then see on every night what they saw while managed:
 *
 *   availability   room_inventory.available_override = units left + our bookings
 *                  the app had settled (SETTLED_BOOKED_SQL, judged now). Managed
 *                  stock was units left + settled − booked − held; unmanaged is
 *                  override − booked − held, so the two agree. A night the app
 *                  never sent stock for gets 0, as it was closed while managed.
 *   prices         rate_overrides, one row per run of equal prices on
 *                  consecutive nights (not one per night).
 *   closures       rate_plan_restrictions with is_closed for nights the app
 *                  closed or never priced (both unsellable while managed).
 *   restrictions   rate_plan_restrictions for closed to arrival/departure and
 *                  min/max stay, again one row per run of equal values. The
 *                  host's rules are arrival-based only, so a stay-through limit
 *                  becomes an arrival limit on the same night (the larger
 *                  minimum, the smaller maximum): a stay arriving that night is
 *                  still held to it, a stay arriving earlier and running
 *                  through it no longer is.
 *
 * Last values win: host rows of these tables (and room_closures, which a
 * managed room ignores too) that cover a carried night are cut back to the
 * nights around the window, or switched off (`is_active = false`, kept as
 * history) when they lie wholly inside it.
 *
 * Where the app sent no minimum stay, a plan with a default minimum gets
 * min stay 1 for the night, so the default (ignored while managed) stays off.
 *
 * Not carried: per-night extra-guest fees (the room's own fees apply again);
 * a plan's default maximum stay where the app sent none (no host value means
 * "no maximum" over a default), and the hotel's pricing rules apply again. Nothing at all is carried when the
 * app never sent anything for today or later.
 *
 * Runs inside the disconnect's transaction, before the installation is
 * switched off (the settled rule reads the active installation).
 */
import { MAX_ARI_SPAN_DAYS } from "@openbookings/apps-contract";
import { todayInZone } from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";
import { SETTLED_BOOKED_SQL } from "./managed-sql";

/** $1 property id. */
const PROPERTY_ROOMS = `SELECT r.id FROM rooms r WHERE r.property_id = $1::uuid AND r.archived_at IS NULL`;
const PROPERTY_PLANS = `
  SELECT p.id FROM rate_plans p JOIN rooms r ON r.id = p.room_id
   WHERE r.property_id = $1::uuid AND r.archived_at IS NULL AND p.archived_at IS NULL`;

/** $1 property id, $2 today: the last night the app sent anything for, or null. */
const HORIZON_SQL = `
  SELECT max(d)::text AS horizon FROM (
    SELECT max(x.date) AS d FROM app_inventory x WHERE x.room_id IN (${PROPERTY_ROOMS}) AND x.date >= $2::date
    UNION ALL
    SELECT max(x.date) FROM app_rates x WHERE x.rate_plan_id IN (${PROPERTY_PLANS}) AND x.date >= $2::date
    UNION ALL
    SELECT max(x.date) FROM app_restrictions x WHERE x.rate_plan_id IN (${PROPERTY_PLANS}) AND x.date >= $2::date
  ) ends`;

/** $1 property id, $2 from, $3 to, $4 now. */
const INVENTORY_SQL = `
  WITH nights AS (SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS d),
  clock AS (SELECT $4::timestamptz AS now),
  scope_rooms AS (
    SELECT r.id, r.property_id, true AS managed FROM rooms r
     WHERE r.property_id = $1::uuid AND r.archived_at IS NULL
  ),
  settled AS (${SETTLED_BOOKED_SQL})
  INSERT INTO room_inventory (room_id, date, available_override, updated_by, updated_at)
  SELECT sr.id, n.d,
         CASE WHEN ainv.units_left IS NULL THEN 0
              ELSE GREATEST(0, ainv.units_left + COALESCE(st.units, 0)) END,
         NULL, $4::timestamptz
    FROM scope_rooms sr
   CROSS JOIN nights n
    LEFT JOIN app_inventory ainv ON ainv.room_id = sr.id AND ainv.date = n.d
    LEFT JOIN settled st         ON st.room_id = sr.id AND st.date = n.d
  ON CONFLICT (room_id, date) DO UPDATE
     SET available_override = EXCLUDED.available_override,
         updated_by = NULL,
         updated_at = EXCLUDED.updated_at`;

/**
 * Per plan and night of the window: the app's price (null: none) and the host
 * rule it amounts to. $1 property id, $2 from, $3 to.
 */
const PLAN_NIGHTS = `
  plans AS (
    SELECT p.id, p.min_stay FROM rate_plans p JOIN rooms r ON r.id = p.room_id
     WHERE r.property_id = $1::uuid AND r.archived_at IS NULL AND p.archived_at IS NULL
  ),
  plan_nights AS (
    SELECT p.id AS plan_id, n.d,
           ar.price_cents,
           (ar.rate_plan_id IS NULL OR COALESCE(rs.is_closed, false))      AS closed,
           -- The plan's own minimum did not apply while managed: 1 keeps it off.
           COALESCE(GREATEST(rs.min_stay_arrival, rs.min_stay_through),
                    CASE WHEN p.min_stay > 1 THEN 1 END)                   AS min_stay,
           LEAST(rs.max_stay_arrival, rs.max_stay_through)                 AS max_stay,
           COALESCE(rs.closed_to_arrival, false)                           AS cta,
           COALESCE(rs.closed_to_departure, false)                         AS ctd
      FROM plans p
     CROSS JOIN generate_series($2::date, $3::date, INTERVAL '1 day') AS g(day)
     CROSS JOIN LATERAL (SELECT g.day::date AS d) n
      LEFT JOIN app_rates ar        ON ar.rate_plan_id = p.id AND ar.date = n.d
      LEFT JOIN app_restrictions rs ON rs.rate_plan_id = p.id AND rs.date = n.d
  )`;

/**
 * Runs of consecutive nights with equal values become one row each: nights
 * whose date minus their rank within (plan, values) is the same are one run.
 */
const PRICES_SQL = `
  WITH ${PLAN_NIGHTS},
  runs AS (
    SELECT plan_id, d, price_cents,
           d - (row_number() OVER (PARTITION BY plan_id, price_cents ORDER BY d))::int AS run
      FROM plan_nights WHERE price_cents IS NOT NULL
  )
  INSERT INTO rate_overrides (rate_plan_id, label, start_date, end_date, price_per_night_cents, priority, is_active)
  SELECT plan_id, $4, min(d), max(d), price_cents, 0, true
    FROM runs GROUP BY plan_id, price_cents, run`;

const CLOSURES_SQL = `
  WITH ${PLAN_NIGHTS},
  runs AS (
    SELECT plan_id, d, d - (row_number() OVER (PARTITION BY plan_id ORDER BY d))::int AS run
      FROM plan_nights WHERE closed
  )
  INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, is_closed, priority, is_active, note)
  SELECT plan_id, min(d), max(d), true, 0, true, $4
    FROM runs GROUP BY plan_id, run`;

const RESTRICTIONS_SQL = `
  WITH ${PLAN_NIGHTS},
  runs AS (
    SELECT plan_id, d, min_stay, max_stay, cta, ctd,
           d - (row_number() OVER (PARTITION BY plan_id, min_stay, max_stay, cta, ctd ORDER BY d))::int AS run
      FROM plan_nights
     WHERE min_stay IS NOT NULL OR max_stay IS NOT NULL OR cta OR ctd
  )
  INSERT INTO rate_plan_restrictions
    (rate_plan_id, start_date, end_date, is_closed, min_stay, max_stay, closed_to_arrival, closed_to_departure,
     priority, is_active, note)
  SELECT plan_id, min(d), max(d), false, min_stay, max_stay, cta, ctd, 0, true, $4
    FROM runs GROUP BY plan_id, min_stay, max_stay, cta, ctd, run`;

/** A host table of date ranges, and the columns a split-off copy keeps. */
type RangeTable = { table: string; key: string; keys: string; copy: string[] };

const RANGE_TABLES: RangeTable[] = [
  {
    table: "rate_overrides",
    key: "rate_plan_id",
    keys: PROPERTY_PLANS,
    copy: ["rate_plan_id", "label", "price_per_night_cents", "priority", "is_active", "created_at", "created_by"],
  },
  {
    table: "rate_plan_restrictions",
    key: "rate_plan_id",
    keys: PROPERTY_PLANS,
    copy: [
      "rate_plan_id", "is_closed", "min_stay", "max_stay", "closed_to_arrival", "closed_to_departure",
      "priority", "is_active", "note", "created_by", "created_at",
    ],
  },
  {
    table: "room_closures",
    key: "room_id",
    keys: PROPERTY_ROOMS,
    copy: ["room_id", "priority", "is_active", "note", "created_by", "created_at"],
  },
];

/**
 * Clear the window [$2, $3] in one host range table: a row running across
 * both ends is split (the part after the window becomes a copy), a row
 * overlapping one end is cut back, and a row wholly inside is switched off.
 */
async function clearWindow(db: Queryable, t: RangeTable, params: unknown[]): Promise<void> {
  const scope = `${t.key} IN (${t.keys}) AND is_active`;
  const cols = t.copy.join(", ");
  await db.query(
    `INSERT INTO ${t.table} (${cols}, start_date, end_date)
     SELECT ${cols}, $3::date + 1, end_date FROM ${t.table}
      WHERE ${scope} AND start_date < $2::date AND end_date > $3::date`,
    params,
  );
  await db.query(
    `UPDATE ${t.table} SET end_date = $2::date - 1
      WHERE ${scope} AND start_date < $2::date AND end_date >= $2::date`,
    params.slice(0, 2),
  );
  await db.query(
    `UPDATE ${t.table} SET start_date = $3::date + 1
      WHERE ${scope} AND start_date >= $2::date AND start_date <= $3::date AND end_date > $3::date`,
    params,
  );
  await db.query(
    `UPDATE ${t.table} SET is_active = false
      WHERE ${scope} AND start_date >= $2::date AND end_date <= $3::date`,
    params,
  );
}

/**
 * Write the app's last values into the host tables (see the file comment).
 * Returns the nights covered, or null when the app sent nothing to carry.
 */
export async function carryAppValues(
  db: Queryable,
  i: { propertyId: string; now: Date; appDisplayName: string },
): Promise<{ from: string; to: string } | null> {
  const property = (await db.query(`SELECT timezone FROM properties WHERE id = $1::uuid`, [i.propertyId])).rows[0] as
    | { timezone: string }
    | undefined;
  if (!property) return null;
  const from = todayInZone(property.timezone, i.now);
  const horizon = ((await db.query(HORIZON_SQL, [i.propertyId, from])).rows[0] as { horizon: string | null }).horizon;
  // The app never sent anything for today or later: it never managed these
  // rooms' future, so the hotel's own values stand.
  if (!horizon) return null;
  // Otherwise at least SiteMinder's whole horizon: nights it never covered
  // were closed while managed (no stock, no price) and stay closed, rather
  // than reopening with the hotel's old stock and prices.
  const to = (
    (await db.query(`SELECT GREATEST($1::date, $2::date + ($3::int - 1))::text AS to`, [horizon, from, MAX_ARI_SPAN_DAYS]))
      .rows[0] as { to: string }
  ).to;

  await db.query(INVENTORY_SQL, [i.propertyId, from, to, i.now]);
  for (const t of RANGE_TABLES) await clearWindow(db, t, [i.propertyId, from, to]);
  const label = `Last value from ${i.appDisplayName}`;
  await db.query(PRICES_SQL, [i.propertyId, from, to, label]);
  await db.query(CLOSURES_SQL, [i.propertyId, from, to, label]);
  await db.query(RESTRICTIONS_SQL, [i.propertyId, from, to, label]);
  return { from, to };
}

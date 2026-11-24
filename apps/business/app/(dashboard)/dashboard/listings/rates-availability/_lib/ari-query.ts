import { CURRENT_PROPERTY_SQL, getPropertyScopedDb, type SessionLike } from "@openbookings/authz";
import { MANAGED_NIGHT_PRICE_SQL, MANAGED_PROPERTY_SQL, SETTLED_BOOKED_SQL } from "@openbookings/db/apps";
import {
  bookableUnits,
  hasStayLengthDiscount,
  nightTotal,
  resolveNightlyRates,
  todayInZone,
  type Modifier,
  type NightlyRate,
} from "@openbookings/pricing";
import { applyLowestRates, deriveStatus, resolveStatus } from "./derive";
import type { PricingRule } from "./rule-copy";
import type {
  AriGridData,
  AvailabilityCell,
  RateCell,
  RatePlanRow,
  RestrictionRule,
  RoomClosureRule,
  RoomTypeRow,
} from "./types";

/**
 * The ARI grid's read layer.
 *
 * Two queries, regardless of how many room types, rate plans, or dates are on
 * screen — one for availability (a room-type fact) and one for pricing (a
 * rate-plan fact). They are separate because they answer different questions
 * against different grains, not because of a round-trip budget: fusing them
 * would multiply every availability row by the rate-plan count for no gain.
 *
 * Both are bound to the current hotel through getPropertyScopedDb: `$1` is
 * the user, `$2` the hotel (CURRENT_PROPERTY_SQL), callers' own params start
 * at `$3`.
 */

// ─────────────────────────────────────────────
// Row shapes as they come back from Postgres
// ─────────────────────────────────────────────

/**
 * Money columns here are `bigint`, and node-postgres hands `int8` back as a
 * *string* — it cannot know the value fits in a JS number, so it refuses to
 * guess. Typing those fields `number` does not make them numbers; it only stops
 * the compiler from telling you they aren't. The damage is silent: `+` on a
 * string concatenates, so three €199 nights summed to "0199199199" and a
 * 3-night cell rendered €66,399,733 while the 1-night view looked perfect.
 *
 * So the row types say `string`, and every value crosses into the domain
 * through here. Prices are whole cents, well inside 2^53; the precision
 * bigint exists to protect is not in play at the scale of a nightly rate.
 *
 * The availability query needs none of this — its counts are `integer`, and its
 * one aggregate is already cast with `COUNT(*)::int`.
 */
function toNumber(value: string): number {
  return Number(value);
}

interface AvailabilityQueryRow {
  room_id: string;
  room_name: string;
  room_type: string | null;
  base_occupancy: number;
  total_units: number;
  /** rooms.is_active: published. Drafts are listed so they can be priced, but are not on sale. */
  on_sale: boolean;
  date: string;
  effective_total: number;
  booked: number;
  held: number;
  blocked: number;
  available_override: number | null;
  note: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
  closure_id: string | null;
  closure_start: string | null;
  closure_end: string | null;
  closure_note: string | null;
  closure_by: string | null;
  closure_by_name: string | null;
  closure_at: string | null;
  /** The property has an active app installation (SiteMinder): the next two replace our own stock. */
  managed: boolean;
  /** app_inventory.units_left; null when the app never sent this night. */
  units_left: number | null;
  /** Of `booked`, the reservations the app has already counted in `units_left`. */
  settled_booked: number;
}

/**
 * One room type on one night. The host's number (`available_override`) is the
 * night's total and never moves by itself; what goes down is what is left to
 * book: total - booked - held. The same two functions decide it for guests.
 *
 * On a managed property the total is the app's units left plus the bookings it
 * has settled, as in loadStayAvailability (@openbookings/db).
 */
export function buildAvailabilityCell(
  row: Pick<
    AvailabilityQueryRow,
    | "date"
    | "total_units"
    | "effective_total"
    | "booked"
    | "held"
    | "blocked"
    | "available_override"
    | "note"
    | "updated_by"
    | "updated_by_name"
    | "updated_at"
  > &
    Partial<Pick<AvailabilityQueryRow, "managed" | "units_left" | "settled_booked">>,
  closure: RoomClosureRule | null,
): AvailabilityCell {
  const override = row.available_override;
  const total = nightTotal({
    override,
    totalRooms: row.effective_total,
    totalUnits: row.total_units,
    blocked: row.blocked,
    managed: row.managed
      ? { unitsLeft: row.units_left ?? null, settledBooked: row.settled_booked ?? 0 }
      : undefined,
  });
  const left = bookableUnits({ total, booked: row.booked, held: row.held });
  return {
    date: row.date,
    totalUnits: row.effective_total,
    booked: row.booked,
    held: row.held,
    blocked: row.blocked,
    computed: Math.max(0, row.effective_total - row.booked - row.blocked),
    override,
    total,
    left,
    effective: left,
    source: override === null ? "computed" : "override",
    note: row.note,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at,
    closure,
  };
}

export interface RateQueryRow {
  room_id: string;
  rate_plan_id: string;
  rate_plan_name: string;
  currency: string;
  /** bigint column, cents — see `toNumber`. */
  bar_cents: string;
  is_refundable: boolean;
  /** 1 and null on a managed plan: the app's restrictions replace the plan's own. */
  plan_min_stay: number;
  plan_max_stay: number | null;
  base_occupancy: number;
  /** Room published and plan active: what guests can actually book. */
  on_sale: boolean;
  date: string;
  /**
   * bigint column, cents — see `toNumber`. Null only on a managed plan's
   * night the app sent no price for (`priced` false).
   */
  base_price_cents: string | null;
  has_override: boolean;
  override_label: string | null;
  closure_id: string | null;
  closure_start: string | null;
  closure_end: string | null;
  closure_note: string | null;
  closure_by: string | null;
  closure_by_name: string | null;
  closure_at: string | null;
  restriction_id: string | null;
  restriction_start: string | null;
  restriction_end: string | null;
  restriction_min_stay: number | null;
  restriction_max_stay: number | null;
  restriction_cta: boolean | null;
  restriction_ctd: boolean | null;
  restriction_note: string | null;
  restriction_by: string | null;
  restriction_by_name: string | null;
  restriction_at: string | null;
  /**
   * The property has an active app installation (SiteMinder): the plan's
   * price is the app's (MANAGED_NIGHT_PRICE_SQL) and its rules are the app's
   * restrictions below, never our own closures and restrictions.
   */
  managed: boolean;
  /** False only on a managed night without an app price: closed, as for guests. */
  priced: boolean;
  /** app_restrictions for this night; all null/false when unmanaged or not sent. */
  app_closed: boolean | null;
  app_cta: boolean | null;
  app_ctd: boolean | null;
  app_min_stay_arrival: number | null;
  app_max_stay_arrival: number | null;
  app_min_stay_through: number | null;
  app_max_stay_through: number | null;
  app_received_at: string | null;
}

/** Every rule on a plan, switched off ones too; only active ones are priced. */
export type ModifierWithId = Modifier & { id: string; is_active: boolean };

interface ModifierQueryRow {
  rate_plan_id: string;
  modifiers: ModifierWithId[] | string;
}

interface PropertyRow {
  id: string;
  name: string;
  timezone: string;
}

// ─────────────────────────────────────────────
// Query 1 — availability across room types × dates
// ─────────────────────────────────────────────

/**
 * One row per room type per date. `room_inventory` is sparse — most dates have
 * no row — so the date spine is generated and left-joined, never assumed.
 *
 * `booked` counts reservations on bookings that actually hold stock. Pending
 * bookings deliberately do not: they have not been paid for and holding
 * inventory against them would show hosts a lower number than they can sell.
 *
 * A room on a property a connected app manages also carries the app's units
 * left and the bookings the app has settled (MANAGED_PROPERTY_SQL,
 * SETTLED_BOOKED_SQL, shared with loadStayAvailability), and its room closures
 * are ignored. "Now" is the transaction's now(), as for `held`.
 */
export const AVAILABILITY_SQL = `
WITH dates AS (
  SELECT generate_series($3::date, $4::date, INTERVAL '1 day')::date AS d
),
nights AS (
  SELECT d FROM dates
),
clock AS (
  SELECT now() AS now
),
-- Draft (unpublished) rooms are included: R&A is where a new room type gets
-- its prices, and it has to be priced before it can go on sale. Archived rooms
-- are gone for good. on_sale tells the grid which is which.
scope_rooms AS (
  SELECT r.id, r.property_id, r.name, r.room_type, r.base_occupancy, r.total_units, r.is_active AS on_sale,
         ${MANAGED_PROPERTY_SQL} AS managed
  FROM rooms r
  JOIN properties p ON p.id = r.property_id
  WHERE ${CURRENT_PROPERTY_SQL}
    AND r.archived_at IS NULL
),
booked AS (
  SELECT res.room_id, d.d AS date, COUNT(*)::int AS units
  FROM reservations res
  JOIN bookings b ON b.id = res.booking_id
  JOIN scope_rooms sr ON sr.id = res.room_id
  -- A guest who left early frees the nights after the last one they stayed.
  JOIN dates d ON d.d >= b.check_in_date
              AND d.d < LEAST(b.check_out_date, COALESCE(b.departed_early_on + 1, b.check_out_date))
  -- Rooms cancel one by one (0027): a cancelled room holds nothing.
  -- As text: see HOLDING_STATUSES in rooms/_lib/mutations.ts.
  WHERE b.status::text IN ('confirmed', 'checked_in', 'completed')
    AND res.cancelled_at IS NULL
  GROUP BY res.room_id, d.d
),
-- One unit per room of an open, unexpired booking intent, for each night it
-- covers. Mirrors the held CTE in packages/db/src/availability.ts.
held AS (
  SELECT bir.room_id, d.d AS date, COUNT(*)::int AS units
  FROM booking_intent_rooms bir
  JOIN booking_intents bi ON bi.id = bir.intent_id
  JOIN scope_rooms sr ON sr.id = bir.room_id
  JOIN dates d ON d.d >= bi.check_in_date AND d.d < bi.check_out_date
  WHERE bi.status = 'open'
    AND bi.hold_expires_at > now()
  GROUP BY bir.room_id, d.d
),
settled AS (${SETTLED_BOOKED_SQL})
SELECT
  sr.id                                        AS room_id,
  sr.name                                      AS room_name,
  sr.room_type,
  sr.base_occupancy,
  sr.total_units,
  sr.on_sale,
  d.d::text                                    AS date,
  COALESCE(inv.total_rooms, sr.total_units)    AS effective_total,
  COALESCE(bk.units, 0)                        AS booked,
  COALESCE(h.units, 0)                         AS held,
  COALESCE(inv.blocked_rooms, 0)               AS blocked,
  inv.available_override,
  inv.note,
  inv.updated_by,
  u.name                                       AS updated_by_name,
  inv.updated_at,
  rc.id                                        AS closure_id,
  rc.start_date::text                          AS closure_start,
  rc.end_date::text                            AS closure_end,
  rc.note                                      AS closure_note,
  rc.created_by                                AS closure_by,
  cu.name                                      AS closure_by_name,
  rc.created_at                                AS closure_at,
  sr.managed,
  ainv.units_left,
  COALESCE(st.units, 0)                        AS settled_booked
FROM scope_rooms sr
CROSS JOIN dates d
LEFT JOIN room_inventory inv ON inv.room_id = sr.id AND inv.date = d.d
LEFT JOIN booked bk          ON bk.room_id  = sr.id AND bk.date = d.d
LEFT JOIN held h             ON h.room_id   = sr.id AND h.date  = d.d
LEFT JOIN app_inventory ainv ON sr.managed AND ainv.room_id = sr.id AND ainv.date = d.d
LEFT JOIN settled st         ON st.room_id  = sr.id AND st.date = d.d
LEFT JOIN "user" u           ON u.id = inv.updated_by
-- The room-type closure, which cascades to every rate plan on the room. Read
-- here rather than in the rates query: it is a room-type fact, and fetching it
-- once per room-date beats fetching it again for each plan underneath.
LEFT JOIN LATERAL (
  SELECT id, start_date, end_date, note, created_by, created_at
  FROM room_closures
  WHERE room_id = sr.id
    AND start_date <= d.d
    AND end_date   >= d.d
    AND is_active
    AND NOT sr.managed
  ORDER BY priority DESC
  LIMIT 1
) rc ON TRUE
LEFT JOIN "user" cu          ON cu.id = rc.created_by
ORDER BY sr.name, d.d
`;

// ─────────────────────────────────────────────
// Query 2 — base prices and rules across rate plans × dates
// ─────────────────────────────────────────────

/**
 * One row per rate plan per date, carrying the base price and any rules that
 * cover the date. Modifiers are *not* joined here — they are per-plan, not
 * per-date, and joining them would repeat the same jsonb blob across every
 * column in the range. They come back in a separate small query and are
 * applied in TS.
 *
 * Closures and restrictions get their own LATERAL each rather than a single
 * "winning row". They are independent facts — a date can be both closed and
 * carry a min-stay — and collapsing them would throw away whichever lost.
 *
 * On a plan a connected app manages, the price is the app's for that night
 * (MANAGED_NIGHT_PRICE_SQL, shared with guest search and the stay quote), and
 * the rules are the app's restrictions for that night (app_restrictions), as
 * loadStayAvailability reads them; our own closures, restrictions and the
 * plan's min/max stay are ignored. A managed night without an app price comes
 * back unpriced and is shown closed.
 */
export const RATES_SQL = `
WITH dates AS (
  SELECT generate_series($3::date, $4::date, INTERVAL '1 day')::date AS d
),
-- Inactive plans and draft rooms are included for the same reason as in
-- AVAILABILITY_SQL: a rate is priced here before it is switched on. Archived
-- ones are not.
scope_plans AS (
  SELECT
    rp.id, rp.name, rp.bar_cents, rp.currency, rp.is_refundable,
    rp.min_stay, rp.max_stay,
    (r.is_active AND rp.is_active) AS on_sale,
    r.id AS room_id, r.name AS room_name, r.base_occupancy,
    ${MANAGED_PROPERTY_SQL} AS managed
  FROM rate_plans rp
  JOIN rooms r      ON r.id = rp.room_id
  JOIN properties p ON p.id = r.property_id
  WHERE ${CURRENT_PROPERTY_SQL}
    AND r.archived_at IS NULL
    AND rp.archived_at IS NULL
)
SELECT
  sp.room_id,
  sp.id                            AS rate_plan_id,
  sp.name                          AS rate_plan_name,
  sp.currency,
  sp.bar_cents,
  sp.is_refundable,
  CASE WHEN sp.managed THEN 1 ELSE sp.min_stay END    AS plan_min_stay,
  CASE WHEN sp.managed THEN NULL ELSE sp.max_stay END AS plan_max_stay,
  sp.base_occupancy,
  sp.on_sale,
  d.d::text                        AS date,
  price.base_price_cents,
  price.has_override,
  price.override_label,
  cl.id                            AS closure_id,
  cl.start_date::text              AS closure_start,
  cl.end_date::text                AS closure_end,
  cl.note                          AS closure_note,
  cl.created_by                    AS closure_by,
  cu.name                          AS closure_by_name,
  cl.created_at                    AS closure_at,
  rs.id                            AS restriction_id,
  rs.start_date::text              AS restriction_start,
  rs.end_date::text                AS restriction_end,
  rs.min_stay                      AS restriction_min_stay,
  rs.max_stay                      AS restriction_max_stay,
  rs.closed_to_arrival             AS restriction_cta,
  rs.closed_to_departure           AS restriction_ctd,
  rs.note                          AS restriction_note,
  rs.created_by                    AS restriction_by,
  ru.name                          AS restriction_by_name,
  rs.created_at                    AS restriction_at,
  sp.managed,
  price.priced,
  ars.is_closed                    AS app_closed,
  ars.closed_to_arrival            AS app_cta,
  ars.closed_to_departure          AS app_ctd,
  ars.min_stay_arrival             AS app_min_stay_arrival,
  ars.max_stay_arrival             AS app_max_stay_arrival,
  ars.min_stay_through             AS app_min_stay_through,
  ars.max_stay_through             AS app_max_stay_through,
  ars.received_at                  AS app_received_at
FROM scope_plans sp
CROSS JOIN dates d
CROSS JOIN LATERAL (
  SELECT sp.id AS rate_plan_id, sp.bar_cents, sp.managed, d.d AS date
) plan_night
CROSS JOIN LATERAL (${MANAGED_NIGHT_PRICE_SQL}) price
LEFT JOIN LATERAL (
  SELECT id, start_date, end_date, note, created_by, created_at
  FROM rate_plan_restrictions
  WHERE rate_plan_id = sp.id
    AND start_date <= d.d
    AND end_date   >= d.d
    AND is_active
    AND is_closed
    AND NOT sp.managed
  ORDER BY priority DESC
  LIMIT 1
) cl ON TRUE
LEFT JOIN LATERAL (
  SELECT id, start_date, end_date, min_stay, max_stay,
         closed_to_arrival, closed_to_departure, note, created_by, created_at
  FROM rate_plan_restrictions
  WHERE rate_plan_id = sp.id
    AND start_date <= d.d
    AND end_date   >= d.d
    AND is_active
    AND NOT is_closed
    AND NOT sp.managed
  ORDER BY priority DESC
  LIMIT 1
) rs ON TRUE
LEFT JOIN app_restrictions ars ON sp.managed AND ars.rate_plan_id = sp.id AND ars.date = d.d
LEFT JOIN "user" cu ON cu.id = cl.created_by
LEFT JOIN "user" ru ON ru.id = rs.created_by
ORDER BY sp.room_name, sp.name, d.d
`;

/** Every rule on each plan, switched off ones too (the editor lists them); pricing keeps the active ones. */
export const MODIFIERS_SQL = `
SELECT
  m.rate_plan_id,
  jsonb_agg(
    jsonb_build_object(
      'id',                m.id,
      'is_active',         m.is_active,
      'type',              m.type,
      'adjustment_type',   m.adjustment_type,
      'adjustment_value',  m.adjustment_value,
      'trigger_condition', m.trigger_condition,
      'sort_order',        m.sort_order
    )
    ORDER BY m.sort_order
  ) AS modifiers
FROM rate_modifiers m
JOIN rate_plans rp ON rp.id = m.rate_plan_id
JOIN rooms r       ON r.id = rp.room_id
JOIN properties p  ON p.id = r.property_id
WHERE ${CURRENT_PROPERTY_SQL}
GROUP BY m.rate_plan_id
`;

/**
 * A fingerprint of every host-set rule the rendered window depends on.
 *
 * Staged edits are published against the grid the host was looking at. If
 * somebody else moved a price or reopened a date in the meantime, publishing
 * blind would overwrite their work with decisions made about a screen that is
 * no longer true — and on an inventory screen that means rooms sold at last
 * week's rate, or closed dates quietly reopened.
 *
 * Digesting the mutable fields rather than a max timestamp is deliberate:
 * `is_active` soft deletes touch no timestamp, so a "latest change" clock
 * cannot see a reopened date at all.
 *
 * Scoped to the window, not the property: an edit to next winter has no
 * bearing on a host publishing this week, and invalidating them against each
 * other only teaches people to ignore the warning.
 */
export const VERSION_SQL = `
WITH scope_rooms AS (
  SELECT r.id
  FROM rooms r
  JOIN properties p ON p.id = r.property_id
  WHERE ${CURRENT_PROPERTY_SQL} AND r.archived_at IS NULL
),
signatures AS (
  SELECT 'o' || ro.id::text || ro.price_per_night_cents::text || ro.is_active::text
           || ro.start_date::text || ro.end_date::text || ro.priority::text AS sig
  FROM rate_overrides ro
  JOIN rate_plans rp ON rp.id = ro.rate_plan_id
  JOIN scope_rooms sr ON sr.id = rp.room_id
  WHERE ro.start_date <= $4::date AND ro.end_date >= $3::date

  UNION ALL
  SELECT 'r' || rs.id::text || rs.is_active::text || rs.is_closed::text
           || COALESCE(rs.min_stay::text, '-') || COALESCE(rs.max_stay::text, '-')
           || rs.closed_to_arrival::text || rs.closed_to_departure::text
           || rs.start_date::text || rs.end_date::text || rs.priority::text AS sig
  FROM rate_plan_restrictions rs
  JOIN rate_plans rp ON rp.id = rs.rate_plan_id
  JOIN scope_rooms sr ON sr.id = rp.room_id
  WHERE rs.start_date <= $4::date AND rs.end_date >= $3::date

  UNION ALL
  SELECT 'c' || rc.id::text || rc.is_active::text
           || rc.start_date::text || rc.end_date::text || rc.priority::text AS sig
  FROM room_closures rc
  JOIN scope_rooms sr ON sr.id = rc.room_id
  WHERE rc.start_date <= $4::date AND rc.end_date >= $3::date

  UNION ALL
  SELECT 'i' || inv.id::text || COALESCE(inv.total_rooms::text, '-')
           || inv.blocked_rooms::text || COALESCE(inv.available_override::text, '-') AS sig
  FROM room_inventory inv
  JOIN scope_rooms sr ON sr.id = inv.room_id
  WHERE inv.date BETWEEN $3::date AND $4::date
)
SELECT COALESCE(md5(string_agg(sig, '|' ORDER BY sig)), 'empty') AS version
FROM signatures
`;

// ─────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────

export interface AriRange {
  /** Inclusive ISO date. */
  start: string;
  /** Inclusive ISO date. */
  end: string;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/** Inclusive list of ISO dates, used as the grid's column spine. */
export function enumerateDates(range: AriRange): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${range.start}T00:00:00Z`);
  const end = new Date(`${range.end}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function parseModifiers(value: ModifierWithId[] | string): ModifierWithId[] {
  return typeof value === "string" ? (JSON.parse(value) as ModifierWithId[]) : value;
}

function toPricingRule(m: ModifierWithId): PricingRule {
  return {
    id: m.id,
    type: m.type,
    adjustmentType: m.adjustment_type,
    adjustmentValue: Number(m.adjustment_value),
    triggerCondition: m.trigger_condition,
    active: m.is_active,
  };
}

function ruleFrom(
  id: string | null,
  start: string | null,
  end: string | null,
  fields: Partial<RestrictionRule>,
): RestrictionRule | null {
  if (!id || !start || !end) return null;
  return {
    id,
    startDate: start,
    endDate: end,
    isClosed: false,
    minStay: null,
    maxStay: null,
    closedToArrival: false,
    closedToDeparture: false,
    note: null,
    createdBy: null,
    createdByName: null,
    createdAt: start,
    ...fields,
  };
}

/** What a plan's cells need from the rest of the grid. */
export interface RatePlanContext {
  /** Nights each cell is priced over. */
  stayLength: number;
  today: string;
  /** Whether a date gets a column; the rest is the probe's overhang. */
  isVisible: (date: string) => boolean;
  /** The room type's units left on the date. */
  available: (date: string) => number;
  /** The room-type closure covering the date, if any. */
  roomClosure: (date: string) => RoomClosureRule | null;
}

/**
 * Split a plan's nights into runs the resolver can price. An unmanaged plan
 * is one run. A managed plan breaks at every night the app sent no price
 * for: those nights are never priced, and a longer probe stops short of them
 * as it does at the end of the window.
 */
function pricedRuns(dateRows: RateQueryRow[]): RateQueryRow[][] {
  const runs: RateQueryRow[][] = [];
  let run: RateQueryRow[] = [];
  for (const row of dateRows) {
    if (row.priced && row.base_price_cents !== null) {
      run.push(row);
      continue;
    }
    if (run.length > 0) runs.push(run);
    run = [];
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * A managed night's rules, from the app's restrictions as loadStayAvailability
 * reads them. Closed when the app stopped selling it or sent no price for it.
 * A stay arriving on the date covers it, so the through limits bind it as
 * well as the arrival ones: the cell shows the stricter of each.
 *
 * Rule ids are per plan, not per date, so adjacent closed nights read as one
 * bar; the range is the night itself, since the app sends nights, not ranges.
 */
function appRules(r: RateQueryRow): { closure: RestrictionRule | null; restriction: RestrictionRule | null } {
  const at = r.app_received_at ?? r.date;
  const base = { startDate: r.date, endDate: r.date, note: null, createdBy: null, createdByName: null, createdAt: at };
  const closure =
    r.app_closed || !r.priced
      ? { ...base, id: `app:${r.rate_plan_id}:closed`, isClosed: true, minStay: null, maxStay: null, closedToArrival: false, closedToDeparture: false }
      : null;
  const mins = [r.app_min_stay_arrival, r.app_min_stay_through].filter((n): n is number => n !== null);
  const maxes = [r.app_max_stay_arrival, r.app_max_stay_through].filter((n): n is number => n !== null);
  const minStay = mins.length > 0 ? Math.max(...mins) : null;
  const maxStay = maxes.length > 0 ? Math.min(...maxes) : null;
  const cta = r.app_cta ?? false;
  const ctd = r.app_ctd ?? false;
  const restriction =
    cta || ctd || minStay !== null || maxStay !== null
      ? { ...base, id: `app:${r.rate_plan_id}:restriction`, isClosed: false, minStay, maxStay, closedToArrival: cta, closedToDeparture: ctd }
      : null;
  return { closure, restriction };
}

/** Our own closure and restriction rows covering the date, as stored. */
function ownRules(r: RateQueryRow): { closure: RestrictionRule | null; restriction: RestrictionRule | null } {
  const closure = ruleFrom(r.closure_id, r.closure_start, r.closure_end, {
    isClosed: true,
    note: r.closure_note,
    createdBy: r.closure_by,
    createdByName: r.closure_by_name,
    createdAt: r.closure_at ?? r.closure_start!,
  });
  const restriction = ruleFrom(r.restriction_id, r.restriction_start, r.restriction_end, {
    minStay: r.restriction_min_stay,
    maxStay: r.restriction_max_stay,
    closedToArrival: r.restriction_cta ?? false,
    closedToDeparture: r.restriction_ctd ?? false,
    note: r.restriction_note,
    createdBy: r.restriction_by,
    createdByName: r.restriction_by_name,
    createdAt: r.restriction_at ?? r.restriction_start!,
  });
  return { closure, restriction };
}

/**
 * One rate plan's row of the grid, from its RATES_SQL rows (in date order,
 * the probe overhang included) and every pricing rule on it (MODIFIERS_SQL).
 *
 * On a managed plan the rules are still listed for the editor, but none is
 * applied: discount rules are off, as in guest search and the stay quote.
 */
export function buildRatePlan(dateRows: RateQueryRow[], rules: ModifierWithId[], ctx: RatePlanContext): RatePlanRow {
  const head = dateRows[0];
  const modifiers: Modifier[] = head.managed ? [] : rules.filter((rule) => rule.is_active);
  const planHasStayDiscount = hasStayLengthDiscount(modifiers);

  // Same resolver the guest-facing search uses, so the host sees the number a
  // guest arriving that day would actually be quoted.
  const resolvedByDate = new Map<string, NightlyRate>();
  for (const run of pricedRuns(dateRows)) {
    const resolved = resolveNightlyRates(
      run.map((r) => ({
        date: r.date,
        base_price_cents: toNumber(r.base_price_cents!),
        has_override: r.has_override,
      })),
      modifiers,
      { baseOccupancy: head.base_occupancy, stayLength: ctx.stayLength, today: ctx.today },
    );
    for (const night of resolved) resolvedByDate.set(night.date, night);
  }

  const cells: RateCell[] = dateRows
    .filter((r) => ctx.isVisible(r.date))
    .map((r) => {
      // Undefined only on a managed night the app sent no price for.
      const priced = resolvedByDate.get(r.date);
      const { closure, restriction } = r.managed ? appRules(r) : ownRules(r);
      const available = ctx.available(r.date);
      const effectiveMinStay = restriction?.minStay ?? r.plan_min_stay;
      const status = resolveStatus({
        available,
        roomClosure: ctx.roomClosure(r.date),
        closure,
        restriction,
        effectiveMinStay,
        planMinStay: r.plan_min_stay,
      });

      return {
        date: r.date,
        state: status.state,
        // Null is "nothing sellable here", which is what the collapsed-row
        // summary and the lowest-rate pass need. The resolved figure is kept
        // separately: a closed date still has a rate underneath it, and the
        // cell shows it struck through rather than pretending it is gone.
        priceCents: status.bookable && priced ? priced.price_cents : null,
        // 0 where nothing priced the night (a managed night without an app
        // price): there is no rate underneath it, and none of ours stands in.
        indicativePriceCents: priced?.price_cents ?? 0,
        basePriceCents: r.base_price_cents === null ? 0 : toNumber(r.base_price_cents),
        hasOverride: r.has_override,
        overrideLabel: r.override_label,
        appliedModifiers: priced?.applied_modifiers ?? [],
        stayDiscountPending:
          planHasStayDiscount &&
          !(priced?.applied_modifiers ?? []).includes("length_of_stay"),
        minStay: effectiveMinStay,
        maxStay: restriction?.maxStay ?? r.plan_max_stay,
        closedToArrival: restriction?.closedToArrival ?? false,
        closedToDeparture: restriction?.closedToDeparture ?? false,
        rule: closure ?? restriction,
        available,
        primary: status.primary,
        reasons: status.reasons,
        bookable: status.bookable,
        trace: priced?.trace ?? [],
      };
    });

  return {
    id: head.rate_plan_id,
    name: head.rate_plan_name,
    currency: head.currency,
    barCents: toNumber(head.bar_cents),
    onSale: head.on_sale,
    isRefundable: head.is_refundable,
    minStay: head.plan_min_stay,
    maxStay: head.plan_max_stay,
    modifiers,
    rules: rules.map(toPricingRule),
    hasStayDiscount: planHasStayDiscount,
    cells,
    status: deriveStatus(cells),
  };
}

export interface AriQueryOptions {
  /** Nights each cell is priced over. Default 1 — the extranet convention. */
  stayLength?: number;
  today?: string;
}

export async function loadAriGrid(
  session: SessionLike,
  propertyId: string,
  range: AriRange,
  options: AriQueryOptions = {},
): Promise<AriGridData | null> {
  const host = getPropertyScopedDb(session, propertyId);
  const stayLength = Math.max(1, Math.floor(options.stayLength ?? 1));

  const property = await host.queryOne<PropertyRow>(
    `SELECT p.id, p.name, p.timezone FROM properties p WHERE ${CURRENT_PROPERTY_SQL}`,
  );
  if (!property) return null;
  // Lead-time rules (early bird, last minute) count from the property's date.
  const today = options.today ?? todayInZone(property.timezone);

  // A multi-night probe on the last visible date needs base prices past the
  // end of the window. Fetch the overhang and price against it, then render
  // only the visible columns — otherwise the tail dates would be quoted on a
  // truncated stay and read as artificially cheap.
  const priceRangeEnd = addDays(range.end, stayLength - 1);

  const params = [range.start, range.end];
  const priceParams = [range.start, priceRangeEnd];
  const [availabilityRows, rateRows, modifierRows, versionRow] = await Promise.all([
    host.query<AvailabilityQueryRow>(AVAILABILITY_SQL, params),
    host.query<RateQueryRow>(RATES_SQL, priceParams),
    host.query<ModifierQueryRow>(MODIFIERS_SQL),
    // Fetched with the grid, not after it: a version read later could see a
    // write that landed between the two, and stamp stale data as current.
    host.queryOne<{ version: string }>(VERSION_SQL, params),
  ]);

  const dates = enumerateDates(range);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const rulesByPlan = new Map<string, ModifierWithId[]>(
    modifierRows.map((row) => [row.rate_plan_id, parseModifiers(row.modifiers)]),
  );

  // ── Availability, keyed for the price pass to read back ──
  const rooms = new Map<string, RoomTypeRow>();
  const availabilityByRoomDate = new Map<string, number>();
  const closureByRoomDate = new Map<string, RoomClosureRule>();

  for (const row of availabilityRows) {
    let room = rooms.get(row.room_id);
    if (!room) {
      room = {
        id: row.room_id,
        name: row.room_name,
        roomType: row.room_type,
        baseOccupancy: row.base_occupancy,
        totalUnits: row.total_units,
        onSale: row.on_sale,
        availability: [],
        ratePlans: [],
        lowestRatesCents: dates.map(() => null),
      };
      rooms.set(row.room_id, room);
    }

    const closure: RoomClosureRule | null =
      row.closure_id && row.closure_start && row.closure_end
        ? {
            id: row.closure_id,
            startDate: row.closure_start,
            endDate: row.closure_end,
            note: row.closure_note,
            createdBy: row.closure_by,
            createdByName: row.closure_by_name,
            createdAt: row.closure_at ?? row.closure_start,
          }
        : null;

    const cell = buildAvailabilityCell(row, closure);
    room.availability.push(cell);
    availabilityByRoomDate.set(`${row.room_id}|${row.date}`, cell.left);
    if (closure) closureByRoomDate.set(`${row.room_id}|${row.date}`, closure);
  }

  // ── Prices: group rows into plans, then resolve each plan's nights in one pass ──
  const plansByRoom = new Map<string, Map<string, RateQueryRow[]>>();

  for (const row of rateRows) {
    let plans = plansByRoom.get(row.room_id);
    if (!plans) {
      plans = new Map();
      plansByRoom.set(row.room_id, plans);
    }
    const dateRows = plans.get(row.rate_plan_id);
    if (dateRows) dateRows.push(row);
    else plans.set(row.rate_plan_id, [row]);
  }

  for (const [roomId, plans] of plansByRoom) {
    const room = rooms.get(roomId);
    if (!room) continue;

    for (const [planId, dateRows] of plans) {
      room.ratePlans.push(
        buildRatePlan(dateRows, rulesByPlan.get(planId) ?? [], {
          stayLength,
          today,
          isVisible: (date) => dateIndex.has(date),
          available: (date) => availabilityByRoomDate.get(`${roomId}|${date}`) ?? 0,
          roomClosure: (date) => closureByRoomDate.get(`${roomId}|${date}`) ?? null,
        }),
      );
    }
  }

  applyLowestRates(rooms.values(), dateIndex);

  const roomList = [...rooms.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const currency =
    roomList.find((r) => r.ratePlans.length > 0)?.ratePlans[0]?.currency ??
    "EUR";

  return {
    propertyId: property.id,
    propertyName: property.name,
    currency,
    dates,
    rooms: roomList,
    stayLength,
    version: versionRow?.version ?? "empty",
  };
}

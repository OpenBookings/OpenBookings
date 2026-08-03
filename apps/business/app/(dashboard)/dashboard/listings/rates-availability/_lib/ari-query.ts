import { getHostScopedDb, type SessionLike } from "@openbookings/authz";
import {
  hasStayLengthDiscount,
  resolveNightlyRates,
  type Modifier,
} from "@openbookings/pricing";
import { applyLowestRates, deriveState, deriveStatus } from "./derive";
import type {
  AriGridData,
  AvailabilityCell,
  RateCell,
  RatePlanRow,
  RestrictionRule,
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
 * Both are host-scoped through getHostScopedDb, so `$1` is always the verified
 * owner id and callers' own params start at `$2`.
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
 * through here. Prices are whole currency units well inside 2^53; the precision
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
  date: string;
  effective_total: number;
  booked: number;
  blocked: number;
  available_override: number | null;
  note: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

interface RateQueryRow {
  room_id: string;
  rate_plan_id: string;
  rate_plan_name: string;
  currency: string;
  /** bigint column — see `toNumber`. */
  bar: string;
  is_refundable: boolean;
  cancellation_policy: string | null;
  plan_min_stay: number;
  plan_max_stay: number | null;
  base_occupancy: number;
  date: string;
  /** bigint column — see `toNumber`. */
  base_price: string;
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
}

interface ModifierQueryRow {
  rate_plan_id: string;
  modifiers: Modifier[] | string;
}

interface PropertyRow {
  id: string;
  name: string;
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
 */
const AVAILABILITY_SQL = `
WITH dates AS (
  SELECT generate_series($3::date, $4::date, INTERVAL '1 day')::date AS d
),
scope_rooms AS (
  SELECT r.id, r.name, r.room_type, r.base_occupancy, r.total_units
  FROM rooms r
  JOIN properties p ON p.id = r.property_id
  WHERE p.owner_user_id = $1
    AND p.id = $2
    AND r.is_active
),
booked AS (
  SELECT res.room_id, d.d AS date, COUNT(*)::int AS units
  FROM reservations res
  JOIN bookings b ON b.id = res.booking_id
  JOIN scope_rooms sr ON sr.id = res.room_id
  JOIN dates d ON d.d >= b.check_in_date AND d.d < b.check_out_date
  WHERE b.status IN ('confirmed', 'completed')
  GROUP BY res.room_id, d.d
)
SELECT
  sr.id                                        AS room_id,
  sr.name                                      AS room_name,
  sr.room_type,
  sr.base_occupancy,
  sr.total_units,
  d.d::text                                    AS date,
  COALESCE(inv.total_rooms, sr.total_units)    AS effective_total,
  COALESCE(bk.units, 0)                        AS booked,
  COALESCE(inv.blocked_rooms, 0)               AS blocked,
  inv.available_override,
  inv.note,
  inv.updated_by,
  u.name                                       AS updated_by_name,
  inv.updated_at
FROM scope_rooms sr
CROSS JOIN dates d
LEFT JOIN room_inventory inv ON inv.room_id = sr.id AND inv.date = d.d
LEFT JOIN booked bk          ON bk.room_id  = sr.id AND bk.date = d.d
LEFT JOIN "user" u           ON u.id = inv.updated_by
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
 */
const RATES_SQL = `
WITH dates AS (
  SELECT generate_series($3::date, $4::date, INTERVAL '1 day')::date AS d
),
scope_plans AS (
  SELECT
    rp.id, rp.name, rp.bar, rp.currency, rp.is_refundable, rp.cancellation_policy,
    rp.min_stay, rp.max_stay,
    r.id AS room_id, r.name AS room_name, r.base_occupancy
  FROM rate_plans rp
  JOIN rooms r      ON r.id = rp.room_id
  JOIN properties p ON p.id = r.property_id
  WHERE p.owner_user_id = $1
    AND p.id = $2
    AND r.is_active
    AND rp.is_active
)
SELECT
  sp.room_id,
  sp.id                            AS rate_plan_id,
  sp.name                          AS rate_plan_name,
  sp.currency,
  sp.bar,
  sp.is_refundable,
  sp.cancellation_policy,
  sp.min_stay                      AS plan_min_stay,
  sp.max_stay                      AS plan_max_stay,
  sp.base_occupancy,
  d.d::text                        AS date,
  COALESCE(o.price_per_night, sp.bar) AS base_price,
  (o.price_per_night IS NOT NULL)     AS has_override,
  o.label                          AS override_label,
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
  rs.created_at                    AS restriction_at
FROM scope_plans sp
CROSS JOIN dates d
LEFT JOIN LATERAL (
  SELECT price_per_night, label
  FROM rate_overrides
  WHERE rate_plan_id = sp.id
    AND start_date <= d.d
    AND end_date   >= d.d
    AND is_active
  ORDER BY priority DESC
  LIMIT 1
) o ON TRUE
LEFT JOIN LATERAL (
  SELECT id, start_date, end_date, note, created_by, created_at
  FROM rate_plan_restrictions
  WHERE rate_plan_id = sp.id
    AND start_date <= d.d
    AND end_date   >= d.d
    AND is_active
    AND is_closed
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
  ORDER BY priority DESC
  LIMIT 1
) rs ON TRUE
LEFT JOIN "user" cu ON cu.id = cl.created_by
LEFT JOIN "user" ru ON ru.id = rs.created_by
ORDER BY sp.room_name, sp.name, d.d
`;

const MODIFIERS_SQL = `
SELECT
  m.rate_plan_id,
  jsonb_agg(
    jsonb_build_object(
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
WHERE p.owner_user_id = $1
  AND p.id = $2
  AND m.is_active
GROUP BY m.rate_plan_id
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

function parseModifiers(value: Modifier[] | string): Modifier[] {
  return typeof value === "string" ? (JSON.parse(value) as Modifier[]) : value;
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
  const host = getHostScopedDb(session);
  const today = options.today ?? toIsoDate(new Date());
  const stayLength = Math.max(1, Math.floor(options.stayLength ?? 1));

  const property = await host.queryOne<PropertyRow>(
    `SELECT id, name FROM properties WHERE owner_user_id = $1 AND id = $2`,
    [propertyId],
  );
  if (!property) return null;

  // A multi-night probe on the last visible date needs base prices past the
  // end of the window. Fetch the overhang and price against it, then render
  // only the visible columns — otherwise the tail dates would be quoted on a
  // truncated stay and read as artificially cheap.
  const priceRangeEnd = addDays(range.end, stayLength - 1);

  const params = [propertyId, range.start, range.end];
  const priceParams = [propertyId, range.start, priceRangeEnd];
  const [availabilityRows, rateRows, modifierRows] = await Promise.all([
    host.query<AvailabilityQueryRow>(AVAILABILITY_SQL, params),
    host.query<RateQueryRow>(RATES_SQL, priceParams),
    host.query<ModifierQueryRow>(MODIFIERS_SQL, [propertyId]),
  ]);

  const dates = enumerateDates(range);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const modifiersByPlan = new Map<string, Modifier[]>(
    modifierRows.map((row) => [row.rate_plan_id, parseModifiers(row.modifiers)]),
  );

  // ── Availability, keyed for the price pass to read back ──
  const rooms = new Map<string, RoomTypeRow>();
  const availabilityByRoomDate = new Map<string, number>();

  for (const row of availabilityRows) {
    let room = rooms.get(row.room_id);
    if (!room) {
      room = {
        id: row.room_id,
        name: row.room_name,
        roomType: row.room_type,
        baseOccupancy: row.base_occupancy,
        totalUnits: row.total_units,
        availability: [],
        ratePlans: [],
        lowestRates: dates.map(() => null),
      };
      rooms.set(row.room_id, room);
    }

    const computed = Math.max(
      0,
      row.effective_total - row.booked - row.blocked,
    );
    const override = row.available_override;
    const effective = override ?? computed;

    const cell: AvailabilityCell = {
      date: row.date,
      totalUnits: row.effective_total,
      booked: row.booked,
      blocked: row.blocked,
      computed,
      override,
      effective,
      source: override === null ? "computed" : "override",
      note: row.note,
      updatedBy: row.updated_by,
      updatedByName: row.updated_by_name,
      updatedAt: row.updated_at,
    };
    room.availability.push(cell);
    availabilityByRoomDate.set(`${row.room_id}|${row.date}`, effective);
  }

  // ── Prices: group rows into plans, then resolve each plan's nights in one pass ──
  interface PlanAccumulator {
    row: RateQueryRow;
    dateRows: RateQueryRow[];
  }
  const plansByRoom = new Map<string, Map<string, PlanAccumulator>>();

  for (const row of rateRows) {
    let plans = plansByRoom.get(row.room_id);
    if (!plans) {
      plans = new Map();
      plansByRoom.set(row.room_id, plans);
    }
    const existing = plans.get(row.rate_plan_id);
    if (existing) {
      existing.dateRows.push(row);
    } else {
      plans.set(row.rate_plan_id, { row, dateRows: [row] });
    }
  }

  for (const [roomId, plans] of plansByRoom) {
    const room = rooms.get(roomId);
    if (!room) continue;

    for (const { row: head, dateRows } of plans.values()) {
      const modifiers = modifiersByPlan.get(head.rate_plan_id) ?? [];

      const planHasStayDiscount = hasStayLengthDiscount(modifiers);

      // Same resolver the guest-facing search uses, so the host sees the
      // number a guest arriving that day would actually be quoted. `dateRows`
      // includes the overhang; `visibleRows` is what gets columns.
      const resolved = resolveNightlyRates(
        dateRows.map((r) => ({
          date: r.date,
          base_price: toNumber(r.base_price),
          has_override: r.has_override,
        })),
        modifiers,
        { baseOccupancy: head.base_occupancy, stayLength, today },
      );
      const resolvedByDate = new Map(resolved.map((r) => [r.date, r]));

      const visibleRows = dateRows.filter((r) => dateIndex.has(r.date));

      const cells: RateCell[] = visibleRows.map((r) => {
        const priced = resolvedByDate.get(r.date)!;
        const closure = ruleFrom(r.closure_id, r.closure_start, r.closure_end, {
          isClosed: true,
          note: r.closure_note,
          createdBy: r.closure_by,
          createdByName: r.closure_by_name,
          createdAt: r.closure_at ?? r.closure_start!,
        });
        const restriction = ruleFrom(
          r.restriction_id,
          r.restriction_start,
          r.restriction_end,
          {
            minStay: r.restriction_min_stay,
            maxStay: r.restriction_max_stay,
            closedToArrival: r.restriction_cta ?? false,
            closedToDeparture: r.restriction_ctd ?? false,
            note: r.restriction_note,
            createdBy: r.restriction_by,
            createdByName: r.restriction_by_name,
            createdAt: r.restriction_at ?? r.restriction_start!,
          },
        );

        const available =
          availabilityByRoomDate.get(`${roomId}|${r.date}`) ?? 0;
        const effectiveMinStay = restriction?.minStay ?? r.plan_min_stay;
        const state = deriveState(
          available,
          closure,
          restriction,
          effectiveMinStay,
          r.plan_min_stay,
        );

        return {
          date: r.date,
          state,
          price: state === "open" || state === "restricted"
            ? priced.price
            : null,
          basePrice: toNumber(r.base_price),
          hasOverride: r.has_override,
          overrideLabel: r.override_label,
          appliedModifiers: priced.applied_modifiers,
          stayDiscountPending:
            planHasStayDiscount &&
            !priced.applied_modifiers.includes("length_of_stay"),
          minStay: effectiveMinStay,
          maxStay: restriction?.maxStay ?? r.plan_max_stay,
          closedToArrival: restriction?.closedToArrival ?? false,
          closedToDeparture: restriction?.closedToDeparture ?? false,
          rule: closure ?? restriction,
          available,
        };
      });

      const plan: RatePlanRow = {
        id: head.rate_plan_id,
        name: head.rate_plan_name,
        currency: head.currency,
        bar: toNumber(head.bar),
        isRefundable: head.is_refundable,
        cancellationPolicy: head.cancellation_policy,
        minStay: head.plan_min_stay,
        maxStay: head.plan_max_stay,
        modifiers,
        hasStayDiscount: planHasStayDiscount,
        cells,
        status: deriveStatus(cells),
      };
      room.ratePlans.push(plan);
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
  };
}

/** The host's properties, for the (currently implicit) property picker. */
export async function loadHostProperties(
  session: SessionLike,
): Promise<PropertyRow[]> {
  const host = getHostScopedDb(session);
  return host.query<PropertyRow>(
    `SELECT id, name FROM properties WHERE owner_user_id = $1 ORDER BY name`,
  );
}

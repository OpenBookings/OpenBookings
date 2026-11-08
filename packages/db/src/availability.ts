import {
  bookableUnits,
  nightTotal,
  perRoomParty,
  pickReason,
  stayRuleReasons,
  type StayRule,
  type UnavailableReason,
} from "@openbookings/pricing";
import type { Queryable } from "./reservation-policy";

/**
 * What a stay can book, read from the database in one query and judged by the
 * shared rules in `@openbookings/pricing`. Search, the stay quote, booking
 * intent creation and payment confirmation all ask through here, so a hotel
 * never shows bookable in one place and sold out in another.
 *
 * `db` is any Queryable so the intent and confirmation code can run this on
 * their transaction, after locking the rooms, and see their own writes.
 *
 * Dates are YYYY-MM-DD strings and stay that way: they go into SQL as text and
 * come back as `::text`, never through a JS Date.
 */

export type RoomNightUnits = { date: string; total: number; booked: number; held: number; bookable: number };

export type RatePlanAvailability = { ratePlanId: string; isRefundable: boolean; reasons: UnavailableReason[] };

export type RoomAvailability = {
  roomId: string;
  onSale: boolean;
  maxAdults: number;
  maxChildren: number;
  /** Min night total over the stay. */
  total: number;
  /** Min bookable over the stay. */
  unitsLeft: number;
  roomClosed: boolean;
  nights: RoomNightUnits[];
  ratePlans: RatePlanAvailability[];
};

export type PropertyAvailability = { propertyId: string; bookable: boolean; reason: UnavailableReason | null };

type NightRow = {
  date: string;
  override: number | null;
  totalRooms: number | null;
  blocked: number;
  booked: number;
  held: number;
  closed: boolean;
};

type PlanRow = {
  ratePlanId: string;
  isRefundable: boolean;
  minStay: number | null;
  maxStay: number | null;
  rules: StayRule[];
};

type RoomRow = {
  room_id: string;
  property_id: string;
  on_sale: boolean;
  max_adults: number;
  max_children: number;
  total_units: number;
  nights: NightRow[];
  rate_plans: PlanRow[];
};

/**
 * One row per room, nights and rate plans folded in as JSON.
 *
 * $1 property ids, $2 check-in, $3 check-out, $4 now, $5 intent to leave out.
 *
 * `booked` and `room_closures` follow AVAILABILITY_SQL in the host rates grid
 * (apps/business/.../rates-availability/_lib/ari-query.ts), and the rate-plan
 * rules follow its RATES_SQL: per plan and date, the highest-priority active
 * closure and, independently, the highest-priority active non-closing
 * restriction. Rules are read over [checkIn, checkOut] — the departure date
 * matters for closed-to-departure — while stock is counted per night,
 * [checkIn, checkOut).
 *
 * `held` is one unit per booking_intent_rooms row of an open, unexpired
 * intent, for each night it covers. `now` is a parameter, never SQL now(), so
 * a caller (or a test) decides what "unexpired" means.
 */
const STAY_AVAILABILITY_SQL = `
WITH nights AS (
  SELECT generate_series($2::date, $3::date - 1, INTERVAL '1 day')::date AS d
),
rule_dates AS (
  SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS d
),
scope_rooms AS (
  SELECT r.id, r.property_id, r.name, r.is_active AS on_sale,
         r.max_adults, r.max_children, r.total_units
  FROM rooms r
  WHERE r.property_id = ANY($1::uuid[])
    AND r.archived_at IS NULL
),
scope_plans AS (
  SELECT rp.id, rp.room_id, rp.name, rp.sort_order, rp.is_refundable, rp.min_stay, rp.max_stay
  FROM rate_plans rp
  JOIN scope_rooms sr ON sr.id = rp.room_id
  WHERE rp.is_active
    AND rp.archived_at IS NULL
),
booked AS (
  SELECT res.room_id, n.d AS date, COUNT(*)::int AS units
  FROM reservations res
  JOIN bookings b ON b.id = res.booking_id
  JOIN scope_rooms sr ON sr.id = res.room_id
  -- A guest who left early frees the nights after the last one they stayed.
  JOIN nights n ON n.d >= b.check_in_date
               AND n.d < LEAST(b.check_out_date, COALESCE(b.departed_early_on + 1, b.check_out_date))
  -- A cancelled room holds nothing; pending bookings are unpaid and hold nothing.
  WHERE b.status::text IN ('confirmed', 'checked_in', 'completed')
    AND res.cancelled_at IS NULL
  GROUP BY res.room_id, n.d
),
held AS (
  SELECT bir.room_id, n.d AS date, COUNT(*)::int AS units
  FROM booking_intent_rooms bir
  JOIN booking_intents bi ON bi.id = bir.intent_id
  JOIN scope_rooms sr ON sr.id = bir.room_id
  JOIN nights n ON n.d >= bi.check_in_date AND n.d < bi.check_out_date
  WHERE bi.status = 'open'
    AND bi.hold_expires_at > $4::timestamptz
    AND bi.id IS DISTINCT FROM $5::uuid
  GROUP BY bir.room_id, n.d
),
room_nights AS (
  SELECT
    sr.id                            AS room_id,
    n.d,
    inv.available_override,
    inv.total_rooms,
    COALESCE(inv.blocked_rooms, 0)   AS blocked,
    COALESCE(bk.units, 0)            AS booked,
    COALESCE(h.units, 0)             AS held,
    EXISTS (
      SELECT 1 FROM room_closures rc
      WHERE rc.room_id = sr.id
        AND rc.start_date <= n.d
        AND rc.end_date   >= n.d
        AND rc.is_active
    )                                AS closed
  FROM scope_rooms sr
  CROSS JOIN nights n
  LEFT JOIN room_inventory inv ON inv.room_id = sr.id AND inv.date = n.d
  LEFT JOIN booked bk          ON bk.room_id  = sr.id AND bk.date = n.d
  LEFT JOIN held h             ON h.room_id   = sr.id AND h.date  = n.d
),
plan_rules AS (
  SELECT
    sp.id                                    AS rate_plan_id,
    rd.d,
    (cl.id IS NOT NULL)                      AS is_closed,
    rs.min_stay,
    rs.max_stay,
    COALESCE(rs.closed_to_arrival, false)    AS closed_to_arrival,
    COALESCE(rs.closed_to_departure, false)  AS closed_to_departure
  FROM scope_plans sp
  CROSS JOIN rule_dates rd
  LEFT JOIN LATERAL (
    SELECT id FROM rate_plan_restrictions
    WHERE rate_plan_id = sp.id
      AND start_date <= rd.d
      AND end_date   >= rd.d
      AND is_active
      AND is_closed
    ORDER BY priority DESC
    LIMIT 1
  ) cl ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, min_stay, max_stay, closed_to_arrival, closed_to_departure
    FROM rate_plan_restrictions
    WHERE rate_plan_id = sp.id
      AND start_date <= rd.d
      AND end_date   >= rd.d
      AND is_active
      AND NOT is_closed
    ORDER BY priority DESC
    LIMIT 1
  ) rs ON TRUE
  WHERE cl.id IS NOT NULL OR rs.id IS NOT NULL
)
SELECT
  sr.id           AS room_id,
  sr.property_id,
  sr.on_sale,
  sr.max_adults,
  sr.max_children,
  sr.total_units,
  COALESCE((
    SELECT json_agg(json_build_object(
      'date',       rn.d::text,
      'override',   rn.available_override,
      'totalRooms', rn.total_rooms,
      'blocked',    rn.blocked,
      'booked',     rn.booked,
      'held',       rn.held,
      'closed',     rn.closed
    ) ORDER BY rn.d)
    FROM room_nights rn WHERE rn.room_id = sr.id
  ), '[]'::json)  AS nights,
  COALESCE((
    SELECT json_agg(json_build_object(
      'ratePlanId',   sp.id,
      'isRefundable', sp.is_refundable,
      'minStay',      sp.min_stay,
      'maxStay',      sp.max_stay,
      'rules', COALESCE((
        SELECT json_agg(json_build_object(
          'date',              pr.d::text,
          'isClosed',          pr.is_closed,
          'minStay',           pr.min_stay,
          'maxStay',           pr.max_stay,
          'closedToArrival',   pr.closed_to_arrival,
          'closedToDeparture', pr.closed_to_departure
        ) ORDER BY pr.d)
        FROM plan_rules pr WHERE pr.rate_plan_id = sp.id
      ), '[]'::json)
    ) ORDER BY sp.sort_order, sp.name, sp.id)
    FROM scope_plans sp WHERE sp.room_id = sr.id
  ), '[]'::json)  AS rate_plans
FROM scope_rooms sr
ORDER BY sr.property_id, sr.name, sr.id
`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertStay(checkIn: string, checkOut: string): void {
  if (!DATE.test(checkIn) || !DATE.test(checkOut) || checkOut <= checkIn) {
    throw new RangeError(`Invalid stay ${checkIn} → ${checkOut}: need YYYY-MM-DD dates with check-out after check-in`);
  }
}

/**
 * Every non-archived room of these properties, with its property id. Search
 * loads this once for all its hotels, then judges each room and each hotel
 * with `roomReasons` and `summariseSearchAvailability`.
 */
export async function loadRoomsAvailability(
  db: Queryable,
  i: { propertyIds: string[]; checkIn: string; checkOut: string; now: Date; excludeIntentId?: string | null },
): Promise<{ propertyId: string; room: RoomAvailability }[]> {
  assertStay(i.checkIn, i.checkOut);
  const { rows } = await db.query(STAY_AVAILABILITY_SQL, [
    i.propertyIds,
    i.checkIn,
    i.checkOut,
    i.now,
    i.excludeIntentId ?? null,
  ]);
  return (rows as RoomRow[]).map((row) => ({ propertyId: row.property_id, room: toRoom(row, i) }));
}

function toRoom(row: RoomRow, stay: { checkIn: string; checkOut: string }): RoomAvailability {
  const nights = row.nights.map((n): RoomNightUnits => {
    const total = nightTotal({ override: n.override, totalRooms: n.totalRooms, totalUnits: row.total_units, blocked: n.blocked });
    return { date: n.date, total, booked: n.booked, held: n.held, bookable: bookableUnits({ total, booked: n.booked, held: n.held }) };
  });
  return {
    roomId: row.room_id,
    onSale: row.on_sale,
    maxAdults: row.max_adults,
    maxChildren: row.max_children,
    total: Math.min(...nights.map((n) => n.total)),
    unitsLeft: Math.min(...nights.map((n) => n.bookable)),
    roomClosed: row.nights.some((n) => n.closed),
    nights,
    ratePlans: row.rate_plans.map((plan) => ({
      ratePlanId: plan.ratePlanId,
      isRefundable: plan.isRefundable,
      reasons: stayRuleReasons({
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        planMinStay: plan.minStay,
        planMaxStay: plan.maxStay,
        rules: plan.rules,
      }),
    })),
  };
}

/**
 * Every non-archived room of the property, by name, with its stock per night
 * and the rules each active rate plan breaks for this stay. Draft rooms are
 * listed with `onSale: false`; deciding what that means is the caller's job.
 */
export async function loadStayAvailability(
  db: Queryable,
  i: { propertyId: string; checkIn: string; checkOut: string; now: Date; excludeIntentId?: string | null },
): Promise<RoomAvailability[]> {
  const rooms = await loadRoomsAvailability(db, { ...i, propertyIds: [i.propertyId] });
  return rooms.map((r) => r.room);
}

/**
 * Whether each property can take the whole party for this stay, and if not,
 * the one reason that best explains it. Every requested id gets an answer.
 *
 * A room qualifies when it is on sale, open, fits its share of the party, has
 * a unit left and has a rate plan with nothing against it. A guest can mix
 * room types, so the property is bookable when its qualifying rooms' units add
 * up to the rooms asked for.
 */
export async function loadSearchAvailability(
  db: Queryable,
  i: {
    propertyIds: string[];
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    rooms: number;
    now: Date;
  },
): Promise<Map<string, PropertyAvailability>> {
  const rooms = await loadRoomsAvailability(db, {
    propertyIds: i.propertyIds,
    checkIn: i.checkIn,
    checkOut: i.checkOut,
    now: i.now,
  });
  return summariseSearchAvailability(rooms, i);
}

/**
 * What stands against a room for one room's share of the party, apart from
 * its rate plans' own reasons: off sale, closed, too small, no unit left, or
 * no active rate plan. Empty when the room itself can be sold.
 */
export function roomReasons(room: RoomAvailability, party: { adults: number; children: number }): UnavailableReason[] {
  const own: UnavailableReason[] = [];
  if (!room.onSale) own.push("not_on_sale");
  if (room.roomClosed) own.push("room_closed");
  if (party.adults > room.maxAdults || party.children > room.maxChildren) own.push("too_many_guests");
  if (room.unitsLeft < 1) own.push("sold_out");
  // A room with no active rate plan cannot be sold, whatever its stock says.
  if (room.ratePlans.length === 0 && !own.includes("not_on_sale")) own.push("not_on_sale");
  return own;
}

/** `loadSearchAvailability` over rooms already loaded with `loadRoomsAvailability`. */
export function summariseSearchAvailability(
  rooms: { propertyId: string; room: RoomAvailability }[],
  i: { propertyIds: string[]; adults: number; children: number; rooms: number },
): Map<string, PropertyAvailability> {
  const party = perRoomParty({ adults: i.adults, children: i.children, rooms: i.rooms });

  const tally = new Map<string, { units: number; anyQualifies: boolean; reasons: Set<UnavailableReason> }>();
  for (const id of i.propertyIds) tally.set(id, { units: 0, anyQualifies: false, reasons: new Set() });

  for (const { propertyId, room } of rooms) {
    const t = tally.get(propertyId);
    if (!t) continue;
    const own = roomReasons(room, party);
    const openPlan = room.ratePlans.some((p) => p.reasons.length === 0);

    if (own.length === 0 && openPlan) {
      t.anyQualifies = true;
      t.units += room.unitsLeft;
    }
    for (const r of own) t.reasons.add(r);
    for (const p of room.ratePlans) for (const r of p.reasons) t.reasons.add(r);
  }

  const result = new Map<string, PropertyAvailability>();
  for (const [propertyId, t] of tally) {
    if (t.units >= Math.max(1, i.rooms)) {
      result.set(propertyId, { propertyId, bookable: true, reason: null });
    } else {
      // A property with no rooms at all has nothing on sale.
      const reason = t.anyQualifies ? "sold_out" : (pickReason(t.reasons) ?? "not_on_sale");
      result.set(propertyId, { propertyId, bookable: false, reason });
    }
  }
  return result;
}

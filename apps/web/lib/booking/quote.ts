import {
  loadStayAvailability,
  roomReasons,
  type IntentRoomInput,
  type IntentSnapshot,
  type Queryable,
  type RoomAvailability,
} from "@openbookings/db";
import {
  freeCancellationUntil,
  nonRefundableQualifies,
  perRoomParty,
  resolveRoom,
  snapshotTier,
  type PropertyCancellationTier,
  type ResolvedRoom,
  type RoomRow,
  type TouristTaxResult,
  type UnavailableReason,
} from "@openbookings/pricing";
import { commissionSplit } from "@openbookings/billing/commission";
import { billingTreatmentForProperty } from "@openbookings/billing/profiles";
import { applicationFeeCents } from "@openbookings/stripe/fees";
import { toCents } from "@/app/checkout/_lib/booking-lines";
import { stayBoundErrors } from "@/app/api/query/search-bounds";
import { MAX_ROOMS, todayInZone, type StayInput } from "./stay-input";

/**
 * Exact prices and availability for a stay at one property: every active room
 * × every active rate plan, priced night by night through the same resolver
 * as search, and judged by the same availability rule as search and booking
 * intents. Nothing here is cached; the property page HTML is, and asks this
 * for the guest's dates.
 *
 * Unbookable rooms and rates come back with their reasons; hiding them is the
 * page's call. The one thing left out is a Non-refundable rate that is not at
 * least 10% cheaper than a refundable rate on the same room (Annex B B.4.3),
 * the same rule the listing applies (`withCancellationTerms`).
 */

export type QuotedRatePlan = {
  ratePlanId: string;
  name: string;
  isRefundable: boolean;
  mealPlan: string | null;
  nights: { date: string; price: number }[];
  stayTotal: number;
  touristTax: TouristTaxResult;
  freeCancellationUntil: string | null;
  reasons: UnavailableReason[];
};

export type QuotedRoom = {
  roomId: string;
  name: string;
  roomType: string | null;
  maxAdults: number;
  maxChildren: number;
  total: number;
  unitsLeft: number;
  reasons: UnavailableReason[];
  ratePlans: QuotedRatePlan[];
};

export type StayQuote = { propertyId: string; slug: string; currency: "EUR"; stay: StayInput; rooms: QuotedRoom[] };

export type SelectedRoom = { roomId: string; ratePlanId: string; adults: number; children: number };

export type VisibleProperty = {
  id: string;
  slug: string;
  timezone: string;
  checkInTime: string | null;
  cancellationTier: PropertyCancellationTier;
  commissionRate: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An active property a guest may see: demo hotels only in testing mode.
 * Unknown, inactive and hidden properties all read as `null`.
 */
export async function loadVisibleProperty(
  db: Queryable,
  by: { id: string } | { slug: string },
  testing: boolean,
): Promise<VisibleProperty | null> {
  if ("id" in by && !UUID.test(by.id)) return null;
  const column = "id" in by ? "id" : "slug";
  const { rows } = await db.query(
    `SELECT id, slug, timezone, to_char(check_in_time, 'HH24:MI') AS check_in_time,
            cancellation_tier, commission_rate::text AS commission_rate
     FROM properties
     WHERE ${column} = $1 AND is_active AND (NOT is_demo OR $2::boolean)
     LIMIT 1`,
    ["id" in by ? by.id : by.slug, testing],
  );
  const row = rows[0] as
    | { id: string; slug: string; timezone: string; check_in_time: string | null; cancellation_tier: PropertyCancellationTier; commission_rate: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    timezone: row.timezone,
    checkInTime: row.check_in_time,
    cancellationTier: row.cancellation_tier,
    commissionRate: row.commission_rate,
  };
}

type PlanRow = RoomRow & {
  room_type: string | null;
  includes_breakfast: boolean;
  includes_lunch: boolean;
  includes_dinner: boolean;
};

/**
 * One row per active room × active rate plan, in display order. Steps 2–4 of
 * the search query (apps/web/app/api/query/route.ts): the nightly price is the
 * highest-priority active override or the plan's BAR, then the plan's active
 * modifiers and the property's tourist tax rules for the resolver.
 *
 * $1 property id, $2 check-in, $3 check-out.
 */
const PLAN_ROWS_SQL = `
WITH stay_dates AS (
  SELECT generate_series($2::date, $3::date - 1, INTERVAL '1 day')::date AS stay_date
),
plans AS (
  SELECT
    p.id AS hotel_id, p.name AS hotel_name, p.slug AS hotel_slug, p.city, p.country,
    p.cancellation_tier, p.timezone, to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
    r.id AS room_id, r.name AS room_name, r.description AS room_description, r.room_type,
    r.base_occupancy, r.max_adults, r.max_children, r.sort_order AS room_sort,
    -- bigint comes back as a string from node-postgres; the resolver adds these.
    r.extra_adult_fee::int, r.extra_child_fee::int, r.cot_fee::int, r.extra_bed_fee::int,
    rp.id AS rate_plan_id, rp.name AS rate_plan_name, rp.bar, rp.currency, rp.is_refundable,
    rp.min_stay, rp.max_stay, rp.sort_order AS plan_sort,
    rp.includes_breakfast, rp.includes_lunch, rp.includes_dinner
  FROM properties p
  JOIN rooms r       ON r.property_id = p.id AND r.is_active AND r.archived_at IS NULL
  JOIN rate_plans rp ON rp.room_id = r.id AND rp.is_active AND rp.archived_at IS NULL
  WHERE p.id = $1
),
room_nights AS (
  SELECT
    pl.rate_plan_id,
    jsonb_agg(jsonb_build_object(
      'date',         sd.stay_date,
      'base_price',   COALESCE(o.price_per_night, pl.bar),
      'has_override', (o.price_per_night IS NOT NULL)
    ) ORDER BY sd.stay_date) AS nights
  FROM plans pl
  CROSS JOIN stay_dates sd
  LEFT JOIN LATERAL (
    SELECT price_per_night
    FROM rate_overrides
    WHERE rate_plan_id = pl.rate_plan_id
      AND start_date  <= sd.stay_date
      AND end_date    >= sd.stay_date
      AND is_active
    ORDER BY priority DESC
    LIMIT 1
  ) o ON TRUE
  GROUP BY pl.rate_plan_id
),
plan_modifiers AS (
  SELECT
    rate_plan_id,
    jsonb_agg(jsonb_build_object(
      'type',              type,
      'adjustment_type',   adjustment_type,
      'adjustment_value',  adjustment_value,
      'trigger_condition', trigger_condition,
      'sort_order',        sort_order
    ) ORDER BY sort_order) AS modifiers
  FROM rate_modifiers
  WHERE is_active AND rate_plan_id IN (SELECT rate_plan_id FROM plans)
  GROUP BY rate_plan_id
),
tax AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'effectiveFrom',  t.effective_from::text,
    'charges',        t.charges,
    'childrenExempt', t.children_exempt,
    'maxNights',      t.max_nights
  ) ORDER BY t.effective_from), '[]'::jsonb) AS rules
  FROM tourist_tax_rules t
  WHERE t.property_id = $1
)
SELECT
  pl.*,
  NULL::text AS hero_image_url,
  rn.nights,
  COALESCE(pm.modifiers, '[]'::jsonb) AS modifiers,
  tax.rules AS tourist_tax_rules
FROM plans pl
JOIN room_nights rn ON rn.rate_plan_id = pl.rate_plan_id
LEFT JOIN plan_modifiers pm ON pm.rate_plan_id = pl.rate_plan_id
CROSS JOIN tax
ORDER BY pl.room_sort, pl.room_name, pl.room_id, pl.plan_sort, pl.rate_plan_name, pl.rate_plan_id
`;

async function loadPlanRows(db: Queryable, i: { propertyId: string; checkIn: string; checkOut: string }): Promise<PlanRow[]> {
  const { rows } = await db.query(PLAN_ROWS_SQL, [i.propertyId, i.checkIn, i.checkOut]);
  return rows as PlanRow[];
}

/** "Breakfast included", "Half board"…, or null for room only. */
function mealPlan(row: PlanRow): string | null {
  const { includes_breakfast: b, includes_lunch: l, includes_dinner: d } = row;
  if (b && l && d) return "Full board";
  if (b && d && !l) return "Half board";
  const meals = [b && "breakfast", l && "lunch", d && "dinner"].filter(Boolean) as string[];
  if (meals.length === 0) return null;
  const list = meals.length === 1 ? meals[0] : `${meals.slice(0, -1).join(", ")} and ${meals[meals.length - 1]}`;
  return `${list[0].toUpperCase()}${list.slice(1)} included`;
}

function cancellationUntil(property: VisibleProperty, isRefundable: boolean, arrivalDate: string, now: Date): string | null {
  const until = freeCancellationUntil({
    tier: snapshotTier(property.cancellationTier, isRefundable),
    timeZone: property.timezone,
    checkInTime: property.checkInTime,
    arrivalDate,
    now,
  });
  return until ? until.toISOString() : null;
}

type PricedRoom = {
  roomId: string;
  name: string;
  roomType: string | null;
  plans: { row: PlanRow; priced: ResolvedRoom }[];
};

/**
 * Each room's rate plans priced for one party, with Non-refundable rates that
 * fail Annex B B.4.3 for this stay already dropped: a Non-refundable rate is
 * offered only beside a refundable rate on the same room that can be booked
 * for these dates (no rate-plan reasons) and costs at least 10% more. The
 * comparison is on the stay's room price, the number the guest would pay, not
 * the base rate. Room-level reasons (sold out, closed…) hit every rate alike,
 * so they don't decide this.
 */
function priceRooms(
  rows: PlanRow[],
  byRoom: Map<string, RoomAvailability>,
  party: { adults: number; children: number },
  arrivalDate: string,
  today: string,
): PricedRoom[] {
  const rooms = new Map<string, PricedRoom>();
  for (const row of rows) {
    const room = rooms.get(row.room_id) ?? { roomId: row.room_id, name: row.room_name, roomType: row.room_type, plans: [] };
    room.plans.push({ row, priced: resolveRoom(row, { ...party, arrivalDate }, today) });
    rooms.set(row.room_id, room);
  }
  for (const room of rooms.values()) {
    const plans = byRoom.get(room.roomId)?.ratePlans ?? [];
    const open = (ratePlanId: string) => plans.some((p) => p.ratePlanId === ratePlanId && p.reasons.length === 0);
    const refundableTotals = room.plans
      .filter((p) => p.row.is_refundable && open(p.row.rate_plan_id))
      .map((p) => p.priced.room_price);
    room.plans = room.plans.filter((p) => p.row.is_refundable || nonRefundableQualifies(p.priced.room_price, refundableTotals));
  }
  return [...rooms.values()];
}

/** The quote for a visible property, or null when the guest may not see it. Validate `stay` first. */
export async function quoteStay(
  db: Queryable,
  i: { propertyId: string; stay: StayInput; now: Date; testing: boolean },
): Promise<StayQuote | null> {
  const property = await loadVisibleProperty(db, { id: i.propertyId }, i.testing);
  if (!property) return null;

  const { checkIn, checkOut } = i.stay;
  const [rows, availability] = await Promise.all([
    loadPlanRows(db, { propertyId: property.id, checkIn, checkOut }),
    loadStayAvailability(db, { propertyId: property.id, checkIn, checkOut, now: i.now }),
  ]);
  const byRoom = new Map(availability.map((a) => [a.roomId, a]));
  const party = perRoomParty(i.stay);
  const today = todayInZone(property.timezone, i.now);

  const rooms: QuotedRoom[] = [];
  for (const room of priceRooms(rows, byRoom, party, checkIn, today)) {
    const a = byRoom.get(room.roomId);
    if (!a) continue;
    const reasons = roomReasons(a, party);
    // Every rate was a Non-refundable one that may not be offered alone.
    if (room.plans.length === 0 && !reasons.includes("not_on_sale")) reasons.push("not_on_sale");
    rooms.push({
      roomId: room.roomId,
      name: room.name,
      roomType: room.roomType,
      maxAdults: a.maxAdults,
      maxChildren: a.maxChildren,
      total: a.total,
      unitsLeft: a.unitsLeft,
      reasons,
      ratePlans: room.plans.map(({ row, priced }) => ({
        ratePlanId: row.rate_plan_id,
        name: row.rate_plan_name,
        isRefundable: row.is_refundable,
        mealPlan: mealPlan(row),
        nights: priced.priced_nights,
        stayTotal: priced.room_price,
        touristTax: priced.tourist_tax,
        freeCancellationUntil: cancellationUntil(property, row.is_refundable, checkIn, i.now),
        reasons: a.ratePlans.find((p) => p.ratePlanId === row.rate_plan_id)?.reasons ?? ["not_on_sale"],
      })),
    });
  }

  return { propertyId: property.id, slug: property.slug, currency: "EUR", stay: i.stay, rooms };
}

type SelectionResult =
  | { ok: true; rooms: IntentRoomInput[]; snapshot: IntentSnapshot }
  | { ok: false; error: "invalid_selection" | "too_many_guests" | "unavailable"; detail: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

function applicationFeeEnabled(): boolean {
  return process.env.STRIPE_APPLICATION_FEE_ENABLED === "true";
}

/**
 * Re-prices a guest's selection on the server, each room for its own party,
 * and checks it early so the guest hears about a problem before a hold is
 * attempted. Not authoritative: intent creation re-checks under lock.
 *
 * Fails `invalid_selection` for anything the guest could not have been shown
 * (a stay outside the quote's bounds or before today in the property's zone,
 * more than MAX_ROOMS rooms, another property's room, an unknown or hidden
 * rate, a demo hotel with testing off), `too_many_guests` for a room's party over its maximum, and
 * `unavailable` when a room has fewer units left than selected or its rate
 * cannot be booked for these dates.
 */
export async function priceSelection(
  db: Queryable,
  i: { propertyId: string; checkIn: string; checkOut: string; selection: SelectedRoom[]; now: Date; testing: boolean },
): Promise<SelectionResult> {
  const invalid = (detail: string): SelectionResult => ({ ok: false, error: "invalid_selection", detail });
  const bounds = stayBoundErrors({ checkin: i.checkIn, checkout: i.checkOut });
  if (bounds.length > 0) return invalid(bounds.join("; "));
  if (i.selection.length === 0) return invalid("no rooms selected");
  if (i.selection.length > MAX_ROOMS) return invalid(`at most ${MAX_ROOMS} rooms per booking`);
  for (const s of i.selection) {
    if (!Number.isInteger(s.adults) || s.adults < 1 || !Number.isInteger(s.children) || s.children < 0) {
      return invalid("every room needs a whole number of guests, at least one adult");
    }
  }

  const property = await loadVisibleProperty(db, { id: i.propertyId }, i.testing);
  if (!property) return invalid("property not found");
  // Both are real dates here, so string order is date order.
  const today = todayInZone(property.timezone, i.now);
  if (i.checkIn < today) return invalid("checkin cannot be in the past");

  const [rows, availability] = await Promise.all([
    loadPlanRows(db, { propertyId: property.id, checkIn: i.checkIn, checkOut: i.checkOut }),
    loadStayAvailability(db, { propertyId: property.id, checkIn: i.checkIn, checkOut: i.checkOut, now: i.now }),
  ]);
  const byRoom = new Map(availability.map((a) => [a.roomId, a]));

  type Picked = { s: SelectedRoom; room: PricedRoom; plan: PricedRoom["plans"][number]; a: RoomAvailability };
  const picked: Picked[] = [];
  for (const s of i.selection) {
    const roomRows = rows.filter((r) => r.room_id === s.roomId);
    const a = byRoom.get(s.roomId);
    if (roomRows.length === 0 || !a) return invalid(`room ${s.roomId} is not offered at this property`);
    const [room] = priceRooms(roomRows, byRoom, { adults: s.adults, children: s.children }, i.checkIn, today);
    const plan = room?.plans.find((p) => p.row.rate_plan_id === s.ratePlanId);
    if (!room || !plan) return invalid(`rate ${s.ratePlanId} is not offered for ${roomRows[0].room_name}`);
    picked.push({ s, room, plan, a });
  }

  for (const { s, room, a } of picked) {
    if (s.adults > a.maxAdults || s.children > a.maxChildren) {
      return {
        ok: false,
        error: "too_many_guests",
        detail: `${room.name} takes at most ${a.maxAdults} adults and ${a.maxChildren} children`,
      };
    }
  }

  const wanted = new Map<string, number>();
  for (const { s } of picked) wanted.set(s.roomId, (wanted.get(s.roomId) ?? 0) + 1);
  for (const { s, room, plan, a } of picked) {
    const count = wanted.get(s.roomId) ?? 0;
    if (count > a.unitsLeft) {
      return { ok: false, error: "unavailable", detail: `${room.name}: ${a.unitsLeft} left, ${count} selected` };
    }
    const reasons = [
      ...roomReasons(a, s),
      ...(a.ratePlans.find((p) => p.ratePlanId === s.ratePlanId)?.reasons ?? ["not_on_sale" as const]),
    ];
    if (reasons.length > 0) {
      return { ok: false, error: "unavailable", detail: `${room.name} (${plan.row.rate_plan_name}): ${reasons.join(", ")}` };
    }
  }

  const rooms: IntentRoomInput[] = picked.map(({ s, plan }) => ({
    roomId: s.roomId,
    ratePlanId: s.ratePlanId,
    adults: s.adults,
    children: s.children,
    nights: plan.priced.priced_nights,
    stayTotal: plan.priced.room_price,
    touristTax: plan.priced.tourist_tax.total,
    touristTaxLines: plan.priced.tourist_tax.lines,
  }));
  const roomsTotal = round2(rooms.reduce((sum, r) => sum + r.stayTotal, 0));
  const touristTaxTotal = round2(rooms.reduce((sum, r) => sum + r.touristTax, 0));

  // The fee is VAT-inclusive; its net/VAT split is fixed here, from the host's
  // billing profile. No profile yet: the split stays empty rather than refusing
  // the quote (readiness is gated elsewhere).
  const commissionRate = Number(property.commissionRate);
  const commissionCents = applicationFeeEnabled() ? applicationFeeCents(toCents(roomsTotal), commissionRate) : 0;
  const treatment = await billingTreatmentForProperty(property.id, db);
  const split = treatment ? commissionSplit({ feeCents: commissionCents, treatment }) : null;

  return {
    ok: true,
    rooms,
    snapshot: {
      roomsTotal,
      touristTaxTotal,
      total: round2(roomsTotal + touristTaxTotal),
      // The stay only: tourist tax passes through to the host untouched.
      commissionCents,
      commissionRate,
      commissionVatTreatment: treatment,
      commissionNetCents: split ? split.netCents : null,
      commissionVatCents: split ? split.vatCents : null,
      currency: "EUR",
      rooms: picked.map(({ s, room, plan }) => ({
        roomId: s.roomId,
        ratePlanId: s.ratePlanId,
        roomName: room.name,
        ratePlanName: plan.row.rate_plan_name,
        isRefundable: plan.row.is_refundable,
        freeCancellationUntil: cancellationUntil(property, plan.row.is_refundable, i.checkIn, i.now),
      })),
    },
  };
}

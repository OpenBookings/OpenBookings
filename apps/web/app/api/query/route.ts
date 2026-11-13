import {
  getDb,
  getPool,
  loadRoomsAvailability,
  sql,
  summariseSearchAvailability,
  withTransaction,
} from "@openbookings/db";
import { ensureDemoHotels, hasDemoHotelsNear, isTestingMode } from "@openbookings/demo";
import { freeCancellationUntil, isValidTimeZone, perRoomParty, resolveSearchResults, snapshotTier } from "@openbookings/pricing";
import type { RoomRow } from "@openbookings/pricing";
import { getPostHogClient } from "@openbookings/analytics/server";
import { NextRequest, NextResponse } from "next/server";
import { parseStayInput, todayInZone, type StayInput } from "@/lib/booking/stay-input";
import { orderByAvailability, priceCandidates } from "./availability-order";
import { pointBoundErrors } from "./search-bounds";
import { resolveSearchTarget } from "./search-target";

type SearchInput = StayInput & {
  lat: number;
  lon: number;
  /** The destination label the guest searched, for naming generated demo hotels. */
  place: string | null;
};

/**
 * Search spans every EU time zone and has no single property's, so "in the
 * past" is judged in the westernmost one: the Azores' today is the earliest
 * today anywhere in the EU, so no guest is refused a stay that starts tonight
 * where they are. The stay quote and booking intents use the property's zone.
 */
const SEARCH_ZONE = "Atlantic/Azores";

/** Parse and validate URL params. Nothing reaches generate_series unless this passes. */
function parseSearchParams(searchParams: URLSearchParams): { input: SearchInput | null; errors: string[] } {
  const errors: string[] = [];
  const coordinate = (name: "lat" | "lon"): number => {
    const v = searchParams.get(name);
    if (v == null || v === "") {
      errors.push(`${name} is required`);
      return NaN;
    }
    const n = Number(v);
    if (Number.isNaN(n)) errors.push(`${name} must be a number`);
    return n;
  };
  const lat = coordinate("lat");
  const lon = coordinate("lon");
  if (errors.length === 0) errors.push(...pointBoundErrors({ lat, lon }));

  const stay = parseStayInput(searchParams, todayInZone(SEARCH_ZONE));
  if (!stay.ok) errors.push(...stay.errors);
  if (errors.length > 0 || !stay.ok) return { input: null, errors };

  const place = searchParams.get("place")?.trim().slice(0, 200) || null;
  return { input: { ...stay.value, lat, lon, place }, errors };
}

/**
 * Testing mode: the first search near a point creates the eight demo hotels
 * there. Steady state is one indexed query; the generator's transaction and
 * lock only run for a new area. A failure is logged and the search goes on.
 */
async function ensureDemoArea(i: { lat: number; lon: number; place: string | null }): Promise<void> {
  try {
    if (await hasDemoHotelsNear(getPool(), i)) return;
    await withTransaction((tx) => ensureDemoHotels(tx, i));
  } catch (err) {
    console.error("[search] demo hotels:", err instanceof Error ? err.message : err);
  }
}

function buildHotelSearchQuery(lat: number, lon: number, checkin: string, checkout: string, testing: boolean) {
  return sql`
-- ─────────────────────────────────────────────
-- Inputs
-- ─────────────────────────────────────────────
WITH user_input AS (
  SELECT
    ${lat}::float AS lat,
    ${lon}::float AS lng,
    ${checkin}::date  AS arrival,
    ${checkout}::date AS departure
),

-- ─────────────────────────────────────────────
-- Derived: stay nights
-- ─────────────────────────────────────────────
stay_dates AS (
  SELECT generate_series(
    (SELECT arrival FROM user_input),
    (SELECT departure - INTERVAL '1 day' FROM user_input),
    INTERVAL '1 day'
  )::date AS stay_date
),

-- ─────────────────────────────────────────────
-- Step 1: Active rooms within radius. Whether a room fits the party or
-- is available is the availability rule's call, after this query.
-- ─────────────────────────────────────────────
candidate_rooms AS (
  SELECT
    p.id             AS property_id,
    p.name           AS property_name,
    p.slug           AS hotel_slug,
    p.city,
    p.country,
    (
      SELECT pi.url
      FROM property_images pi
      WHERE pi.property_id = p.id
      ORDER BY (CASE WHEN pi.group = 'hero-image' THEN 0 ELSE 1 END) ASC, pi.sort_order ASC, pi.created_at ASC
      LIMIT 1
    )                AS hero_image_url,
    ST_Distance(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(u.lng, u.lat), 4326)::geography
    )                AS distance_m,
    r.id             AS room_id,
    r.name           AS room_name,
    r.description    AS room_description,
    r.base_occupancy,
    r.max_adults,
    r.max_children,
    -- bigint comes back as a string from node-postgres; the resolver adds these.
    r.extra_adult_fee::int,
    r.extra_child_fee::int,
    r.cot_fee::int,
    r.extra_bed_fee::int,
    rp.id            AS rate_plan_id,
    rp.name          AS rate_plan_name,
    rp.bar,
    rp.currency,
    rp.is_refundable,
    p.cancellation_tier,
    p.timezone,
    to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
    rp.min_stay,
    rp.max_stay
  FROM properties p
  JOIN rooms r
    ON r.property_id = p.id
   AND r.is_active
  CROSS JOIN user_input u
  JOIN LATERAL (
    SELECT id, name, bar, currency, is_refundable, min_stay, max_stay
    FROM rate_plans
    WHERE room_id = r.id
      AND is_active
    -- A search card shows one rate, and a Non-refundable rate may only be
    -- offered beside a refundable one (Annex B B.4.3), so prefer refundable.
    ORDER BY is_refundable DESC, created_at DESC
    LIMIT 1
  ) rp ON TRUE
  WHERE p.is_active
    AND (NOT p.is_demo OR ${testing})
    AND ST_DWithin(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(u.lng, u.lat), 4326)::geography,
      250000
    )
),

-- ─────────────────────────────────────────────
-- Step 2: Per-night base price (override or BAR)
-- ─────────────────────────────────────────────
nightly_pricing AS (
  SELECT
    cr.property_id,
    cr.room_id,
    cr.rate_plan_id,
    sd.stay_date,
    COALESCE(o.price_per_night, cr.bar) AS base_price,
    (o.price_per_night IS NOT NULL)     AS has_override
  FROM candidate_rooms cr
  CROSS JOIN stay_dates sd
  LEFT JOIN LATERAL (
    SELECT price_per_night
    FROM rate_overrides
    WHERE rate_plan_id = cr.rate_plan_id
      AND start_date  <= sd.stay_date
      AND end_date    >= sd.stay_date
      AND is_active
    ORDER BY priority DESC
    LIMIT 1
  ) o ON TRUE
),

-- ─────────────────────────────────────────────
-- Step 3: Aggregate nights per room
-- ─────────────────────────────────────────────
room_nights AS (
  SELECT
    property_id,
    room_id,
    rate_plan_id,
    jsonb_agg(
      jsonb_build_object(
        'date',         stay_date,
        'base_price',   base_price,
        'has_override', has_override
      )
      ORDER BY stay_date
    ) AS nights
  FROM nightly_pricing
  GROUP BY property_id, room_id, rate_plan_id
),

-- ─────────────────────────────────────────────
-- Step 4: All modifiers for the rate plan
-- ─────────────────────────────────────────────
room_modifiers AS (
  SELECT
    rate_plan_id,
    jsonb_agg(
      jsonb_build_object(
        'type',              type,
        'adjustment_type',   adjustment_type,
        'adjustment_value',  adjustment_value,
        'trigger_condition', trigger_condition,
        'sort_order',        sort_order
      )
      ORDER BY sort_order
    ) AS modifiers
  FROM rate_modifiers
  WHERE is_active
  GROUP BY rate_plan_id
)

-- ─────────────────────────────────────────────
-- Final output — all qualifying rooms, resolver handles the rest
-- ─────────────────────────────────────────────
SELECT
  cr.property_id    AS hotel_id,
  cr.property_name  AS hotel_name,
  cr.hotel_slug,
  cr.city,
  cr.country,
  cr.hero_image_url,
  cr.distance_m,
  cr.room_id,
  cr.room_name,
  cr.room_description,
  cr.base_occupancy,
  cr.max_adults,
  cr.max_children,
  cr.extra_adult_fee,
  cr.extra_child_fee,
  cr.cot_fee,
  cr.extra_bed_fee,
  cr.rate_plan_id,
  cr.rate_plan_name,
  cr.currency,
  cr.is_refundable,
  cr.cancellation_tier,
  cr.timezone,
  cr.check_in_time,
  cr.min_stay,
  cr.max_stay,
  rn.nights,
  COALESCE(rm.modifiers, '[]'::jsonb) AS modifiers,
  -- Tourist tax goes on top of the room price, so the guest is ranked and
  -- shown the all-in price. The resolver picks the rule for each night.
  COALESCE(tt.rules, '[]'::jsonb) AS tourist_tax_rules
FROM candidate_rooms cr
JOIN room_nights rn
  ON rn.property_id  = cr.property_id
 AND rn.room_id      = cr.room_id
 AND rn.rate_plan_id = cr.rate_plan_id
LEFT JOIN room_modifiers rm
  ON rm.rate_plan_id = cr.rate_plan_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'effectiveFrom',               t.effective_from::text,
    'charges',                     t.charges,
    'childrenExempt',              t.children_exempt,
    'maxNights',                   t.max_nights
  ) ORDER BY t.effective_from) AS rules
  FROM tourist_tax_rules t
  WHERE t.property_id = cr.property_id
) tt ON TRUE;
`;
}

async function runSearch(input: SearchInput, testing: boolean) {
  const result = await getDb().execute<RoomRow>(buildHotelSearchQuery(input.lat, input.lon, input.checkIn, input.checkOut, testing))
  const rows = result.rows
  if (rows.length === 0) return []

  const roomRows = rows.map(row => ({
    ...row,
    nights:    typeof row.nights    === 'string' ? JSON.parse(row.nights)    : row.nights,
    modifiers: typeof row.modifiers === 'string' ? JSON.parse(row.modifiers) : row.modifiers,
    tourist_tax_rules:
      typeof row.tourist_tax_rules === 'string' ? JSON.parse(row.tourist_tax_rules) : row.tourist_tax_rules,
  })) as RoomRow[]

  const now = new Date()
  const propertyIds = [...new Set(roomRows.map(row => row.hotel_id))]
  const rooms = await loadRoomsAvailability(getPool(), {
    propertyIds,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    now,
  })
  const availability = summariseSearchAvailability(rooms, { propertyIds, ...input })
  // Each card is priced for one room's share of the party.
  const party = perRoomParty(input)

  const results = resolveSearchResults(priceCandidates(roomRows, rooms, availability, party), {
    adults: party.adults,
    children: party.children,
    infants: party.infants,
    arrivalDate: input.checkIn,
  }).map(result => {
    // A stored timezone is not trusted: a bad one must not fail the whole search.
    const zoneOk = !result.timezone || isValidTimeZone(result.timezone)
    if (!zoneOk) console.error("[search] bad property timezone", result.hotel_id)
    const until =
      zoneOk && result.cancellation_tier && result.timezone
        ? freeCancellationUntil({
            tier: snapshotTier(result.cancellation_tier, result.is_refundable),
            timeZone: result.timezone,
            checkInTime: result.check_in_time ?? null,
            arrivalDate: input.checkIn,
            now,
          })
        : null
    const a = availability.get(result.hotel_id)
    return {
      ...result,
      free_cancellation_until: until ? until.toISOString() : null,
      availability: { bookable: a?.bookable ?? false, reason: a?.reason ?? null },
    }
  })
  return orderByAvailability(results, { testing })
}

/** Analytics properties, under the names the search events have always used. */
function searchProperties(i: SearchInput) {
  return {
    lat: i.lat,
    lon: i.lon,
    checkin: i.checkIn,
    checkout: i.checkOut,
    adults: i.adults,
    children: i.children,
    infants: i.infants,
    rooms: i.rooms,
  }
}

export async function GET(request: NextRequest) {
  const target = await resolveSearchTarget(request.nextUrl.searchParams)
  if (!target.ok) {
    return NextResponse.json({ errors: target.errors }, { status: 400 })
  }
  const searchParams = new URLSearchParams(request.nextUrl.searchParams)
  if (target.lat != null) searchParams.set("lat", target.lat)
  if (target.lon != null) searchParams.set("lon", target.lon)
  if (target.place) searchParams.set("place", target.place)
  const { input, errors } = parseSearchParams(searchParams)
  const distinctId = request.headers.get("x-posthog-distinct-id") ?? "anonymous"

  if (!input) {
    return NextResponse.json({ errors }, { status: 400 })
  }

  const testing = isTestingMode()
  if (testing) await ensureDemoArea(input)

  let results
  try {
    results = await runSearch(input, testing)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error"

    // The detail goes to our own telemetry and logs. It does not go to the
    // caller: a Postgres error text names tables, columns and constraints,
    // which hands an unauthenticated client a free schema dump and turns a
    // malformed-input probe into a discovery tool.
    console.error("[search]", message)

    const posthog = getPostHogClient()
    posthog.capture({
      distinctId,
      event: "hotel_search_failed",
      properties: {
        error_message: message,
        ...searchProperties(input),
      },
    })
    await posthog.shutdown()

    return NextResponse.json({ error: "Search is unavailable right now" }, { status: 500 })
  }

  const posthog = getPostHogClient()
  posthog.capture({
    distinctId,
    event: "hotel_search_completed",
    properties: {
      result_count: results.length,
      ...searchProperties(input),
    },
  })
  await posthog.shutdown()

  return NextResponse.json(results)
}
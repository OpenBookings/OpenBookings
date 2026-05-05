import type { HotelSearchInput } from "@/types/hotel";
import { query } from "@openbookings/db";
import { resolveSearchResults } from "@/app/api/query/calculator";
import type { RoomRow } from "@/app/api/query/calculator";
import { getPostHogClient } from "@openbookings/analytics/server";
import { NextRequest, NextResponse } from "next/server";

/** Parse and validate URL params into HotelSearchInput */
function parseSearchParams(
  searchParams: URLSearchParams
): { input: HotelSearchInput; errors: string[] } {
  const errors: string[] = [];
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const checkin = searchParams.get("checkin");
  const checkout = searchParams.get("checkout");
  const adults = searchParams.get("adults");
  const children = searchParams.get("children");
  const rooms = searchParams.get("rooms");

  const num = (v: string | null, name: string): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (Number.isNaN(n)) {
      errors.push(`${name} must be a number`);
      return null;
    }
    return n;
  };

  const latN = num(lat, "lat");
  const lonN = num(lon, "lon");
  const adultsN = num(adults, "adults");
  const roomsN = num(rooms, "rooms");
  let childrenN: number | null = null;
  if (children != null && children !== "") {
    const c = num(children, "children");
    if (c != null) childrenN = c;
  }

  if (lat == null || lat === "") errors.push("lat is required");
  if (lon == null || lon === "") errors.push("lon is required");
  if (checkin == null || checkin === "") errors.push("checkin is required");
  if (checkout == null || checkout === "") errors.push("checkout is required");
  if (adults == null || adults === "") errors.push("adults is required");
  if (rooms == null || rooms === "") errors.push("rooms is required");

  if (errors.length > 0) {
    return {
      input: {
        lat: latN ?? 0,
        lon: lonN ?? 0,
        checkin: checkin ?? "",
        checkout: checkout ?? "",
        adults: adultsN ?? 0,
        children: childrenN,
        rooms: roomsN ?? 0,
      },
      errors,
    };
  }

  const input: HotelSearchInput = {
    lat: latN as number,
    lon: lonN as number,
    checkin: checkin as string,
    checkout: checkout as string,
    adults: adultsN as number,
    children: childrenN,
    rooms: roomsN as number,
  };
  return { input, errors };
}

const HOTEL_SEARCH_SQL = `
-- ─────────────────────────────────────────────
-- Inputs
-- ─────────────────────────────────────────────
WITH user_input AS (
  SELECT
    $1::float AS lat,
    $2::float AS lng,
    $3::date  AS arrival,
    $4::date  AS departure,
    $5::int   AS adults,
    $6::int   AS children
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
-- Step 1: Active rooms within radius that fit guest count
-- ─────────────────────────────────────────────
candidate_rooms AS (
  SELECT
    p.id             AS property_id,
    p.name           AS property_name,
    p.slug           AS hotel_slug,
    p.city,
    p.country,
    r.id             AS room_id,
    r.name           AS room_name,
    r.description    AS room_description,
    r.base_occupancy,
    r.max_adults,
    r.max_children,
    rp.id            AS rate_plan_id,
    rp.name          AS rate_plan_name,
    rp.bar,
    rp.currency,
    rp.is_refundable,
    rp.cancellation_policy,
    rp.min_stay,
    rp.max_stay
  FROM properties p
  JOIN rooms r
    ON r.property_id = p.id
   AND r.is_active
  CROSS JOIN user_input u
  JOIN LATERAL (
    SELECT id, name, bar, currency, is_refundable, cancellation_policy, min_stay, max_stay
    FROM rate_plans
    WHERE room_id = r.id
      AND is_active
    ORDER BY created_at DESC
    LIMIT 1
  ) rp ON TRUE
  WHERE u.adults   <= r.max_adults
    AND u.children <= r.max_children
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
  cr.room_id,
  cr.room_name,
  cr.room_description,
  cr.base_occupancy,
  cr.max_adults,
  cr.max_children,
  cr.rate_plan_id,
  cr.rate_plan_name,
  cr.currency,
  cr.is_refundable,
  cr.cancellation_policy,
  cr.min_stay,
  cr.max_stay,
  rn.nights,
  COALESCE(rm.modifiers, '[]'::jsonb) AS modifiers
FROM candidate_rooms cr
JOIN room_nights rn
  ON rn.property_id  = cr.property_id
 AND rn.room_id      = cr.room_id
 AND rn.rate_plan_id = cr.rate_plan_id
LEFT JOIN room_modifiers rm
  ON rm.rate_plan_id = cr.rate_plan_id;
`;

async function runSearch(input: HotelSearchInput) {
  const children = input.children ?? 0

  const rows = await query<RoomRow>(HOTEL_SEARCH_SQL, [
    input.lat,
    input.lon,
    input.checkin,
    input.checkout,
    input.adults,
    children,
  ])

  const roomRows = rows.map(row => ({
    ...row,
    nights:    typeof row.nights    === 'string' ? JSON.parse(row.nights)    : row.nights,
    modifiers: typeof row.modifiers === 'string' ? JSON.parse(row.modifiers) : row.modifiers,
  })) as RoomRow[]
  
  return resolveSearchResults(roomRows, {
    adults: input.adults,
    children,
    arrivalDate: input.checkin,
  })
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const { input, errors } = parseSearchParams(searchParams)
  const distinctId = request.headers.get("x-posthog-distinct-id") ?? "anonymous"

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 })
  }

  let results
  try {
    results = await runSearch(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error"

    const posthog = getPostHogClient()
    posthog.capture({
      distinctId,
      event: "hotel_search_failed",
      properties: {
        error_message: message,
        ...input,
      },
    })
    await posthog.shutdown()

    return NextResponse.json({ error: message }, { status: 500 })
  }

  const posthog = getPostHogClient()
  posthog.capture({
    distinctId,
    event: "hotel_search_completed",
    properties: {
      result_count: results.length,
      ...input,
    },
  })
  await posthog.shutdown()

  return NextResponse.json(results)
}
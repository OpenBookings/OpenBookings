import type { Queryable } from "@openbookings/db";
import { MANAGED_NIGHT_PRICE_SQL, MANAGED_PROPERTY_SQL } from "@openbookings/db/apps";
import type { RoomRow } from "@openbookings/pricing";

/**
 * Guest search's rooms within reach of a point, one rate plan each, with what
 * the resolver needs to price them for the stay. Whether a room fits the party
 * or is available is the availability rule's call, after this query.
 *
 * $1 lat, $2 lon, $3 check-in, $4 check-out, $5 whether demo hotels count
 * (testing mode). Validate the inputs first: nothing unchecked may reach
 * generate_series (search-bounds.ts).
 */
export const HOTEL_SEARCH_SQL = `
-- ─────────────────────────────────────────────
-- Inputs
-- ─────────────────────────────────────────────
WITH user_input AS (
  SELECT
    $1::float AS lat,
    $2::float AS lng,
    $3::date  AS arrival,
    $4::date  AS departure
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
    r.extra_adult_fee_cents::int,
    r.extra_child_fee_cents::int,
    r.cot_fee_cents::int,
    r.extra_bed_fee_cents::int,
    rp.id            AS rate_plan_id,
    rp.name          AS rate_plan_name,
    rp.bar_cents,
    rp.currency,
    rp.is_refundable,
    p.cancellation_tier,
    p.timezone,
    to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
    rp.min_stay,
    rp.max_stay,
    -- A connected app (SiteMinder) prices this room's plans.
    ${MANAGED_PROPERTY_SQL} AS managed
  FROM properties p
  JOIN rooms r
    ON r.property_id = p.id
   AND r.is_active
  CROSS JOIN user_input u
  JOIN LATERAL (
    SELECT id, name, bar_cents, currency, is_refundable, min_stay, max_stay
    FROM rate_plans
    WHERE room_id = r.id
      AND is_active
    -- A search card shows one rate, and a Non-refundable rate may only be
    -- offered beside a refundable one (Annex B B.4.1), so prefer refundable.
    ORDER BY is_refundable DESC, created_at DESC
    LIMIT 1
  ) rp ON TRUE
  WHERE p.is_active
    AND (NOT p.is_demo OR $5::boolean)
    AND ST_DWithin(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(u.lng, u.lat), 4326)::geography,
      250000
    )
),

-- ─────────────────────────────────────────────
-- Step 2: Per-night base price: override or BAR, or on a managed plan the
-- app's price and extra-guest fees (MANAGED_NIGHT_PRICE_SQL).
-- ─────────────────────────────────────────────
nightly_pricing AS (
  SELECT
    plan_night.property_id,
    plan_night.room_id,
    plan_night.rate_plan_id,
    plan_night.date AS stay_date,
    price.base_price_cents,
    price.has_override,
    price.extra_adult_fee_cents,
    price.extra_child_fee_cents,
    price.priced
  FROM (
    SELECT cr.property_id, cr.room_id, cr.rate_plan_id, cr.bar_cents, cr.managed, sd.stay_date AS date
    FROM candidate_rooms cr CROSS JOIN stay_dates sd
  ) plan_night
  CROSS JOIN LATERAL (${MANAGED_NIGHT_PRICE_SQL}) price
),

-- ─────────────────────────────────────────────
-- Step 3: Aggregate nights per room. A managed plan with a night the app sent
-- no price for is not offered: that night is closed, and nothing of ours may
-- price it.
-- ─────────────────────────────────────────────
room_nights AS (
  SELECT
    property_id,
    room_id,
    rate_plan_id,
    jsonb_agg(
      jsonb_build_object(
        'date',         stay_date,
        'base_price_cents', base_price_cents,
        'has_override', has_override
      ) || jsonb_strip_nulls(jsonb_build_object(
        'extra_adult_fee_cents', extra_adult_fee_cents,
        'extra_child_fee_cents', extra_child_fee_cents
      ))
      ORDER BY stay_date
    ) AS nights
  FROM nightly_pricing
  GROUP BY property_id, room_id, rate_plan_id
  HAVING bool_and(priced)
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
  cr.extra_adult_fee_cents,
  cr.extra_child_fee_cents,
  cr.cot_fee_cents,
  cr.extra_bed_fee_cents,
  cr.rate_plan_id,
  cr.rate_plan_name,
  cr.currency,
  cr.is_refundable,
  cr.cancellation_tier,
  cr.timezone,
  cr.check_in_time,
  cr.min_stay,
  cr.max_stay,
  cr.managed,
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
-- Discount rules are off on a plan a connected app prices.
LEFT JOIN room_modifiers rm
  ON rm.rate_plan_id = cr.rate_plan_id
 AND NOT cr.managed
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'effectiveFrom',               t.effective_from::text,
    'charges',                     t.charges,
    'childrenExempt',              t.children_exempt,
    'infantsTaxed',                t.infants_taxed,
    'maxNights',                   t.max_nights
  ) ORDER BY t.effective_from) AS rules
  FROM tourist_tax_rules t
  WHERE t.property_id = cr.property_id
) tt ON TRUE;
`;

const parsed = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);

/** The search's candidate rows, ready for the resolver. */
export async function loadSearchRows(
  db: Queryable,
  i: { lat: number; lon: number; checkIn: string; checkOut: string; testing: boolean },
): Promise<RoomRow[]> {
  const { rows } = await db.query(HOTEL_SEARCH_SQL, [i.lat, i.lon, i.checkIn, i.checkOut, i.testing]);
  return (rows as RoomRow[]).map((row) => ({
    ...row,
    nights: parsed(row.nights),
    modifiers: parsed(row.modifiers),
    tourist_tax_rules: parsed(row.tourist_tax_rules ?? []),
  }));
}

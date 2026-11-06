/**
 * Demo hotels on demand: the first search near a point (in testing mode — the
 * caller checks that, not this module) creates eight hotels there, one per
 * scenario in scenarios.ts, owned by the demo organisation.
 *
 * The rng is seeded with the area key alone, so an area always gets the same
 * names, places and prices whatever dates were searched; `place` only sets
 * the city label.
 */

import type { Queryable } from "@openbookings/db";
import {
  insertAvailabilityOverride,
  insertDayOfWeekModifier,
  insertDemoProperty,
  insertDemoRatePlan,
  insertDemoRoom,
  insertRestriction,
  insertTouristTaxRule,
  pickDemoImages,
  pickRoomImage,
  type MealPlan,
} from "./factories";
import { ensureDemoOrganisation } from "./organisation";
import { nearestEuPlace } from "./places";
import { areaKey, seededRng, type Rng } from "./random";
import { DEMO_SCENARIOS, SCENARIOS, nonRefundableBar, type ScenarioSpec } from "./scenarios";

/** A point with any demo hotel this close already has its set. */
const NEAR_METERS = 25_000;
/** Hotels are scattered up to this far from the searched point. */
const SPREAD_METERS = 2_800;
const METERS_PER_DEGREE = 111_320;

/**
 * Dated rules (sold out, closed to arrival) run from yesterday — a guest whose
 * local date is behind the database's still starts inside them — through
 * two years of arrivals plus the longest stay a search prices (30 nights).
 */
const RULE_DAYS_BEFORE = 1;
const RULE_DAYS_AFTER = 730 + 30;

const ADJECTIVES = [
  "Golden", "Quiet", "Silver", "Little", "Old", "Blue", "Green", "Hidden",
  "Grand", "Copper", "Amber", "Velvet", "Linden", "Morning", "Northern", "Olive",
] as const;
const NOUNS = [
  "Harbour", "Garden", "Lantern", "Bridge", "Orchard", "Courtyard", "Tower", "Meadow",
  "Mill", "Square", "Willow", "Anchor", "Fountain", "Gate", "Terrace", "Pine",
] as const;
const SUFFIXES = ["Hotel", "House", "Suites"] as const;

const MEAL_PLANS: readonly MealPlan[] = ["room_only", "breakfast", "half_board"];
const MEAL_PLAN_NAMES: Record<MealPlan, string> = {
  room_only: "Room only",
  breakfast: "Bed and breakfast",
  half_board: "Half board",
};

export async function hasDemoHotelsNear(db: Queryable, i: { lat: number; lon: number }): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM properties
       WHERE is_demo
         AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
     ) AS near`,
    [i.lon, i.lat, NEAR_METERS],
  );
  return (rows[0] as { near: boolean }).near;
}

/**
 * Must run inside a transaction: the area's advisory lock is transaction
 * scoped, and it is what stops two concurrent first searches from both
 * creating the set. Returns the new ids, or `created: false` (and no ids)
 * when the area already had demo hotels.
 */
export async function ensureDemoHotels(
  tx: Queryable,
  i: { lat: number; lon: number; place?: string | null },
): Promise<{ created: boolean; propertyIds: string[] }> {
  if (!Number.isFinite(i.lat) || !Number.isFinite(i.lon)) throw new RangeError(`Invalid point ${i.lat}, ${i.lon}`);
  if (await hasDemoHotelsNear(tx, i)) return { created: false, propertyIds: [] };

  const key = areaKey(i.lat, i.lon);
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('demo:' || $1))`, [key]);
  // Whoever held the lock before us may just have created them.
  if (await hasDemoHotelsNear(tx, i)) return { created: false, propertyIds: [] };

  const organizationId = await ensureDemoOrganisation(tx);
  const eu = nearestEuPlace(i.lat, i.lon);
  const city = i.place?.split(",")[0]?.trim().slice(0, 100) || eu.capital;
  const { rows } = await tx.query(
    `SELECT (CURRENT_DATE - $1::int)::text AS start_date, (CURRENT_DATE + $2::int)::text AS end_date`,
    [RULE_DAYS_BEFORE, RULE_DAYS_AFTER],
  );
  const range = rows[0] as { start_date: string; end_date: string };

  const rng = seededRng(key);
  const names = hotelNames(rng, DEMO_SCENARIOS.length);
  const propertyIds: string[] = [];
  for (const [n, scenario] of DEMO_SCENARIOS.entries()) {
    const at = scatter(rng, i.lat, i.lon);
    const { propertyId } = await insertDemoProperty(tx, {
      name: names[n],
      slug: `demo-${key.replaceAll(".", "-").replaceAll(":", "_")}-${scenario}`,
      city,
      country: eu.country,
      timezone: eu.timezone,
      lat: at.lat,
      lon: at.lon,
      cancellationTier: SCENARIOS[scenario].tier,
      organizationId,
      images: pickDemoImages(rng),
    });
    await buildScenario(tx, rng, { propertyId, spec: SCENARIOS[scenario], range });
    propertyIds.push(propertyId);
  }
  return { created: true, propertyIds };
}

async function buildScenario(
  tx: Queryable,
  rng: Rng,
  i: { propertyId: string; spec: ScenarioSpec; range: { start_date: string; end_date: string } },
): Promise<void> {
  const { spec, range } = i;
  const basePrice = rng.int(70, 180);
  for (const t of spec.rooms) {
    const { roomId } = await insertDemoRoom(tx, {
      propertyId: i.propertyId,
      name: t.name,
      roomType: t.roomType,
      bedType: t.bedType,
      sizeSqm: rng.int(t.sizeSqm[0], t.sizeSqm[1]),
      maxAdults: t.maxAdults,
      maxChildren: t.maxChildren,
      baseOccupancy: t.baseOccupancy,
      totalUnits: typeof spec.units === "number" ? spec.units : rng.int(spec.units[0], spec.units[1]),
      imageUrl: pickRoomImage(rng),
    });
    if (spec.soldOut) {
      await insertAvailabilityOverride(tx, { roomId, startDate: range.start_date, endDate: range.end_date, available: 0 });
    }

    const mealPlan = rng.pick(MEAL_PLANS);
    const bar = Math.round(basePrice * t.priceFactor);
    const plans = [{ name: MEAL_PLAN_NAMES[mealPlan], bar, isRefundable: true }];
    if (spec.nonRefundable) {
      plans.push({ name: `${MEAL_PLAN_NAMES[mealPlan]}, non-refundable`, bar: nonRefundableBar(bar), isRefundable: false });
    }
    for (const plan of plans) {
      const { ratePlanId } = await insertDemoRatePlan(tx, { roomId, ...plan, minStay: spec.minStay, mealPlan });
      if (spec.closedToArrival) {
        await insertRestriction(tx, { ratePlanId, startDate: range.start_date, endDate: range.end_date, closedToArrival: true });
      }
      if (spec.weekendSurcharge !== null) {
        await insertDayOfWeekModifier(tx, { ratePlanId, days: [5, 6], amount: spec.weekendSurcharge });
      }
    }
  }
  if (spec.touristTax !== null) {
    await insertTouristTaxRule(tx, { propertyId: i.propertyId, perPersonPerNight: spec.touristTax });
  }
}

/** `count` distinct "<Adjective> <Noun> <Hotel|House|Suites>" names. */
function hotelNames(rng: Rng, count: number): string[] {
  const names = new Set<string>();
  while (names.size < count) names.add(`${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)} ${rng.pick(SUFFIXES)}`);
  return [...names];
}

/** A point within SPREAD_METERS of the given one, spread evenly over the disc. */
function scatter(rng: Rng, lat: number, lon: number): { lat: number; lon: number } {
  const angle = rng.next() * 2 * Math.PI;
  const meters = SPREAD_METERS * Math.sqrt(rng.next());
  return {
    lat: lat + (meters * Math.cos(angle)) / METERS_PER_DEGREE,
    lon: lon + (meters * Math.sin(angle)) / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180)),
  };
}

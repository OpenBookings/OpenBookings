/**
 * Row builders for generated demo hotels. Each takes any pg Client/PoolClient
 * (so tests can run them inside a rolled-back transaction) and writes the same
 * columns a host-created row would have, flagged `is_demo`.
 *
 * Money is whole euros, like the rest of the schema.
 */

import { parseBackdropManifest, type Backdrop } from "@openbookings/images";
import type { Queryable } from "@openbookings/db";
import manifest from "../../images/manifest.json";
import { DEMO_LEGAL_COMPANY_NAME, DEMO_VAT_NUMBER } from "./organisation";
import type { Rng } from "./random";

export type DemoImages = { hero: string; gallery: string[] };

export type DemoPropertyInput = {
  name: string;
  slug: string;
  city: string;
  country: string;
  timezone: string;
  lat: number;
  lon: number;
  cancellationTier: "flex" | "standard";
  /** The owning organisation; NULL leaves the property unowned. */
  organizationId: string | null;
  images: DemoImages;
};

export type DemoRoomInput = {
  propertyId: string;
  name: string;
  roomType: string;
  bedType: string;
  sizeSqm: number;
  maxAdults: number;
  maxChildren: number;
  baseOccupancy: number;
  totalUnits: number;
  imageUrl: string;
};

export type MealPlan = "room_only" | "breakfast" | "half_board";

export type DemoRatePlanInput = {
  roomId: string;
  name: string;
  /** Whole euros, tax-inclusive. */
  bar: number;
  isRefundable: boolean;
  minStay: number;
  mealPlan: MealPlan;
};

const BACKDROPS: readonly Backdrop[] = parseBackdropManifest(manifest);

/** A hero and three gallery images from the bundled backdrops, chosen with the rng. */
export function pickDemoImages(rng: Rng): DemoImages {
  if (BACKDROPS.length === 0) throw new Error("The backdrop manifest has no usable entries");
  const urls = BACKDROPS.map((b) => b.url);
  const hero = rng.pick(urls);
  // Distinct from the hero and each other while the manifest is big enough.
  const pool = urls.length >= 4 ? urls.filter((u) => u !== hero) : [...urls];
  const gallery: string[] = [];
  for (let i = 0; i < 3; i++) {
    const u = rng.pick(pool);
    gallery.push(u);
    if (urls.length >= 4) pool.splice(pool.indexOf(u), 1);
  }
  return { hero, gallery };
}

/** One image for a room, from the same backdrops. */
export function pickRoomImage(rng: Rng): string {
  if (BACKDROPS.length === 0) throw new Error("The backdrop manifest has no usable entries");
  return rng.pick(BACKDROPS).url;
}

const one = async (db: Queryable, sql: string, values: unknown[]) => (await db.query(sql, values)).rows[0] as { id: string };

export async function insertDemoProperty(db: Queryable, p: DemoPropertyInput): Promise<{ propertyId: string; slug: string }> {
  const row = await one(
    db,
    `INSERT INTO properties
       (name, slug, address_line_1, city, country, timezone, location,
        check_in_time, check_in_until, check_out_time, is_active, is_demo,
        cancellation_tier, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326),
             '15:00', '22:00', '11:00', true, true, $9::cancellation_tier, $10)
     RETURNING id`,
    [p.name, p.slug, `1 ${p.city} Street`, p.city, p.country, p.timezone, p.lon, p.lat, p.cancellationTier, p.organizationId],
  );
  // Legal details, so a demo hotel passes the readiness gate like any other.
  await db.query(
    `INSERT INTO property_content (property_id, legal_company_name, vat_number)
     VALUES ($1, $2, $3)
     ON CONFLICT (property_id) DO UPDATE
       SET legal_company_name = EXCLUDED.legal_company_name, vat_number = EXCLUDED.vat_number`,
    [row.id, DEMO_LEGAL_COMPANY_NAME, DEMO_VAT_NUMBER],
  );
  const urls = [p.images.hero, ...p.images.gallery];
  for (const [i, url] of urls.entries()) {
    await db.query(
      `INSERT INTO property_images (property_id, url, "group", sort_order, alt_text) VALUES ($1, $2, $3, $4, $5)`,
      [row.id, url, i === 0 ? "hero-image" : "gallery", i, p.name],
    );
  }
  return { propertyId: row.id, slug: p.slug };
}

export async function insertDemoRoom(db: Queryable, r: DemoRoomInput): Promise<{ roomId: string }> {
  const row = await one(
    db,
    `INSERT INTO rooms
       (property_id, name, room_type, bed_type, size_sqm, max_adults, max_children,
        base_occupancy, total_units, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
     RETURNING id`,
    [r.propertyId, r.name, r.roomType, r.bedType, r.sizeSqm, r.maxAdults, r.maxChildren, r.baseOccupancy, r.totalUnits],
  );
  await db.query(`INSERT INTO room_images (room_id, url, sort_order, alt_text) VALUES ($1, $2, 0, $3)`, [row.id, r.imageUrl, r.name]);
  return { roomId: row.id };
}

export async function insertDemoRatePlan(db: Queryable, r: DemoRatePlanInput): Promise<{ ratePlanId: string }> {
  const row = await one(
    db,
    `INSERT INTO rate_plans
       (room_id, name, bar, currency, is_refundable, min_stay, includes_breakfast, includes_dinner, is_active)
     VALUES ($1, $2, $3, 'EUR', $4, $5, $6, $7, true)
     RETURNING id`,
    [r.roomId, r.name, r.bar, r.isRefundable, r.minStay, r.mealPlan !== "room_only", r.mealPlan === "half_board"],
  );
  return { ratePlanId: row.id };
}

export async function insertRestriction(
  db: Queryable,
  r: { ratePlanId: string; startDate: string; endDate: string; closedToArrival?: boolean; minStay?: number | null; isClosed?: boolean },
): Promise<void> {
  await db.query(
    `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, closed_to_arrival, min_stay, is_closed)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [r.ratePlanId, r.startDate, r.endDate, r.closedToArrival ?? false, r.minStay ?? null, r.isClosed ?? false],
  );
}

/** Sets `available_override` on every date in [startDate, endDate] inclusive. */
export async function insertAvailabilityOverride(
  db: Queryable,
  r: { roomId: string; startDate: string; endDate: string; available: number },
): Promise<void> {
  await db.query(
    `INSERT INTO room_inventory (room_id, date, available_override)
     SELECT $1, d::date, $4 FROM generate_series($2::date, $3::date, interval '1 day') AS d
     ON CONFLICT (room_id, date) DO UPDATE SET available_override = EXCLUDED.available_override, updated_at = now()`,
    [r.roomId, r.startDate, r.endDate, r.available],
  );
}

/** A flat surcharge in euros on the given weekdays (JS `getDay`: 0 = Sunday). */
export async function insertDayOfWeekModifier(db: Queryable, r: { ratePlanId: string; days: number[]; amount: number }): Promise<void> {
  await db.query(
    `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
     VALUES ($1, 'day_of_week', $2::jsonb, 'flat', $3, true, 0)`,
    [r.ratePlanId, JSON.stringify({ days_of_week: r.days }), r.amount],
  );
}

/** One rule in force from the start: a fixed euro amount per person per night. */
export async function insertTouristTaxRule(db: Queryable, r: { propertyId: string; perPersonPerNight: number }): Promise<void> {
  const charges = [{ kind: "fixed", amount: r.perPersonPerNight, perPerson: true, perNight: true, perRoom: false }];
  await db.query(
    `INSERT INTO tourist_tax_rules (property_id, effective_from, charges, children_exempt, max_nights)
     VALUES ($1, '2000-01-01', $2::jsonb, false, NULL)`,
    [r.propertyId, JSON.stringify(charges)],
  );
}

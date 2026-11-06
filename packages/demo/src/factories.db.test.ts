import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import {
  insertAvailabilityOverride,
  insertDayOfWeekModifier,
  insertDemoProperty,
  insertDemoRatePlan,
  insertDemoRoom,
  insertRestriction,
  insertTouristTaxRule,
} from "./factories";

let db: Client;

describeWithDb("demo factories", () => {
  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  async function build() {
    const { propertyId, slug } = await insertDemoProperty(db, {
      name: "Hotel Test",
      slug: `hotel-test-${crypto.randomUUID()}`,
      city: "Amsterdam",
      country: "NL",
      timezone: "Europe/Amsterdam",
      lat: 52.3676,
      lon: 4.9041,
      cancellationTier: "flex",
      organizationId: null,
      images: {
        hero: "https://cdn.example/hero.avif",
        gallery: ["https://cdn.example/1.avif", "https://cdn.example/2.avif", "https://cdn.example/3.avif"],
      },
    });
    const { roomId } = await insertDemoRoom(db, {
      propertyId,
      name: "Double",
      roomType: "double",
      bedType: "King bed",
      sizeSqm: 24,
      maxAdults: 2,
      maxChildren: 1,
      baseOccupancy: 2,
      totalUnits: 4,
      imageUrl: "https://cdn.example/room.avif",
    });
    const { ratePlanId } = await insertDemoRatePlan(db, {
      roomId,
      name: "Flexible",
      bar: 120,
      isRefundable: true,
      minStay: 1,
      mealPlan: "breakfast",
    });
    return { propertyId, slug, roomId, ratePlanId };
  }

  test("property, room and plan land as demo rows with a real location", async () => {
    const { propertyId, roomId, ratePlanId } = await build();
    const p = (
      await db.query(
        `SELECT is_demo, is_active, stripe_account_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
         FROM properties WHERE id = $1`,
        [propertyId],
      )
    ).rows[0];
    expect(p.is_demo).toBe(true);
    expect(p.is_active).toBe(true);
    expect(p.stripe_account_id).toBeNull();
    expect(p.lat).toBeCloseTo(52.3676, 4);
    expect(p.lon).toBeCloseTo(4.9041, 4);

    const imgs = (await db.query(`SELECT "group", sort_order FROM property_images WHERE property_id = $1 ORDER BY sort_order`, [propertyId])).rows;
    expect(imgs).toHaveLength(4);
    expect(imgs[0].group).toBe("hero-image");

    expect((await db.query(`SELECT count(*)::int AS n FROM room_images WHERE room_id = $1`, [roomId])).rows[0].n).toBe(1);

    const rp = (await db.query(`SELECT bar, includes_breakfast, includes_dinner FROM rate_plans WHERE id = $1`, [ratePlanId])).rows[0];
    expect(Number(rp.bar)).toBe(120);
    expect(rp.includes_breakfast).toBe(true);
    expect(rp.includes_dinner).toBe(false);
  });

  test("restriction, availability override, modifier and tourist tax rows", async () => {
    const { propertyId, roomId, ratePlanId } = await build();
    await insertRestriction(db, { ratePlanId, startDate: "2027-01-01", endDate: "2027-01-05", closedToArrival: true, minStay: 3 });
    await insertAvailabilityOverride(db, { roomId, startDate: "2027-01-01", endDate: "2027-01-03", available: 0 });
    await insertDayOfWeekModifier(db, { ratePlanId, days: [5, 6], amount: 20 });
    await insertTouristTaxRule(db, { propertyId, perPersonPerNight: 2.5 });

    const r = (await db.query(`SELECT closed_to_arrival, min_stay, is_closed FROM rate_plan_restrictions WHERE rate_plan_id = $1`, [ratePlanId])).rows[0];
    expect(r).toEqual({ closed_to_arrival: true, min_stay: 3, is_closed: false });

    const inv = (await db.query(`SELECT date::text AS d, available_override FROM room_inventory WHERE room_id = $1 ORDER BY date`, [roomId])).rows;
    expect(inv.map((x) => x.d)).toEqual(["2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(inv.every((x) => x.available_override === 0)).toBe(true);

    const m = (await db.query(`SELECT type, adjustment_type, adjustment_value, trigger_condition FROM rate_modifiers WHERE rate_plan_id = $1`, [ratePlanId])).rows[0];
    expect(m.type).toBe("day_of_week");
    expect(m.adjustment_type).toBe("flat");
    expect(Number(m.adjustment_value)).toBe(20);
    expect(m.trigger_condition).toEqual({ days_of_week: [5, 6] });

    const t = (await db.query(`SELECT charges, children_exempt FROM tourist_tax_rules WHERE property_id = $1`, [propertyId])).rows[0];
    expect(t.charges).toEqual([{ kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false }]);
  });
});

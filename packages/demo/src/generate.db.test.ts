import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { RATES_TAX_INCLUSIVE_DOC_ID } from "@openbookings/authz/rates-doc";
import { loadSearchAvailability } from "@openbookings/db";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { ensureDemoHotels, hasDemoHotelsNear } from "./generate";
import { DEMO_ORG_ID, ensureDemoOrganisation } from "./organisation";
import { DEMO_SCENARIOS, type DemoScenario } from "./scenarios";

let db: Client;

const LISBON = { lat: 38.72, lon: -9.14, place: "Lisbon, Portugal" };

describeWithDb("demo hotels", () => {
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
    // Demo hotels someone generated on the dev database would make these
    // areas look taken (and their slugs collide). Set them aside; ROLLBACK
    // puts them back.
    await db.query(`UPDATE properties SET is_demo = false, slug = 'set-aside-' || id WHERE is_demo`);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  async function scenarioIds(propertyIds: string[]): Promise<Map<DemoScenario, string>> {
    const { rows } = await db.query<{ id: string; slug: string }>(`SELECT id, slug FROM properties WHERE id = ANY($1::uuid[])`, [
      propertyIds,
    ]);
    const byScenario = new Map<DemoScenario, string>();
    for (const s of DEMO_SCENARIOS) {
      const row = rows.find((r) => r.slug.endsWith(`-${s}`));
      if (row) byScenario.set(s, row.id);
    }
    return byScenario;
  }

  test("generates eight demo hotels once per area", async () => {
    expect(await hasDemoHotelsNear(db, LISBON)).toBe(false);

    const first = await ensureDemoHotels(db, LISBON);
    expect(first.created).toBe(true);
    expect(first.propertyIds).toHaveLength(8);

    const { rows } = await db.query(
      `SELECT is_demo, city, country, timezone, organization_id, slug, cancellation_tier::text AS tier,
              ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS meters
       FROM properties WHERE id = ANY($1::uuid[]) ORDER BY slug`,
      [first.propertyIds, LISBON.lon, LISBON.lat],
    );
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.is_demo).toBe(true);
      expect(r.city).toBe("Lisbon");
      expect(r.country).toBe("PT");
      expect(r.timezone).toBe("Europe/Lisbon");
      expect(r.organization_id).toBe(DEMO_ORG_ID);
      expect(r.slug).toMatch(/^demo-38-7_-9-1-[a-z_]+$/);
      expect(Number(r.meters)).toBeLessThan(3_100);
    }
    const tiers = Object.fromEntries(rows.map((r) => [r.slug.replace("demo-38-7_-9-1-", ""), r.tier]));
    expect(tiers).toEqual({
      normal: "flex",
      last_room: "flex",
      sold_out: "standard",
      min_stay: "standard",
      no_arrival: "standard",
      non_refundable: "standard",
      weekend_prices: "flex",
      small_rooms: "flex",
    });

    expect(await hasDemoHotelsNear(db, LISBON)).toBe(true);
    const second = await ensureDemoHotels(db, LISBON);
    expect(second).toEqual({ created: false, propertyIds: [] });
  });

  test("the same area always gets the same hotels", async () => {
    const area = { lat: 46.31, lon: 15.12, place: null };
    const read = async (ids: string[]) =>
      (
        await db.query(
          `SELECT p.name, p.slug, p.city, array_agg(rp.bar ORDER BY r.name, rp.name) AS bars
           FROM properties p JOIN rooms r ON r.property_id = p.id JOIN rate_plans rp ON rp.room_id = r.id
           WHERE p.id = ANY($1::uuid[]) GROUP BY p.id ORDER BY p.slug`,
          [ids],
        )
      ).rows;

    await db.query("SAVEPOINT fresh");
    const a = await ensureDemoHotels(db, area);
    const first = await read(a.propertyIds);
    await db.query("ROLLBACK TO SAVEPOINT fresh");

    expect(await hasDemoHotelsNear(db, area)).toBe(false);
    const b = await ensureDemoHotels(db, area);
    expect(b.created).toBe(true);
    expect(await read(b.propertyIds)).toEqual(first);
    // No place given: the nearest EU capital names the city.
    expect(first[0].city).toBe("Ljubljana");
    expect(new Set(first.map((r) => r.name)).size).toBe(8);
  });

  test("each scenario answers search the way it is meant to", async () => {
    const { propertyIds } = await ensureDemoHotels(db, LISBON);
    const ids = await scenarioIds(propertyIds);
    expect([...ids.keys()]).toEqual([...DEMO_SCENARIOS]);

    const { rows } = await db.query(`SELECT (CURRENT_DATE + 40)::text AS check_in, (CURRENT_DATE + 43)::text AS check_out`);
    const availability = await loadSearchAvailability(db, {
      propertyIds,
      checkIn: rows[0].check_in,
      checkOut: rows[0].check_out,
      adults: 2,
      children: 0,
      rooms: 1,
      now: new Date(),
    });
    const of = (s: DemoScenario) => availability.get(ids.get(s)!);

    expect(of("normal")).toMatchObject({ bookable: true, reason: null });
    expect(of("last_room")).toMatchObject({ bookable: true, reason: null });
    expect(of("sold_out")).toMatchObject({ bookable: false, reason: "sold_out" });
    expect(of("min_stay")).toMatchObject({ bookable: false, reason: "min_stay" });
    expect(of("no_arrival")).toMatchObject({ bookable: false, reason: "closed_to_arrival" });
    expect(of("non_refundable")).toMatchObject({ bookable: true, reason: null });
    expect(of("weekend_prices")).toMatchObject({ bookable: true, reason: null });
    expect(of("small_rooms")).toMatchObject({ bookable: false, reason: "too_many_guests" });
  });

  test("scenario stock, plans and prices", async () => {
    const { propertyIds } = await ensureDemoHotels(db, LISBON);
    const ids = await scenarioIds(propertyIds);
    const rooms = async (s: DemoScenario) =>
      (
        await db.query(
          `SELECT r.id, r.total_units, r.max_adults, r.max_children,
                  json_agg(json_build_object('bar', rp.bar, 'refundable', rp.is_refundable, 'minStay', rp.min_stay)
                           ORDER BY rp.is_refundable DESC) AS plans
           FROM rooms r JOIN rate_plans rp ON rp.room_id = r.id
           WHERE r.property_id = $1 GROUP BY r.id ORDER BY r.name`,
          [ids.get(s)],
        )
      ).rows as { id: string; total_units: number; max_adults: number; max_children: number; plans: { bar: number; refundable: boolean; minStay: number }[] }[];

    const normal = await rooms("normal");
    expect(normal).toHaveLength(3);
    for (const r of normal) {
      expect(r.total_units).toBeGreaterThanOrEqual(6);
      expect(r.total_units).toBeLessThanOrEqual(10);
      expect(r.plans.map((p) => p.refundable)).toEqual([true, false]);
      expect(r.plans[1].bar).toBe(Math.floor(r.plans[0].bar * 0.85));
    }

    const nr = await rooms("non_refundable");
    for (const r of nr) {
      expect(r.plans.map((p) => p.refundable)).toEqual([true, false]);
      expect(r.plans[1].bar).toBe(Math.floor(r.plans[0].bar * 0.85));
    }

    const lastRoom = await rooms("last_room");
    expect(lastRoom).toHaveLength(1);
    expect(lastRoom[0].total_units).toBe(1);

    for (const r of await rooms("small_rooms")) {
      expect(r).toMatchObject({ total_units: 4, max_adults: 1, max_children: 0 });
    }
    for (const r of await rooms("min_stay")) for (const p of r.plans) expect(p.minStay).toBe(5);

    // Sold out and closed to arrival from today through the whole search horizon.
    const soldOut = await rooms("sold_out");
    const { rows: inv } = await db.query(
      `SELECT count(*)::int AS n, bool_and(available_override = 0) AS all_zero,
              min(date) <= CURRENT_DATE AS from_today, max(date) >= CURRENT_DATE + 760 AS to_horizon
       FROM room_inventory WHERE room_id = ANY($1::uuid[])`,
      [soldOut.map((r) => r.id)],
    );
    expect(inv[0]).toMatchObject({ all_zero: true, from_today: true, to_horizon: true });

    const { rows: cta } = await db.query(
      `SELECT bool_and(rpr.closed_to_arrival AND rpr.start_date <= CURRENT_DATE AND rpr.end_date >= CURRENT_DATE + 760) AS covered,
              count(DISTINCT rpr.rate_plan_id)::int AS plans,
              (SELECT count(*)::int FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id WHERE r.property_id = $1) AS all_plans
       FROM rate_plan_restrictions rpr JOIN rate_plans rp ON rp.id = rpr.rate_plan_id JOIN rooms r ON r.id = rp.room_id
       WHERE r.property_id = $1`,
      [ids.get("no_arrival")],
    );
    expect(cta[0].covered).toBe(true);
    expect(cta[0].plans).toBe(cta[0].all_plans);

    const { rows: weekend } = await db.query(
      `SELECT
         (SELECT count(*)::int FROM rate_modifiers m JOIN rate_plans rp ON rp.id = m.rate_plan_id JOIN rooms r ON r.id = rp.room_id
          WHERE r.property_id = $1 AND m.type = 'day_of_week' AND m.trigger_condition = '{"days_of_week":[5,6]}'::jsonb
            AND m.adjustment_value = 40) AS modifiers,
         (SELECT count(*)::int FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id WHERE r.property_id = $1) AS plans,
         (SELECT charges FROM tourist_tax_rules WHERE property_id = $1) AS charges`,
      [ids.get("weekend_prices")],
    );
    expect(weekend[0].modifiers).toBe(weekend[0].plans);
    expect(weekend[0].charges).toEqual([{ kind: "fixed", amount: 3.5, perPerson: true, perNight: true, perRoom: false }]);

    // bar is bigint, so whole euros by type; none may be free.
    const { rows: bars } = await db.query(
      `SELECT bool_and(rp.bar > 0) AS positive FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id WHERE r.property_id = ANY($1::uuid[])`,
      [propertyIds],
    );
    expect(bars[0].positive).toBe(true);
  });

  test("the demo organisation is created once and has confirmed tax-inclusive rates", async () => {
    expect(await ensureDemoOrganisation(db)).toBe(DEMO_ORG_ID);
    expect(await ensureDemoOrganisation(db)).toBe(DEMO_ORG_ID);

    const { rows } = await db.query(
      `SELECT
         (SELECT count(*)::int FROM "organization" WHERE id = $1) AS orgs,
         (SELECT count(*)::int FROM org_profile WHERE organization_id = $1) AS profiles,
         (SELECT count(*)::int FROM org_consent WHERE organization_id = $1 AND doc_id = $2) AS consents`,
      [DEMO_ORG_ID, RATES_TAX_INCLUSIVE_DOC_ID],
    );
    expect(rows[0]).toEqual({ orgs: 1, profiles: 1, consents: 1 });
  });
});

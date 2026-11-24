/**
 * Guest search's rows against Postgres: an unmanaged plan is priced from our
 * own numbers as before; a plan a connected app manages from the app's prices
 * and fees, with no discount rule, and not at all when the app left a night
 * unpriced. Every test runs in a transaction that is rolled back; fixtures sit
 * in 2031+ and are picked out of the results by id, since dev data is near.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyAriBatch, connectApp } from "@openbookings/db/apps";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { resolveRoom } from "@openbookings/pricing";
import { loadSearchRows } from "./search-query";

type AriBatch = Parameters<typeof applyAriBatch>[2];

const CHECK_IN = "2031-11-10";
const LAST_NIGHT = "2031-11-11";
const CHECK_OUT = "2031-11-12";
const NOW = new Date("2031-10-01T10:00:00Z");
// seedProperty puts every test property here.
const AMSTERDAM = { lat: 52.3676, lon: 4.9041 };

describeWithDb("search rows", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };

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
    ids = await seedProperty(db);
    await db.query(`UPDATE rooms SET max_adults = 3, extra_adult_fee_cents = 2000 WHERE id = $1`, [ids.roomId]);
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night_cents) VALUES ($1, $2, $2, 14000)`,
      [ids.ratePlanId, CHECK_IN],
    );
    await db.query(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
       VALUES ($1, 'length_of_stay', '{"min_nights": 2}'::jsonb, 'percent', -10, true, 0)`,
      [ids.ratePlanId],
    );
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const row = async () =>
    (await loadSearchRows(db, { ...AMSTERDAM, checkIn: CHECK_IN, checkOut: CHECK_OUT, testing: false })).find(
      (r) => r.hotel_id === ids.propertyId,
    );
  const price = async (adults: number) =>
    resolveRoom((await row())!, { adults, children: 0, arrivalDate: CHECK_IN }, "2031-10-01").room_price_cents;

  async function manage(nights: string[]) {
    const { installation } = await connectApp(db, {
      propertyId: ids.propertyId,
      appKey: "siteminder",
      userId: "test-host-user",
      sendUpcoming: true,
      now: NOW,
    });
    const { plan } = (
      await db.query(`SELECT p.channel_code AS plan FROM rate_plans p WHERE p.id = $1`, [ids.ratePlanId])
    ).rows[0] as { plan: string };
    const rate = (date: string, priceCents: number, extraAdultCents: number) => ({
      ratePlanCode: plan,
      from: date,
      to: date,
      priceCents,
      extraAdultCents,
      extraChildCents: null,
    });
    const batch: AriBatch = {
      inventory: [],
      rates: [rate(CHECK_IN, 18650, 2500), rate(LAST_NIGHT, 20000, 3000)].filter((r) => nights.includes(r.from)),
      restrictions: [],
    };
    expect((await applyAriBatch(db, installation, batch, NOW)).ok).toBe(true);
  }

  test("an unmanaged plan: override then BAR, the discount, the room's extra fee", async () => {
    const r = (await row())!;
    expect(r.managed).toBe(false);
    expect(r.nights).toEqual([
      { date: CHECK_IN, base_price_cents: 14000, has_override: true },
      { date: LAST_NIGHT, base_price_cents: 10000, has_override: false },
    ]);
    expect(r.modifiers).toHaveLength(1);
    expect(await price(2)).toBe(21600);
    expect(await price(3)).toBe(21600 + 2 * 2000);
  });

  test("a managed plan: the app's prices and fees, no discount rule", async () => {
    await manage([CHECK_IN, LAST_NIGHT]);
    const r = (await row())!;
    expect(r.managed).toBe(true);
    expect(r.nights).toEqual([
      { date: CHECK_IN, base_price_cents: 18650, has_override: false, extra_adult_fee_cents: 2500 },
      { date: LAST_NIGHT, base_price_cents: 20000, has_override: false, extra_adult_fee_cents: 3000 },
    ]);
    expect(r.modifiers).toEqual([]);
    expect(await price(2)).toBe(38650);
    expect(await price(3)).toBe(44150);
  });

  test("a managed plan with a night the app left unpriced is not offered", async () => {
    await manage([CHECK_IN]);
    expect(await row()).toBeUndefined();
  });
});

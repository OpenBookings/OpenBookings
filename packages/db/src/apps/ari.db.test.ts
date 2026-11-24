/** Writing app-sent ARI (0060). Fixtures sit in 2031+ so dev data cannot interfere. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { AriBatch } from "@openbookings/apps-contract";
import { applyAriBatch } from "./ari";
import { connectApp, type Installation } from "./installations";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "../testing/db-harness";

const empty: AriBatch = { inventory: [], rates: [], restrictions: [] };

describeWithDb("applyAriBatch", () => {
  let db: Client;

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

  const now = new Date("2031-03-01T12:00:00Z");

  async function setup() {
    const ids = await seedProperty(db);
    const { installation } = await connectApp(db, {
      propertyId: ids.propertyId,
      appKey: "siteminder",
      userId: "test-host-user",
      sendUpcoming: true,
      now,
    });
    const codes = (
      await db.query(
        `SELECT r.channel_code AS room, p.channel_code AS plan
           FROM rooms r JOIN rate_plans p ON p.room_id = r.id WHERE r.id = $1`,
        [ids.roomId],
      )
    ).rows[0] as { room: string; plan: string };
    return { ...ids, installation: installation as Installation, roomCode: codes.room, planCode: codes.plan };
  }

  const restrictionRow = async (ratePlanId: string, date: string) =>
    (
      await db.query(
        `SELECT is_closed, closed_to_arrival, closed_to_departure, min_stay_arrival, max_stay_arrival,
                min_stay_through, max_stay_through, received_at
           FROM app_restrictions WHERE rate_plan_id = $1 AND date = $2::date`,
        [ratePlanId, date],
      )
    ).rows[0];

  test("a 750-night inventory change writes 750 rows quickly", async () => {
    const s = await setup();
    const batch: AriBatch = {
      ...empty,
      inventory: [{ roomCode: s.roomCode, from: "2031-01-01", to: "2033-01-19", unitsLeft: 4 }],
    };
    const started = performance.now();
    const result = await applyAriBatch(db, s.installation, batch, now);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(result).toEqual({ ok: true, nights: 750 });
    const count = (await db.query(`SELECT count(*)::int AS n FROM app_inventory WHERE room_id = $1`, [s.roomId])).rows[0];
    expect(count.n).toBe(750);
  });

  test("the same batch twice gives the same rows", async () => {
    const s = await setup();
    const batch: AriBatch = {
      inventory: [{ roomCode: s.roomCode, from: "2031-05-01", to: "2031-05-10", unitsLeft: 2 }],
      rates: [{ ratePlanCode: s.planCode, from: "2031-05-01", to: "2031-05-10", priceCents: 12000, extraAdultCents: null, extraChildCents: null }],
      restrictions: [{ ratePlanCode: s.planCode, from: "2031-05-01", to: "2031-05-10", closed: true, minStayArrival: 2 }],
    };
    const dump = async () =>
      JSON.stringify([
        (await db.query(`SELECT date::text, units_left FROM app_inventory WHERE room_id = $1 ORDER BY date`, [s.roomId])).rows,
        (await db.query(`SELECT date::text, price_cents FROM app_rates WHERE rate_plan_id = $1 ORDER BY date`, [s.ratePlanId])).rows,
        (await db.query(`SELECT date::text, is_closed, min_stay_arrival FROM app_restrictions WHERE rate_plan_id = $1 ORDER BY date`, [s.ratePlanId])).rows,
      ]);
    await applyAriBatch(db, s.installation, batch, now);
    const first = await dump();
    expect(await applyAriBatch(db, s.installation, batch, now)).toEqual({ ok: true, nights: 30 });
    expect(await dump()).toBe(first);
    expect(JSON.parse(first).map((rows: unknown[]) => rows.length)).toEqual([10, 10, 10]);
  });

  test("a code of another property is unknown and nothing is written", async () => {
    const s = await setup();
    const other = await seedProperty(db);
    const otherCodes = (
      await db.query(`SELECT channel_code FROM rooms WHERE id = $1 UNION ALL SELECT channel_code FROM rate_plans WHERE id = $2`, [other.roomId, other.ratePlanId])
    ).rows.map((r) => r.channel_code as string);
    const result = await applyAriBatch(
      db,
      s.installation,
      {
        inventory: [
          { roomCode: s.roomCode, from: "2031-06-01", to: "2031-06-03", unitsLeft: 1 },
          { roomCode: otherCodes[0]!, from: "2031-06-01", to: "2031-06-03", unitsLeft: 1 },
        ],
        rates: [],
        restrictions: [{ ratePlanCode: "PNOSUCHCODE1", from: "2031-06-01", to: "2031-06-03", closed: true }],
      },
      now,
    );
    expect(result).toEqual({ ok: false, error: "unknown codes", unknownCodes: [otherCodes[0]!, "PNOSUCHCODE1"] });
    for (const t of ["app_inventory", "app_rates", "app_restrictions"]) {
      expect((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
    }
  });

  test("archived rooms and rate plans count as unknown", async () => {
    const s = await setup();
    await db.query(`UPDATE rate_plans SET is_active = false, archived_at = now() WHERE id = $1`, [s.ratePlanId]);
    const result = await applyAriBatch(
      db,
      s.installation,
      { ...empty, rates: [{ ratePlanCode: s.planCode, from: "2031-06-01", to: "2031-06-01", priceCents: 100, extraAdultCents: null, extraChildCents: null }] },
      now,
    );
    expect(result).toEqual({ ok: false, error: "unknown codes", unknownCodes: [s.planCode] });
  });

  test("a restriction with only closedToArrival keeps the stored min stay", async () => {
    const s = await setup();
    const day = "2031-07-04";
    await applyAriBatch(
      db,
      s.installation,
      { ...empty, restrictions: [{ ratePlanCode: s.planCode, from: day, to: day, minStayArrival: 3, closed: true }] },
      now,
    );
    const later = new Date("2031-03-02T08:00:00Z");
    await applyAriBatch(
      db,
      s.installation,
      { ...empty, restrictions: [{ ratePlanCode: s.planCode, from: day, to: day, closedToArrival: true }] },
      later,
    );
    const row = await restrictionRow(s.ratePlanId, day);
    expect(row).toMatchObject({ min_stay_arrival: 3, is_closed: true, closed_to_arrival: true, closed_to_departure: false });
    expect(row.received_at).toEqual(later);
  });

  test("a present null clears a stay limit, an absent one keeps it", async () => {
    const s = await setup();
    const day = "2031-07-05";
    await applyAriBatch(
      db,
      s.installation,
      { ...empty, restrictions: [{ ratePlanCode: s.planCode, from: day, to: day, minStayArrival: 3, maxStayThrough: 9 }] },
      now,
    );
    await applyAriBatch(
      db,
      s.installation,
      { ...empty, restrictions: [{ ratePlanCode: s.planCode, from: day, to: day, minStayArrival: null }] },
      now,
    );
    expect(await restrictionRow(s.ratePlanId, day)).toMatchObject({ min_stay_arrival: null, max_stay_through: 9 });
  });

  test("new restriction rows default to open and unlimited", async () => {
    const s = await setup();
    await applyAriBatch(
      db,
      s.installation,
      { ...empty, restrictions: [{ ratePlanCode: s.planCode, from: "2031-07-06", to: "2031-07-06", closedToDeparture: true }] },
      now,
    );
    expect(await restrictionRow(s.ratePlanId, "2031-07-06")).toMatchObject({
      is_closed: false,
      closed_to_arrival: false,
      closed_to_departure: true,
      min_stay_arrival: null,
      min_stay_through: null,
    });
  });

  test("changes within one batch apply in order: later wins per field, patches merge", async () => {
    const s = await setup();
    const day = "2031-08-01";
    await applyAriBatch(
      db,
      s.installation,
      {
        inventory: [
          { roomCode: s.roomCode, from: day, to: "2031-08-02", unitsLeft: 5 },
          { roomCode: s.roomCode, from: day, to: day, unitsLeft: 1 },
        ],
        rates: [],
        restrictions: [
          { ratePlanCode: s.planCode, from: day, to: day, minStayArrival: 4, closed: true },
          { ratePlanCode: s.planCode, from: day, to: day, closed: false, maxStayArrival: 7 },
        ],
      },
      now,
    );
    const inv = (await db.query(`SELECT date::text AS d, units_left FROM app_inventory WHERE room_id = $1 ORDER BY date`, [s.roomId])).rows;
    expect(inv).toEqual([
      { d: day, units_left: 1 },
      { d: "2031-08-02", units_left: 5 },
    ]);
    expect(await restrictionRow(s.ratePlanId, day)).toMatchObject({ is_closed: false, min_stay_arrival: 4, max_stay_arrival: 7 });
  });

  test("a rate of 18650 cents is stored as 18650, with extras, and overwritten by the next write", async () => {
    const s = await setup();
    const rate = { ratePlanCode: s.planCode, from: "2031-09-01", to: "2031-09-02", priceCents: 18650, extraAdultCents: 2500, extraChildCents: null };
    await applyAriBatch(db, s.installation, { ...empty, rates: [rate] }, now);
    const read = async () =>
      (await db.query(`SELECT date::text AS d, price_cents::int AS p, extra_adult_cents::int AS a, extra_child_cents::int AS c FROM app_rates WHERE rate_plan_id = $1 ORDER BY date`, [s.ratePlanId])).rows;
    expect(await read()).toEqual([
      { d: "2031-09-01", p: 18650, a: 2500, c: null },
      { d: "2031-09-02", p: 18650, a: 2500, c: null },
    ]);
    await applyAriBatch(db, s.installation, { ...empty, rates: [{ ...rate, priceCents: 9900, extraAdultCents: null, extraChildCents: 1000 }] }, now);
    expect((await read())[0]).toEqual({ d: "2031-09-01", p: 9900, a: null, c: 1000 });
  });

  test("received_at equals the passed now on every table", async () => {
    const s = await setup();
    await applyAriBatch(
      db,
      s.installation,
      {
        inventory: [{ roomCode: s.roomCode, from: "2031-10-01", to: "2031-10-01", unitsLeft: 0 }],
        rates: [{ ratePlanCode: s.planCode, from: "2031-10-01", to: "2031-10-01", priceCents: 1, extraAdultCents: null, extraChildCents: null }],
        restrictions: [{ ratePlanCode: s.planCode, from: "2031-10-01", to: "2031-10-01", closed: true }],
      },
      now,
    );
    for (const t of ["app_inventory", "app_rates", "app_restrictions"]) {
      const rows = (await db.query(`SELECT received_at FROM ${t}`)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].received_at).toEqual(now);
    }
  });

  test("an empty batch writes nothing and reports 0 nights", async () => {
    const s = await setup();
    expect(await applyAriBatch(db, s.installation, empty, now)).toEqual({ ok: true, nights: 0 });
  });
});

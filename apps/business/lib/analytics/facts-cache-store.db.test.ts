/**
 * The live facts loader against a real Postgres: only this hotel, the window
 * rule, clipped nights, succeeded refunds only. query/queryOne are pointed at
 * the test's transaction; each test is rolled back.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { Client } from "pg";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedGuest,
  seedProperty,
} from "@openbookings/db/testing";
import { mockModules } from "@/lib/mock-modules";

let db: Client;

const realDb = await import("@openbookings/db");
await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({
    ...realDb,
    query: async (text: string, values: unknown[] = []) =>
      (await run(text, values)).rows,
    queryOne: async (text: string, values: unknown[] = []) =>
      (await run(text, values)).rows[0] ?? null,
  }),
});

let queue: Promise<unknown> = Promise.resolve();
function run(text: string, values: unknown[]) {
  const result = queue.then(() => db.query(text, values));
  queue = result.catch(() => undefined);
  return result;
}

const { loadWindowFacts, loadNames } = await import("./facts-query");
const { createMonthStore } = await import("./facts-cache-store");
const { assembleFacts } = await import("./facts-cache");

describeWithDb("analytics month cache store", () => {
  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
  });

  async function seed() {
    const hotel = await seedProperty(db);
    const guest = await seedGuest(db);
    const made = await seedBooking(db, hotel, { checkIn: "2031-03-10", nights: 2, userId: guest });
    await db.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = '2031-03-01T12:00:00+01:00' WHERE id = $1`,
      [made.bookingId],
    );
    return hotel;
  }

  const MARCH = { from: "2031-03-01", to: "2031-03-31" };

  test("round trip equals live load for a finished month", async () => {
    const hotel = await seed();
    const deps = { store: createMonthStore(), loadLive: loadWindowFacts, loadNames };
    const first = await assembleFacts(hotel.propertyId, MARCH, "2031-06-15", deps);
    const stored = await db.query(`SELECT count(*)::int AS n FROM analytics_month_cache WHERE hotel_id = $1`, [hotel.propertyId]);
    expect(stored.rows[0].n).toBe(1);
    const second = await assembleFacts(hotel.propertyId, MARCH, "2031-06-15", {
      store: deps.store,
      loadNames,
      loadLive: async () => {
        throw new Error("must be served from the cache");
      },
    });
    expect(second).toEqual(first);
    const live = await loadWindowFacts(hotel.propertyId, MARCH);
    expect(second.nights).toEqual(live.nights);
    expect(second.inventory).toEqual(live.inventory);
    expect(second.bookings.map((b) => b.id)).toEqual(live.bookings.map((b) => b.id));
  });

  test("write after a trigger bump is ignored", async () => {
    const hotel = await seed();
    const store = createMonthStore();
    const gen = await store.generations(hotel.propertyId, ["2031-03-01"]);
    const facts = await loadWindowFacts(hotel.propertyId, MARCH);
    await db.query(`SELECT app.analytics_touch($1, '2031-03-05', '2031-03-05')`, [hotel.propertyId]);
    await store.write(hotel.propertyId, "2031-03-01", { month: gen.months.get("2031-03-01")!, hotel: gen.hotel }, facts);
    expect((await store.read(hotel.propertyId, ["2031-03-01"])).size).toBe(0);
    const rows = await db.query(`SELECT 1 FROM analytics_month_cache WHERE hotel_id = $1`, [hotel.propertyId]);
    expect(rows.rowCount).toBe(0);
  });

  test("a hotel-wide bump after the build invalidates a stored month and blocks a stale write", async () => {
    const hotel = await seed();
    const store = createMonthStore();
    const gen = await store.generations(hotel.propertyId, ["2031-03-01"]);
    const facts = await loadWindowFacts(hotel.propertyId, MARCH);
    await store.write(hotel.propertyId, "2031-03-01", { month: gen.months.get("2031-03-01")!, hotel: gen.hotel }, facts);
    expect((await store.read(hotel.propertyId, ["2031-03-01"])).size).toBe(1);
    await db.query(`SELECT app.analytics_touch_hotel($1)`, [hotel.propertyId]);
    expect((await store.read(hotel.propertyId, ["2031-03-01"])).size).toBe(0);
    await store.write(hotel.propertyId, "2031-03-01", { month: gen.months.get("2031-03-01")!, hotel: gen.hotel }, facts);
    expect((await store.read(hotel.propertyId, ["2031-03-01"])).size).toBe(0);
  });
});

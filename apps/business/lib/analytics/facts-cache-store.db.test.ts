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
const { bookingsCreatedIn } = await import("./metrics");

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

  test("a booking made at 00:30 Amsterdam on the 1st lands in that month, cached and live alike", async () => {
    const hotel = await seed();
    const guest = await seedGuest(db);
    const made = await seedBooking(db, hotel, { checkIn: "2031-09-10", nights: 2, userId: guest });
    await db.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = '2031-01-31T23:30:00Z' WHERE id = $1`, [made.bookingId]);
    const deps = { store: createMonthStore(), loadLive: loadWindowFacts, loadNames };
    const FEB = { from: "2031-02-01", to: "2031-02-28" };
    for (const pass of ["cold", "warm"]) {
      const feb = await assembleFacts(hotel.propertyId, FEB, "2031-06-15", deps);
      expect({ pass, ids: bookingsCreatedIn(feb.bookings, FEB).map((b) => b.id) }).toEqual({ pass, ids: made.reservationIds });
      const jan = await assembleFacts(hotel.propertyId, { from: "2031-01-01", to: "2031-01-31" }, "2031-06-15", deps);
      expect({ pass, ids: jan.bookings.map((b) => b.id) }).toEqual({ pass, ids: [] });
    }
  });

  test("a multi-month window, cold and then warm, equals one live load of the same window", async () => {
    const hotel = await seed(); // booked 1 Mar, staying 10–12 Mar
    const book = async (checkIn: string, nights: number, confirmedAt: string, rooms = 1) => {
      const made = await seedBooking(db, hotel, { checkIn, nights, rooms, userId: await seedGuest(db) });
      await db.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = $2::timestamptz WHERE id = $1`, [
        made.bookingId,
        confirmedAt,
      ]);
      return made;
    };
    await book("2031-01-30", 4, "2030-12-20T10:00:00Z"); // made before the window, stays across Jan/Feb
    await book("2031-05-02", 2, "2031-01-31T23:30:00Z"); // made 00:30 on 1 Feb Amsterdam, stays after the window
    const pair = await book("2031-02-27", 3, "2031-02-10T09:00:00Z", 2); // two rooms, across Feb/Mar
    await db.query(
      `INSERT INTO refunds (booking_id, reservation_id, reason, accommodation_cents, tourist_tax_cents, amount_cents, status, idempotency_key)
       VALUES ($1, NULL, 'goodwill', 7550, 0, 7550, 'succeeded', $2)`,
      [pair.bookingId, `t-${crypto.randomUUID()}`],
    );
    await db.query(`UPDATE reservations SET cancelled_at = '2031-02-20T10:00:00Z' WHERE id = $1`, [pair.reservationIds[1]]);
    const noShow = await book("2031-03-20", 2, "2031-03-01T10:00:00Z");
    await db.query(`UPDATE bookings SET status = 'no_show' WHERE id = $1`, [noShow.bookingId]);
    const early = await book("2031-04-10", 4, "2031-03-15T10:00:00Z"); // runs into the live month
    await db.query(`UPDATE bookings SET departed_early_on = '2031-04-11' WHERE id = $1`, [early.bookingId]);
    await db.query(`INSERT INTO room_inventory (room_id, date, total_rooms, blocked_rooms) VALUES ($1, '2031-03-15', 7, 2)`, [
      hotel.roomId,
    ]);

    const WINDOW = { from: "2031-01-01", to: "2031-04-30" };
    const TODAY = "2031-04-15";
    const sorted = (f: Awaited<ReturnType<typeof loadWindowFacts>>) => ({
      ...f,
      bookings: [...f.bookings].sort((a, b) => a.id.localeCompare(b.id)),
      nights: [...f.nights].sort((a, b) => `${a.bookingId}${a.date}`.localeCompare(`${b.bookingId}${b.date}`)),
      inventory: [...f.inventory].sort((a, b) => `${a.roomId}${a.date}`.localeCompare(`${b.roomId}${b.date}`)),
    });
    const live = sorted(await loadWindowFacts(hotel.propertyId, WINDOW));
    expect(live.bookings.length).toBe(7);

    const deps = { store: createMonthStore(), loadLive: loadWindowFacts, loadNames };
    const cold = await assembleFacts(hotel.propertyId, WINDOW, TODAY, deps);
    const stored = await db.query(`SELECT to_char(month, 'YYYY-MM') AS m FROM analytics_month_cache WHERE hotel_id = $1 ORDER BY month`, [
      hotel.propertyId,
    ]);
    expect(stored.rows.map((r) => r.m)).toEqual(["2031-01", "2031-02", "2031-03"]);
    expect(sorted(cold)).toEqual(live);

    const warm = await assembleFacts(hotel.propertyId, WINDOW, TODAY, {
      ...deps,
      loadLive: async (p, w) => {
        if (w.from < "2031-04-01") throw new Error("finished months must come from the cache");
        return loadWindowFacts(p, w);
      },
    });
    expect(sorted(warm)).toEqual(live);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "./testing/db-harness";

describeWithDb("analytics month cache invalidation", () => {
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

  /** A cache row stamped with the month's current generation (0 when it has never been touched). */
  async function cacheRow(hotel: string, month: string, generation?: number) {
    const current =
      generation ??
      Number(
        (
          await db.query(`SELECT generation FROM analytics_month_generation WHERE hotel_id = $1 AND month = $2`, [
            hotel,
            month,
          ])
        ).rows[0]?.generation ?? 0,
      );
    await db.query(
      `INSERT INTO analytics_month_cache (hotel_id, month, version, generation, facts) VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
      [hotel, month, current],
    );
  }
  const cachedMonths = async (hotel: string) =>
    (
      await db.query(`SELECT to_char(month, 'YYYY-MM') AS m FROM analytics_month_cache WHERE hotel_id = $1 ORDER BY month`, [
        hotel,
      ])
    ).rows.map((r) => r.m as string);
  const generations = async (hotel: string) =>
    Object.fromEntries(
      (
        await db.query(
          `SELECT to_char(month, 'YYYY-MM') AS m, generation::int AS g FROM analytics_month_generation WHERE hotel_id = $1 ORDER BY month`,
          [hotel],
        )
      ).rows.map((r) => [r.m as string, r.g as number]),
    );

  async function bookedHotel(checkIn = "2031-02-27", nights = 3) {
    const ids = await seedProperty(db);
    const { bookingId } = await seedBooking(db, ids, { checkIn, nights });
    await db.query(`UPDATE bookings SET confirmed_at = '2031-01-15T12:00:00Z', status = 'confirmed' WHERE id = $1`, [bookingId]);
    return { ...ids, bookingId };
  }
  /** Seeding touches months too; start each test from generation 0 so the asserted counts are the test's own. */
  const fillCache = async (hotel: string, months: string[]) => {
    await db.query(`UPDATE analytics_month_generation SET generation = 0 WHERE hotel_id = $1`, [hotel]);
    for (const m of months) await cacheRow(hotel, `${m}-01`);
  };

  test("booking update clears its booked month and stay months", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);

    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
    const g = await generations(propertyId);
    expect(g["2031-01"]).toBe(1);
    expect(g["2031-02"]).toBe(1);
    expect(g["2031-03"]).toBe(1);
    expect(g["2031-04"]).toBeUndefined();
  });

  test("succeeded refund insert clears the booking months", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);

    await db.query(
      `INSERT INTO refunds (booking_id, reason, source, accommodation_amount, tourist_tax_amount, amount, status, idempotency_key)
       VALUES ($1, 'goodwill', 'openbookings', 50, 0, 50, 'succeeded', $2)`,
      [bookingId, `k-${crypto.randomUUID()}`],
    );

    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
  });

  test("room_inventory change clears only that month", async () => {
    const { propertyId, roomId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03"]);

    await db.query(`INSERT INTO room_inventory (room_id, date, blocked_rooms) VALUES ($1, '2031-02-10', 1)`, [roomId]);

    expect(await cachedMonths(propertyId)).toEqual(["2031-01", "2031-03"]);
    expect((await generations(propertyId))["2031-02"]).toBe(1);
  });

  test("rooms total_units change clears every month of that hotel and none of another hotel", async () => {
    const a = await bookedHotel();
    const b = await bookedHotel();
    await fillCache(a.propertyId, ["2031-01", "2031-02", "2031-03"]);
    await fillCache(b.propertyId, ["2031-01", "2031-02"]);

    await db.query(`UPDATE rooms SET total_units = 9 WHERE id = $1`, [a.roomId]);

    expect(await cachedMonths(a.propertyId)).toEqual([]);
    expect(await cachedMonths(b.propertyId)).toEqual(["2031-01", "2031-02"]);
    expect((await generations(a.propertyId))["2031-03"]).toBe(1);
  });

  test("another hotel's cache is untouched by a booking change", async () => {
    const a = await bookedHotel();
    const b = await bookedHotel();
    await fillCache(a.propertyId, ["2031-01", "2031-02"]);
    await fillCache(b.propertyId, ["2031-01", "2031-02", "2031-03"]);
    const before = await generations(b.propertyId);

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [a.bookingId]);

    expect(await cachedMonths(a.propertyId)).toEqual([]);
    expect(await cachedMonths(b.propertyId)).toEqual(["2031-01", "2031-02", "2031-03"]);
    expect(await generations(b.propertyId)).toEqual(before);
  });
});

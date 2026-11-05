import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { searchBookings } from "./search";

describeWithDb("booking search against Postgres", () => {
  let db: Client;
  let a: { bookingId: string; reservationIds: string[] };
  let b: { bookingId: string; reservationIds: string[] };

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
    const ids = await seedProperty(db, { tier: "flex" });
    a = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 3, rooms: 1 });
    b = await seedBooking(db, ids, { checkIn: "2031-12-10", nights: 2, rooms: 2 });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("finds by booking id", async () => {
    const rows = await searchBookings(db, { q: a.bookingId });
    expect(rows.map((r) => r.id)).toEqual([a.bookingId]);
    expect(rows[0].rooms).toBe(1);
    expect(rows[0].guestName).toBe("Test Guest");
    expect(typeof rows[0].totalAmount).toBe("number");
    expect(rows[0].checkIn).toBe("2031-11-10");
  });

  test("finds by reservation id", async () => {
    const rows = await searchBookings(db, { q: b.reservationIds[1] });
    expect(rows.map((r) => r.id)).toEqual([b.bookingId]);
    expect(rows[0].rooms).toBe(2);
  });

  test("finds by payment intent", async () => {
    const ids = (await searchBookings(db, { q: "pi_test" })).map((r) => r.id);
    expect(ids).toContain(a.bookingId);
    expect(ids).toContain(b.bookingId);
  });

  test("finds by email prefix", async () => {
    // The query needs an "@" to classify as an email, so the prefix stops after the domain start.
    const email = (await searchBookings(db, { q: a.bookingId }))[0].guestEmail as string;
    const ids = (await searchBookings(db, { q: email.slice(0, -5) })).map((r) => r.id);
    expect(ids).toContain(a.bookingId);
  });

  test("finds by email prefix without an @", async () => {
    const email = (await searchBookings(db, { q: a.bookingId }))[0].guestEmail as string;
    const ids = (await searchBookings(db, { q: email.slice(0, 12) })).map((r) => r.id);
    expect(ids).toContain(a.bookingId);
  });

  test("finds by the 8-character id prefix shown in the table", async () => {
    const ids = (await searchBookings(db, { q: a.bookingId.slice(0, 8) })).map((r) => r.id);
    expect(ids).toContain(a.bookingId);
  });

  test("filters by property", async () => {
    const other = await seedProperty(db, { tier: "flex" });
    const c = await seedBooking(db, other, { checkIn: "2031-10-10", nights: 1, rooms: 1 });
    const pid = (await db.query("SELECT hotel_id FROM bookings WHERE id = $1", [c.bookingId])).rows[0].hotel_id;
    const rows = await searchBookings(db, { q: "pi_test", property: pid });
    expect(rows.map((r) => r.id)).toEqual([c.bookingId]);
  });

  test("ignores malformed filters", async () => {
    const base = (await searchBookings(db, { q: a.bookingId })).map((r) => r.id);
    for (const f of [{ status: "foo" }, { property: "x" }, { from: "garbage" }, { from: "2031-02-31" }]) {
      expect((await searchBookings(db, { q: a.bookingId, ...f })).map((r) => r.id)).toEqual(base);
    }
  });

  test("filters by status", async () => {
    await db.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [a.bookingId]);
    const rows = await searchBookings(db, { q: "pi_test", status: "cancelled" });
    expect(rows.map((r) => r.id)).toEqual([a.bookingId]);
  });

  test("filters by check-in range", async () => {
    const rows = await searchBookings(db, { q: "pi_test", from: "2031-12-01", to: "2031-12-31" });
    expect(rows.map((r) => r.id)).toEqual([b.bookingId]);
  });

  test("treats wildcards literally", async () => {
    for (const q of ["%", "_", "'", "\\"]) {
      expect(await searchBookings(db, { q })).toEqual([]);
    }
  });
});

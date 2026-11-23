import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { bookingReference, bookingReferenceMatchSql, parseBookingReference } from "./booking-reference";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedGuest, seedProperty } from "./testing/db-harness";

describeWithDb("booking reference uniqueness (0056)", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let bookingId: string;

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
    ids = await seedProperty(db, { tier: "flex" });
    ({ bookingId } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2 }));
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const insertWithId = async (id: string) =>
    db.query(
      `INSERT INTO bookings (id, hotel_id, user_id, check_in_date, check_out_date, status, total_amount)
       VALUES ($1, $2, $3, '2031-12-01', '2031-12-02', 'pending', 100)`,
      [id, ids.propertyId, await seedGuest(db)],
    );

  test("refuses a second booking whose id starts with the same 8 characters", async () => {
    const clash = `${bookingId.slice(0, 8)}-0000-4000-8000-000000000000`;
    await expect(insertWithId(clash)).rejects.toThrow(/bookings_reference_key/);
  });

  test("new booking ids come from app.new_booking_id()", async () => {
    const { rows } = await db.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'id'`,
    );
    expect(rows[0].column_default).toContain("new_booking_id");
  });

  test("app.new_booking_id() never hands out a prefix that is taken", async () => {
    const { rows } = await db.query(
      `SELECT count(*)::int AS clashes FROM generate_series(1, 200) g
       CROSS JOIN LATERAL (SELECT app.new_booking_id() AS id) n
       WHERE EXISTS (SELECT 1 FROM bookings b WHERE left(b.id::text, 8) = left(n.id::text, 8))`,
    );
    expect(rows[0].clashes).toBe(0);
  });

  test("the reference finds exactly that booking, in any typed form", async () => {
    for (const typed of [bookingReference(bookingId), bookingId.slice(0, 8).toUpperCase(), bookingId]) {
      const { rows } = await db.query(`SELECT id FROM bookings b WHERE ${bookingReferenceMatchSql("b.id", "$1")}`, [
        parseBookingReference(typed),
      ]);
      expect(rows.map((r) => r.id)).toEqual([bookingId]);
    }
  });

  test("a full UUID that only shares the prefix finds nothing", async () => {
    const other = `${bookingId.slice(0, 8)}-0000-4000-8000-000000000000`;
    const { rows } = await db.query(`SELECT id FROM bookings b WHERE ${bookingReferenceMatchSql("b.id", "$1")}`, [other]);
    expect(rows).toEqual([]);
  });
});

/**
 * The guest's bookings list reads what was paid in cents. Every test runs in a
 * transaction that is rolled back; skipped without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { confirmBookingPolicy } from "@openbookings/db";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedGuest, seedProperty } from "@openbookings/db/testing";
import { EXPORT_QUERIES } from "@/lib/account/export";
import { GUEST_BOOKINGS_SQL, type GuestBookingListRow } from "./list";

describeWithDb("GUEST_BOOKINGS_SQL and the data export against Postgres", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let guest: string;

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
    guest = await seedGuest(db);
    // €1.25 per person per night: 250 cents a night for the 2 adults.
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges) VALUES ($1, '2026-01-01', $2::jsonb)`,
      [ids.propertyId, JSON.stringify([{ kind: "fixed", amountCents: 125, perPerson: true, perNight: true, perRoom: false }])],
    );
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const list = async () => (await db.query(GUEST_BOOKINGS_SQL, [guest])).rows as GuestBookingListRow[];

  test("what was paid is the nights' cents and their tourist tax", async () => {
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, userId: guest });
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date("2031-10-01T10:00:00Z") });
    expect((await list()).map((r) => r.total_paid_cents)).toEqual([20500]);
  });

  test("a booking without night snapshots falls back to its total in cents", async () => {
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, userId: guest });
    await db.query(`UPDATE bookings SET status = 'confirmed', tourist_tax_cents = 650, total_cents = 20650 WHERE id = $1`, [bookingId]);
    expect((await list()).map((r) => r.total_paid_cents)).toEqual([20650]);
  });

  test("the data export lists the booking total and refunds in cents", async () => {
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, userId: guest });
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date("2031-10-01T10:00:00Z") });
    await db.query(
      `INSERT INTO refunds (booking_id, reservation_id, accommodation_cents, tourist_tax_cents, amount_cents, reason, status, idempotency_key)
       VALUES ($1, $2, 10000, 250, 10250, 'guest_cancellation', 'succeeded', $3)`,
      [bookingId, reservationIds[0], `test-refund-${crypto.randomUUID()}`],
    );
    const [row] = (await db.query(EXPORT_QUERIES.bookings, [guest])).rows;
    expect(Number(row.total_cents)).toBe(20000);
    expect(row.refunds).toMatchObject([{ amount_cents: 10250, status: "succeeded" }]);
  });
});

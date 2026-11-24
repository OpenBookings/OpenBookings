/**
 * Only the guest who made a booking can load it. Every test runs in a
 * transaction that is rolled back; skipped without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { confirmBookingPolicy } from "@openbookings/db";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedGuest, seedProperty } from "@openbookings/db/testing";
import type { GuestBookingRow } from "./shape";
import { loadGuestBooking } from "./load";

const CHECK_IN = "2031-11-10";
const NOW = new Date("2031-10-01T10:00:00Z");

describeWithDb("loadGuestBooking against Postgres", () => {
  let db: Client;
  let bookingId: string;
  let reservationId: string;
  let guest: string;
  const run = async (sql: string, values: unknown[]) => (await db.query(sql, values)).rows as GuestBookingRow[];

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
    const ids = await seedProperty(db);
    guest = await seedGuest(db);
    // Two nights at €100 (10000 cents), and €2.50 a night tourist tax for the 2 adults.
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges) VALUES ($1, '2026-01-01', $2::jsonb)`,
      [ids.propertyId, JSON.stringify([{ kind: "fixed", amountCents: 125, perPerson: true, perNight: true, perRoom: false }])],
    );
    const seeded = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2, userId: guest });
    bookingId = seeded.bookingId;
    reservationId = seeded.reservationIds[0]!;
    await db.query(`UPDATE reservations SET cots = 1, pay_at_property_cents = 1550 WHERE id = $1`, [reservationId]);
    await confirmBookingPolicy(db, { bookingId, confirmedAt: NOW });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("the guest who booked sees it, with what was paid in cents", async () => {
    const booking = await loadGuestBooking(bookingId, guest, run, NOW);
    expect(booking?.rooms).toHaveLength(1);
    expect(booking?.canCancel).toBe(true);
    // 2 × 10000 room + 2 × 250 tax.
    expect(booking?.rooms[0]).toMatchObject({ paidCents: 20500, payAtPropertyCents: 1550 });
    expect(booking).toMatchObject({ totalPaidCents: 20500, payAtPropertyCents: 1550, refundedCents: 0 });
  });

  test("refunds that did not fail add up, in cents", async () => {
    for (const [cents, status] of [
      [10250, "succeeded"],
      [1, "pending"],
      [999, "failed"],
    ] as const) {
      await db.query(
        `INSERT INTO refunds (booking_id, reservation_id, accommodation_cents, tourist_tax_cents, amount_cents, reason, status, idempotency_key)
         VALUES ($1, $2, $3, 0, $3, 'guest_cancellation', $4, $5)`,
        [bookingId, reservationId, cents, status, `test-refund-${crypto.randomUUID()}`],
      );
    }
    expect((await loadGuestBooking(bookingId, guest, run, NOW))?.refundedCents).toBe(10251);
  });

  test("anyone else gets nothing", async () => {
    expect(await loadGuestBooking(bookingId, "someone-else", run, NOW)).toBeNull();
  });
});

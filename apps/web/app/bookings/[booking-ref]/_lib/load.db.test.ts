/**
 * Only the guest who made a booking can load it. Runs on the CI database
 * (a throwaway Neon branch); skipped locally without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { confirmBookingPolicy } from "@openbookings/db";
import type { GuestBookingRow } from "./shape";
import { loadGuestBooking } from "./load";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.CI) {
  throw new Error("DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.");
}
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb("loadGuestBooking against Postgres", () => {
  let db: Client;
  let bookingId: string;
  const guest = `test-guest-${crypto.randomUUID()}`;
  const run = async (sql: string, values: unknown[]) => (await db.query(sql, values)).rows as GuestBookingRow[];
  const one = async (sql: string, values: unknown[]) => (await db.query(sql, values)).rows[0] as { id: string };

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, 'Test Guest', $2, true, 'private'::account_type)`,
      [guest, `${guest}@example.test`],
    );
    const property = await one(
      `INSERT INTO properties (name, slug, address_line_1, city, country, timezone, location, check_in_time, check_out_time, is_active)
       VALUES ('Test Property', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326), '15:00', '11:00', true) RETURNING id`,
      [`test-property-${crypto.randomUUID()}`],
    );
    const room = await one(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active)
       VALUES ($1, 'Deluxe', 2, 2, 3, true) RETURNING id`,
      [property.id],
    );
    const rate = await one(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active) VALUES ($1, 'Room only', 100, true, true) RETURNING id`,
      [room.id],
    );
    bookingId = (
      await one(
        `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, total_amount)
         VALUES ($1, $2, CURRENT_DATE + 30, CURRENT_DATE + 32, 'pending', 200) RETURNING id`,
        [property.id, guest],
      )
    ).id;
    await db.query(
      `INSERT INTO reservations (booking_id, room_id, rate_plan_id, adults, total_nights, price_per_night, total_amount)
       VALUES ($1, $2, $3, 2, 2, 100, 200)`,
      [bookingId, room.id, rate.id],
    );
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date() });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("the guest who booked sees it", async () => {
    const booking = await loadGuestBooking(bookingId, guest, run);
    expect(booking?.rooms).toHaveLength(1);
    expect(booking?.canCancel).toBe(true);
  });

  test("anyone else gets nothing", async () => {
    expect(await loadGuestBooking(bookingId, "someone-else", run)).toBeNull();
  });
});

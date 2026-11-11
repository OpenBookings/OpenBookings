/**
 * The host reservations query against a real Postgres: which bookings a host
 * sees, and what the screen gets for each. Same harness as the listings
 * suites: a throwaway Neon branch in CI, rolled back per test, skipped
 * locally without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import type { SessionLike } from "@openbookings/authz";
import { confirmBookingPolicy } from "@openbookings/db";
import { applyPendingMigrations } from "@/app/(dashboard)/dashboard/listings/_lib/pending-migrations";
import { DEMO_ORG_ID } from "@openbookings/mode";
import { userOwnsProperty } from "@openbookings/authz";
import { loadHostReservations } from "./query";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.CI) {
  throw new Error("DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.");
}
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb("loadHostReservations against Postgres", () => {
  let db: Client;
  let owner: string;
  let stranger: string;
  let bookingId: string;
  let propertyId: string;

  const session = (id: string): SessionLike => ({ user: { id, account_type: "business" } });
  const hostDb = (s: SessionLike) => ({
    query: async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, [s.user.id, ...values])).rows as T[],
  });
  const one = async (sql: string, values: unknown[]) => (await db.query(sql, values)).rows[0] as { id: string };

  async function createUser(accountType: "private" | "business") {
    const id = `test-${accountType}-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'Emma Test', $2, true, $3::account_type)`,
      [id, `${id}@example.test`, accountType],
    );
    return id;
  }

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
    owner = await createUser("business");
    stranger = await createUser("business");
    const guest = await createUser("private");

    const property = await one(
      `INSERT INTO properties (name, slug, address_line_1, city, country, timezone, location,
         check_in_time, check_out_time, owner_user_id, is_active, cancellation_tier)
       VALUES ('Test Property', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326), '15:00', '11:00', $2, true, 'flex')
       RETURNING id`,
      [`test-property-${crypto.randomUUID()}`, owner],
    );
    propertyId = property.id;
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
         VALUES ($1, $2, CURRENT_DATE + 30, CURRENT_DATE + 32, 'pending', 400) RETURNING id`,
        [property.id, guest],
      )
    ).id;
    for (let i = 0; i < 2; i += 1) {
      await db.query(
        `INSERT INTO reservations (booking_id, room_id, rate_plan_id, adults, total_nights, price_per_night, total_amount)
         VALUES ($1, $2, $3, 2, 2, 100, 200)`,
        [bookingId, room.id, rate.id],
      );
    }
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date() });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("the owner sees the booking, its two rooms, and can cancel it", async () => {
    const list = await loadHostReservations(session(owner), hostDb(session(owner)));
    const booking = list.find((r) => r.id === bookingId);
    expect(booking?.rooms).toHaveLength(2);
    expect(booking?.actions).toContain("cancel");
    expect(booking?.guestName).toBe("Emma Test");
  });

  test("the party by age band, the cots and beds, and what the hotel collects", async () => {
    await db.query(
      `UPDATE reservations SET infants = 1, cots = 1, pay_at_property_amount = 50
       WHERE id = (SELECT id FROM reservations WHERE booking_id = $1 LIMIT 1)`,
      [bookingId],
    );
    const booking = (await loadHostReservations(session(owner), hostDb(session(owner)))).find((r) => r.id === bookingId);
    expect(booking).toMatchObject({ guests: 4, partyLabel: "4 adults, 1 infant", extrasLabel: "1 cot", atHotelAmount: 50 });
  });

  test("another host sees nothing", async () => {
    const list = await loadHostReservations(session(stranger), hostDb(session(stranger)));
    expect(list.find((r) => r.id === bookingId)).toBeUndefined();
  });

  describe("a leftover demo membership", () => {
    beforeEach(async () => {
      await db.query(
        `INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Demo', 'demo-test', NOW()) ON CONFLICT (id) DO NOTHING`,
        [DEMO_ORG_ID],
      );
      await db.query(`UPDATE properties SET organization_id = $1, owner_user_id = NULL WHERE id = $2`, [DEMO_ORG_ID, propertyId]);
      await db.query(
        `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, 'owner', NOW())`,
        [DEMO_ORG_ID, stranger],
      );
    });
    const ownsDeps = (testing: boolean) => ({
      testing,
      queryOne: async <T,>(sql: string, values: unknown[] = []) => ((await db.query(sql, values)).rows[0] ?? null) as T | null,
    });

    test("grants nothing with testing mode off", async () => {
      const list = await loadHostReservations(session(stranger), hostDb(session(stranger)), new Date(), false);
      expect(list.find((r) => r.id === bookingId)).toBeUndefined();
      expect(await userOwnsProperty(session(stranger), propertyId, ownsDeps(false))).toBe(false);
    });

    test("applies with testing mode on", async () => {
      const list = await loadHostReservations(session(stranger), hostDb(session(stranger)), new Date(), true);
      expect(list.find((r) => r.id === bookingId)).toBeDefined();
      expect(await userOwnsProperty(session(stranger), propertyId, ownsDeps(true))).toBe(true);
    });
  });
});

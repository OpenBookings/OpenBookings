/**
 * Shared setup for the DB-backed suites in this package. Same rules as the
 * business app's: a throwaway Neon branch in CI, every test inside a
 * transaction that is rolled back, skipped locally without DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe } from "bun:test";
import type { Client } from "pg";

export const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.CI) {
  throw new Error("DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.");
}

export const describeWithDb = connectionString ? describe : describe.skip;

/**
 * Migrations this branch reads that may not be on the CI database yet. Idempotent.
 * Remove an entry once that migration is on the dev database.
 *
 * Each file replays inside every test's transaction, and even a no-op
 * `ALTER TABLE ... IF NOT EXISTS` holds an exclusive table lock until the
 * ROLLBACK. Turbo runs the DB suites of several packages at once on the same
 * branch, so a long list here makes them queue behind each other's locks.
 */
const PENDING: string[] = [
  "0032_booking_events.sql",
  "0033_booking_intents.sql",
  "0034_booking_intents_dates_not_null.sql",
];
const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

export async function applyPendingMigrations(db: Client): Promise<void> {
  for (const file of PENDING) {
    await db.query(readFileSync(fileURLToPath(new URL(file, DRIZZLE_DIR)), "utf8"));
  }
}

/** A property with one room and one rate plan, in `Europe/Amsterdam`, check-in 15:00. */
export async function seedProperty(
  db: Client,
  opts: { tier?: "flex" | "standard"; isRefundable?: boolean } = {},
): Promise<{ propertyId: string; roomId: string; ratePlanId: string }> {
  const one = async (sql: string, values: unknown[]) => (await db.query(sql, values)).rows[0] as { id: string };
  const property = await one(
    `INSERT INTO properties
       (name, slug, address_line_1, city, country, timezone, location,
        check_in_time, check_in_until, check_out_time, is_active, cancellation_tier)
     VALUES ('Test Property', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
             ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326),
             '15:00', '22:00', '11:00', true, $2::cancellation_tier)
     RETURNING id`,
    [`test-property-${crypto.randomUUID()}`, opts.tier ?? "flex"],
  );
  const room = await one(
    `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active)
     VALUES ($1, 'Double', 2, 2, 5, true) RETURNING id`,
    [property.id],
  );
  const rate = await one(
    `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active)
     VALUES ($1, 'Room only', 100, $2, true) RETURNING id`,
    [room.id, opts.isRefundable ?? true],
  );
  return { propertyId: property.id, roomId: room.id, ratePlanId: rate.id };
}

/**
 * A guest account. `bookings.user_id` references `"user"(id)` on the real
 * database, so every booking needs one.
 */
export async function seedGuest(db: Client): Promise<string> {
  const id = `test-guest-${crypto.randomUUID()}`;
  await db.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
     VALUES ($1, 'Test Guest', $2, true, 'private'::account_type)`,
    [id, `${id}@example.test`],
  );
  return id;
}

/** A booking in `pending` with `rooms` reservations of `nights` nights at €100. */
export async function seedBooking(
  db: Client,
  ids: { propertyId: string; roomId: string; ratePlanId: string },
  opts: { checkIn: string; nights: number; rooms?: number; userId?: string },
): Promise<{ bookingId: string; reservationIds: string[] }> {
  const rooms = opts.rooms ?? 1;
  const userId = opts.userId ?? (await seedGuest(db));
  const checkOut = new Date(Date.parse(`${opts.checkIn}T00:00:00Z`) + opts.nights * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const booking = (
    await db.query(
      `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, total_amount, stripe_payment_intent_id)
       VALUES ($1, $2, $3, $4, 'pending', $5, 'pi_test') RETURNING id`,
      [ids.propertyId, userId, opts.checkIn, checkOut, 100 * opts.nights * rooms],
    )
  ).rows[0] as { id: string };
  const reservationIds: string[] = [];
  for (let i = 0; i < rooms; i += 1) {
    const res = (
      await db.query(
        `INSERT INTO reservations (booking_id, room_id, rate_plan_id, adults, total_nights, price_per_night, total_amount)
         VALUES ($1, $2, $3, 2, $4, 100, $5) RETURNING id`,
        [booking.id, ids.roomId, ids.ratePlanId, opts.nights, 100 * opts.nights],
      )
    ).rows[0] as { id: string };
    reservationIds.push(res.id);
  }
  return { bookingId: booking.id, reservationIds };
}

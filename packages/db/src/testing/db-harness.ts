/**
 * Shared setup for the DB-backed suites in this package. Same rules as the
 * business app's: a throwaway Neon branch in CI, every test inside a
 * transaction that is rolled back, skipped locally without DATABASE_URL.
 */
import { describe } from "bun:test";
import { Client } from "pg";
import { PENDING_MIGRATIONS, pendingMigrationSql } from "./pending-migrations";

export const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.CI) {
  throw new Error("DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.");
}

export const describeWithDb = connectionString ? describe : describe.skip;

const PENDING_MIGRATIONS_LOCK = 7_301_032;

/**
 * Replay the pending migrations (see pending-migrations.ts) inside the
 * caller's transaction. A no-op in CI, which applies them once up front.
 *
 * Each file holds its table locks until the test's ROLLBACK: even a no-op
 * `ALTER TABLE ... IF NOT EXISTS` takes an exclusive one, and a no-op
 * `CREATE INDEX IF NOT EXISTS` a SHARE lock. Two suites can both hold the
 * SHARE lock, then both insert into that table, and each waits on the
 * other: a deadlock. So the replay first takes one advisory lock and suites
 * take turns. That queueing is slow, which is why CI skips it: a test whose
 * setup passes bun's 5-second hook limit keeps running in the background and
 * spills its statements into the next test's transaction.
 */
export async function applyPendingMigrations(db: Client): Promise<void> {
  if (PENDING_MIGRATIONS.length === 0 || process.env.PENDING_MIGRATIONS_APPLIED === "1") return;
  await db.query("SELECT pg_advisory_xact_lock($1)", [PENDING_MIGRATIONS_LOCK]);
  for (const file of PENDING_MIGRATIONS) {
    await db.query(pendingMigrationSql(file));
  }
}

/**
 * For suites that COMMIT (separate connections, a real pool), which cannot
 * replay the pending migrations inside a transaction that is rolled back:
 * whether the database has this branch's schema, so the suite can run.
 *
 * In CI the database is a throwaway branch, so the pending migrations are
 * applied there for good (one transaction, under the replay lock) unless the
 * Verify job already did (`PENDING_MIGRATIONS_APPLIED=1`) and the newest
 * table is there; the answer is then always true. Outside CI nothing is ever
 * applied: the answer is false when the newest table (`invoices`) is missing,
 * so the suite skips itself (`describe.skip`) instead of failing on it.
 * Uses `db` when given, else a connection of its own; false without a database.
 */
export async function ensureCommittedMigrations(db?: Pick<Client, "query">): Promise<boolean> {
  const url = process.env.DATABASE_URL_DIRECT ?? connectionString;
  if (!db && !url) return false;
  const own = db ? null : new Client({ connectionString: url });
  const conn = db ?? own!;
  try {
    if (own) await own.connect();
    const ready = async () =>
      ((await conn.query(`SELECT to_regclass('public.invoices') IS NOT NULL AS ready`)).rows[0] as { ready: boolean }).ready;
    if (!process.env.CI) return await ready();
    if (process.env.PENDING_MIGRATIONS_APPLIED === "1" && (await ready())) return true;
    await conn.query("BEGIN");
    try {
      await conn.query("SELECT pg_advisory_xact_lock($1)", [PENDING_MIGRATIONS_LOCK]);
      for (const file of PENDING_MIGRATIONS) await conn.query(pendingMigrationSql(file));
      await conn.query("COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK").catch(() => {});
      throw error;
    }
    return true;
  } finally {
    await own?.end();
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

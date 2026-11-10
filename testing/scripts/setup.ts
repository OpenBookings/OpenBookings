/**
 * Builds a local test database from scratch:
 *
 *   1. wipes the database (local databases only, see `assertLocal`),
 *   2. loads the schema snapshot (testing/schema/schema.sql),
 *   3. applies the migrations newer than the snapshot,
 *   4. loads the seed files (testing/seed/*.sql, in name order), and
 *   5. runs each seeded booking through the same policy code checkout uses,
 *      then fills in its totals and commission.
 *
 *   bun run testing:setup
 *
 * Connects to TESTING_DATABASE_URL, or otherwise to the Postgres from
 * testing/docker-compose.yml. DATABASE_URL is ignored on purpose: it often
 * points at a shared database, and this script wipes what it connects to.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { RATES_TAX_INCLUSIVE_DOC_ID } from "@openbookings/authz/rates-doc";
import { commissionSplit } from "@openbookings/billing/commission";
import { confirmBookingPolicy } from "@openbookings/db";
import { PENDING_MIGRATIONS, pendingMigrationSql } from "../../packages/db/src/testing/pending-migrations";
import { applicationFeeCents } from "@openbookings/stripe/fees";

const LOCAL_DEFAULT = "postgres://postgres:postgres@127.0.0.1:5433/openbookings";
const COMMISSION_RATE = 0.045;
/** The hotel that gets STRIPE_CONNECT_ACCOUNT_ID, so it can take a test payment. */
const CHECKOUT_PROPERTY_ID = "5eed1000-0000-4000-8000-000000000001";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");

/**
 * This script drops every table, so it refuses anything but a database on
 * this machine. There is no override on purpose: never point it at a shared
 * or hosted database.
 */
function assertLocal(connectionString: string): void {
  const { hostname } = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error(
      `Refusing to reset ${hostname}: testing:setup wipes the database and only runs against localhost.`,
    );
  }
}

async function withClient<T>(connectionString: string, fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function reset(db: Client): Promise<void> {
  await db.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.query(`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.query(`CREATE SCHEMA public`);
}

async function seedBookings(db: Client): Promise<number> {
  const { rows: bookings } = await db.query<{ id: string; confirmed_at: Date }>(
    `SELECT id, COALESCE(confirmed_at, created_at) AS confirmed_at
       FROM bookings WHERE id::text LIKE '5eed4000-%' ORDER BY id`,
  );

  for (const booking of bookings) {
    // Cancellation windows, per-night prices and tourist tax, exactly as a
    // real booking gets them when it is paid.
    await confirmBookingPolicy(db, { bookingId: booking.id, confirmedAt: booking.confirmed_at });

    const { rows } = await db.query<{ rooms_cents: string; tax_cents: string }>(
      `SELECT COALESCE(sum((SELECT round(sum((n->>'price')::numeric) * 100) FROM jsonb_array_elements(nights) n)), 0) AS rooms_cents,
              COALESCE(sum(round(tourist_tax_amount * 100)), 0) AS tax_cents
         FROM reservations WHERE booking_id = $1`,
      [booking.id],
    );
    const roomsCents = Number(rows[0]!.rooms_cents);
    const taxCents = Number(rows[0]!.tax_cents);
    const commissionCents = applicationFeeCents(roomsCents, COMMISSION_RATE);
    const split = commissionSplit({ feeCents: commissionCents, treatment: "NL_DOMESTIC" });

    await db.query(
      `UPDATE bookings
          SET rooms_total_cents = $2, tourist_tax_cents = $3, total_cents = $2::bigint + $3::bigint,
              total_amount = round(($2::bigint + $3::bigint) / 100.0),
              commission_cents = $4, commission_rate = $5, commission_vat_treatment = 'NL_DOMESTIC',
              commission_net_cents = $6, commission_vat_cents = $7
        WHERE id = $1`,
      [booking.id, roomsCents, taxCents, commissionCents, COMMISSION_RATE, split.netCents, split.vatCents],
    );
  }
  return bookings.length;
}

async function main(): Promise<void> {
  const connectionString = process.env.TESTING_DATABASE_URL || LOCAL_DEFAULT;
  assertLocal(connectionString);
  const { hostname, port, pathname } = new URL(connectionString);
  console.log(`Setting up ${hostname}:${port || 5432}${pathname}`);

  await withClient(connectionString, async (db) => {
    await reset(db);
    // The snapshot sets search_path to '' for the session; a fresh client
    // below starts clean.
    await db.query(read("schema/schema.sql"));
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_catalog.pg_tables WHERE schemaname = 'public'`,
    );
    console.log(`  schema       ${rows[0]!.n} tables`);
  });

  await withClient(connectionString, async (db) => {
    await db.query("BEGIN");
    for (const file of PENDING_MIGRATIONS) await db.query(pendingMigrationSql(file));
    await db.query("COMMIT");
    console.log(`  migrations   ${PENDING_MIGRATIONS.length} applied on top of the snapshot`);

    await db.query("BEGIN");
    const seeds = readdirSync(fileURLToPath(new URL("seed/", root)))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of seeds) await db.query(read(`seed/${file}`));

    // In code rather than SQL, so they follow the app's constants.
    await db.query(
      `INSERT INTO org_consent (organization_id, doc_id, signed_by_user_id, signer_full_name, signer_role_title, signed_at)
       VALUES ('seed-org-lantern', $1, 'seed-user-owner', 'Sanne de Vries', 'Owner', now() - interval '118 days')`,
      [RATES_TAX_INCLUSIVE_DOC_ID],
    );
    const account = process.env.STRIPE_CONNECT_ACCOUNT_ID?.trim();
    if (account) {
      await db.query(`UPDATE properties SET stripe_account_id = $2 WHERE id = $1`, [CHECKOUT_PROPERTY_ID, account]);
    }
    const bookings = await seedBookings(db);
    await db.query("COMMIT");

    console.log(`  seed         ${seeds.join(", ")}`);
    console.log(`  bookings     ${bookings} run through the booking policy`);
    console.log(
      account
        ? `  stripe       Canal Lantern Hotel takes payments on ${account}`
        : "  stripe       STRIPE_CONNECT_ACCOUNT_ID not set: seeded hotels can't take a test payment (demo hotels still can)",
    );
  });

  console.log("\nDone. Sign in as owner@openbookings.test (host) or guest@openbookings.test (guest).");
  console.log("The accounts and hotels are listed in testing/README.md.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

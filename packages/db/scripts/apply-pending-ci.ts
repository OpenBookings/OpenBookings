/**
 * Apply the test harness's pending migrations (src/testing/pending-migrations.ts)
 * to CI's throwaway database, once, before the tests run. The Verify job then
 * sets PENDING_MIGRATIONS_APPLIED=1 and the harness stops replaying them in
 * every test, which made the DB suites queue on each other's table locks.
 *
 * Not migrate-ci.ts: on a database that already has tables it records every
 * file as applied without running it, so these would never execute.
 *
 * Refuses to run outside CI: the dev database must not keep these early.
 */
import { Client } from "pg";
import { PENDING_MIGRATIONS, pendingMigrationSql } from "../src/testing/pending-migrations";

const connectionString = process.env.DATABASE_URL_DIRECT;

if (!process.env.CI) {
  throw new Error("Only for CI's throwaway database. Locally the test harness replays these per test.");
}
if (!connectionString) {
  throw new Error("Set DATABASE_URL_DIRECT before applying pending migrations");
}

const db = new Client({ connectionString });
await db.connect();
try {
  await db.query("BEGIN");
  for (const file of PENDING_MIGRATIONS) {
    console.log(`Applying ${file}`);
    await db.query(pendingMigrationSql(file));
  }
  await db.query("COMMIT");
  console.log(`Applied ${PENDING_MIGRATIONS.length} pending migration(s).`);
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await db.end();
}

import { Client } from "pg";
import { applyMigrations, type Queryable } from "../db/migrate";

/**
 * The database the app's DB tests run against: the app's own URL when set,
 * else the core one (locally the shared dev database, in CI the postgis
 * service). Tests never leave anything behind either way.
 */
export function testDatabaseUrl(): string | undefined {
  return process.env.SITEMINDER_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || undefined;
}

/**
 * For `describe.skipIf(...)`: skip DB suites when no database is configured,
 * except in CI, where a missing database is a broken pipeline.
 */
export const skipDbTests = !testDatabaseUrl() && process.env.CI !== "true";

/**
 * Run `fn` with a client inside a transaction that is always rolled back, with
 * the `siteminder` schema and every migration applied inside that same
 * transaction. Nothing is committed, so nothing is left on a shared database
 * (DDL is transactional in Postgres). Never run `db/migrate.ts` against a dev
 * database to prepare for a test; this is the way.
 */
export async function withTestDb<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  const connectionString = testDatabaseUrl();
  if (!connectionString) throw new Error("Set SITEMINDER_DATABASE_URL or DATABASE_URL to run the database tests");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await applyMigrations(client);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

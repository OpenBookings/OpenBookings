import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Migrations the code in this branch reads but that may not be on the database
 * the DB-backed tests run against yet.
 *
 * Those suites run on a throwaway Neon branch of the dev database, and
 * migrations are applied by the deploy, after CI. So a change that adds a
 * column and a query that reads it would fail its own CI until someone applied
 * the SQL by hand. Running the files inside the test's own transaction closes
 * that gap: every file here is idempotent, so on a database that already has
 * them this is a no-op, and the ROLLBACK after each test discards it either
 * way.
 *
 * Remove an entry once that migration is on the dev database.
 */
const PENDING = ["0023_rooms_editor.sql"];

const DRIZZLE_DIR = new URL("../../../../../../../packages/db/drizzle/", import.meta.url);

export const PENDING_MIGRATIONS_SQL = PENDING.map((file) =>
  readFileSync(fileURLToPath(new URL(file, DRIZZLE_DIR)), "utf8"),
);

/** Apply the pending migrations on `db`. Call inside the test's transaction. */
export async function applyPendingMigrations(db: { query: (sql: string) => Promise<unknown> }) {
  for (const sql of PENDING_MIGRATIONS_SQL) await db.query(sql);
}

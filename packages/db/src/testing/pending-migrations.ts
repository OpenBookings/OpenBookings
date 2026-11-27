/**
 * Migrations this branch reads that may not be on the CI database yet. Idempotent.
 * Remove an entry once that migration is on the dev database.
 *
 * In CI, `bun run db:apply-pending:ci` applies these once to the throwaway
 * database before the tests start, and sets PENDING_MIGRATIONS_APPLIED so the
 * test harness skips them. Locally they replay inside every test's
 * transaction instead (see applyPendingMigrations in db-harness.ts), so
 * nothing is left behind on the dev database.
 *
 * Kept apart from db-harness.ts so the CI script can read the list without
 * importing bun:test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PENDING_MIGRATIONS: string[] = ["0059_user_first_last_name.sql", "0060_admin_production.sql", "0061_review_moderation.sql"];

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

export function pendingMigrationSql(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, DRIZZLE_DIR)), "utf8");
}

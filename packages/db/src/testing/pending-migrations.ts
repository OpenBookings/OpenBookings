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

export const PENDING_MIGRATIONS: string[] = [
  "0032_booking_events.sql",
  "0033_booking_intents.sql",
  "0034_booking_intents_dates_not_null.sql",
  "0035_booking_money_cents.sql",
  "0036_commission_invoices.sql",
  "0037_billing_report_views.sql",
];

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

export function pendingMigrationSql(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, DRIZZLE_DIR)), "utf8");
}

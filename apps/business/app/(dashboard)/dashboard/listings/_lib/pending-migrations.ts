/**
 * The business suites use the shared pending-migrations replay from
 * @openbookings/db/testing. List new migrations in
 * packages/db/src/testing/pending-migrations.ts, not here.
 *
 * This file used to keep its own list and replay it in every test's
 * transaction. That skipped the shared helper's two safeguards: in CI it
 * does nothing (PENDING_MIGRATIONS_APPLIED=1, the Verify job applies the
 * files once up front), and locally it takes an advisory lock so suites take
 * turns. Without them the no-op DDL took table locks in parallel suites and
 * deadlocked them.
 */
export { applyPendingMigrations } from "@openbookings/db/testing";

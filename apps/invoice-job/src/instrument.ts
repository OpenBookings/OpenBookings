/**
 * Runs before anything else the job imports (main.ts imports it first).
 *
 * `@openbookings/db` reads its Postgres caps when it is first imported, and
 * its defaults (15 s per statement, 15 s idle in a transaction) are sized for
 * web requests. A month's reconciliation reads Stripe page by page inside one
 * transaction on a dry run, and the report views scan a quarter, so the job
 * allows 120 s per statement and 300 s idle in a transaction unless the
 * environment says otherwise.
 *
 * Sentry starts here too, so errors from every later import are captured.
 * Without `SENTRY_DSN` it stays off.
 */
import * as Sentry from "@sentry/bun";

process.env.PG_STATEMENT_TIMEOUT_MS ||= "120000";
process.env.PG_IDLE_TX_TIMEOUT_MS ||= "300000";
process.env.SERVICE_NAME ||= "invoice-job";

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.INVOICE_DB_ENV === "production" ? "production" : "test",
  tracesSampleRate: 0,
});

# SiteMinder app

A Bun/Hono service that connects OpenBookings hotels to SiteMinder (SiteConnect, OTA SOAP). It talks to
core only through the Apps API and may depend on `@openbookings/apps-contract` alone among workspace
packages; `bun .github/scripts/check-app-boundaries.ts` enforces that in CI.

## Database

Its own database in production (`SITEMINDER_DATABASE_URL`), all tables in Postgres schema `siteminder`.
`bun run db:migrate` applies `migrations/*.sql` in order and records each in `siteminder.migrations`
(filename + sha256); an edited, already-applied file is refused, so change history with a new file.

Tests use `SITEMINDER_DATABASE_URL ?? DATABASE_URL` and run inside `BEGIN ... ROLLBACK` with the schema
applied in that transaction (`src/testing/db-harness.ts`, `withTestDb`), so nothing is left on the
database. Never run `db:migrate` against the shared dev database.

```sh
bun --env-file=../../.env.local test --timeout 30000
```

## Environment

See `src/env.ts`. `SITEMINDER_RUN_MODE` is `always-on` or `scale-to-zero` (default); the poll interval
defaults to 60 s / 300 s.

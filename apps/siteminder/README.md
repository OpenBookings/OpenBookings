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

## Testing locally

SiteMinder's sample messages live in `fixtures/` on disk only (untracked: the secret scanner flags their sample
EchoTokens), see `fixtures/README.md` for where each comes from.

### Replay against a fake core

`src/testing/fake-core.ts` is a small stand-in for core's Apps API (two rooms SGL and DBL, two rate plans BAR and
BNB; it records every `POST /api/apps/v1/ari`). `scripts/dev-with-fake-core.ts` starts it on :4010, applies the
app's migrations, registers an installation for hotel `FAKE-HOTEL` and serves the app on :3004. It needs a
throwaway local Postgres and refuses any database that is not on localhost. Never use the shared dev database.

```sh
docker run -d --name sm-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=siteminder -p 127.0.0.1:55432:5432 postgis/postgis
cd apps/siteminder
SITEMINDER_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/siteminder bun run scripts/dev-with-fake-core.ts

# in a second shell (credentials as printed by the first)
SITEMINDER_INBOUND_USERNAME=replay-user SITEMINDER_INBOUND_PASSWORD=replay-pass \
  bun run scripts/replay.ts --url http://localhost:3004/soap --hotel FAKE-HOTEL --days 750 --core http://localhost:4010
```

`replay.ts` sends every request sample (or the fixtures you name) with the hotel code and dates rewritten (earliest
date lands on today + 7), a fresh UUID EchoToken per message and the inbound credentials, and prints status and
reply time per message. `--days N` (1 to 750) adds a bulk load of availability, restrictions and rates for
SGL/BAR. `--core` waits a few seconds and prints what the fake core received after the tick. Samples for features
we do not offer (Included Occupancy, OBP) are expected to be rejected with the docs' "Invalid included occupancy";
the script counts that as right. Exit code 1 means a wrong answer or a reply of 2 s or more.

### Postman

SiteMinder publishes its collections in the SiteConnect Postman workspace
(https://www.postman.com/siteminder-apis/siteconnect/overview). There is no public file or URL to download: fork
the collections and environments into your own Postman account, then run them with the Postman CLI against the
local endpoint, with the inbound credentials in the environment:

```sh
postman login
postman collection run <collection-id-or-exported.json> -e <environment-id-or-file> \
  --env-var url=http://localhost:3004/soap --env-var hotelCode=FAKE-HOTEL
```

Use the variable names of the forked environment. Run the inventory (Rooms and Rates, availability, rates)
requests against the local endpoint. The Reservation and Error Handling scenarios need SiteMinder's test platform
(it calls the endpoint, or receives our reservations on `SITEMINDER_RESERVATION_URL`). Do not commit collections.

### Against real business (deferred)

Once the Apps API migration (`0060_apps_api.sql`) is on a database, start core (`business.localhost:3001`), connect
a demo property to the SiteMinder app, register the app's installation, then run `replay.ts` with `--hotel <the
property code>` and without `--core`, and check the rates grid shows the values as managed by the app.

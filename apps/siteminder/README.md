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
app's migrations, registers an installation for hotel `FAKE-HOTEL` and serves the app on :3006. It needs a
throwaway local Postgres and refuses any database that is not on localhost. Never use the shared dev database.

```sh
docker run -d --name sm-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=siteminder -p 127.0.0.1:55432:5432 postgres:17
cd apps/siteminder
SITEMINDER_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/siteminder bun run scripts/dev-with-fake-core.ts

# in a second shell (credentials as printed by the first)
SITEMINDER_INBOUND_USERNAME=replay-user SITEMINDER_INBOUND_PASSWORD=replay-pass \
  bun run scripts/replay.ts --url http://localhost:3006/soap --hotel FAKE-HOTEL --days 750 --core http://localhost:4010
```

`replay.ts` sends every request sample SiteMinder sends us (or the fixtures you name; the `reservation-*` samples are
what we send SiteMinder, so they are left out) with the hotel code and dates rewritten (earliest
date lands on today + 7, unless `--keep-dates`), a fresh UUID EchoToken per message and the inbound credentials, and
prints status and reply time per message. `--days N` (1 to 750) adds a bulk load of availability, restrictions and
rates for one room and rate plan (`--room`/`--rate`, default SGL/BAR); `--no-samples` sends only that load. `--core`
waits a few seconds and prints what the fake core received after the tick. Samples for features
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
  --env-var url=http://localhost:3006/soap --env-var hotelCode=FAKE-HOTEL
```

Use the variable names of the forked environment. Run the inventory (Rooms and Rates, availability, rates)
requests against the local endpoint. The Reservation and Error Handling scenarios need SiteMinder's test platform
(it calls the endpoint, or receives our reservations on `SITEMINDER_RESERVATION_URL`). Do not commit collections.

### End to end against a local core

`scripts/e2e-local.ts` runs the whole loop with real business and web and a fake SiteMinder: it connects a hotel
through the Channel manager's own connect function, replays a 750-day load, waits for the booking you make on the
guest site with Stripe's test card, checks the Commit arrives and the booking shows "Sent", checks availability
went down once and not twice once SiteMinder's next limit arrives, cancels as the host, checks the Cancel arrives and
the room only comes back with SiteMinder's next limit, and disconnects. It takes about six minutes, three of them
waiting: a booking only stops counting against SiteMinder's limit when a limit arrives three minutes after
SiteMinder took it.

The core-side steps run in `apps/business/scripts/siteminder-e2e-core.ts` (this app may not import core packages).
Both the script and that helper refuse any database that is not on localhost, judged the way `pg` reads the URL
(`?host=`, `?hostaddr=` and `?service=` are refused too). Never point them at the shared dev database: they write
rows, and the app applies its migrations.

1. The local test database, with the Apps API migration (`testing:setup` applies every pending migration). For the
   seeded Canal Lantern Hotel to take a test payment, give it your test connected account:

   ```sh
   bun run testing:db
   STRIPE_CONNECT_ACCOUNT_ID=acct_... bun run testing:setup
   ```

2. Business and web on that database, ready to take a test payment: in `apps/business/.env.local` and
   `apps/web/.env.local` set `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/openbookings` (and no
   `ENV_TYPE=dev`), plus the Stripe test keys, the webhook secret and Turnstile as in the docs' "Take a test payment"
   guide (`apps/docs/content/docs/self-hosted/how-to/take-a-test-payment.mdx`). `EMAIL_TRANSPORT=console` for the
   sign-in link. Nothing SiteMinder-specific is needed in either app: the script registers the installation itself,
   and without QStash the app polls.

   ```sh
   bunx turbo run dev --filter=@openbookings/web --filter=@openbookings/business
   stripe listen --forward-connect-to web.localhost:3002/api/stripe/webhook
   ```

3. Run it, and book when it asks (as `guest@openbookings.test`, 2 adults, the room, rate and dates it prints, card
   `4242 4242 4242 4242`, any future expiry and CVC):

   ```sh
   cd apps/siteminder
   bun run scripts/e2e-local.ts
   ```

   It ends with `PASS: ...` and exit code 0, or `FAIL: <what>` and exit code 1. It starts the app on :3006 and the
   fake SiteMinder on :4011 itself, in always-on mode with a 5-second poll.

| Variable | Default | |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5433/openbookings` | Core's database, the one business and web use. |
| `SITEMINDER_DATABASE_URL` | `DATABASE_URL` | The app's database; its tables live in schema `siteminder`. |
| `CORE_URL` / `WEB_URL` | `http://localhost:3001` / `http://web.localhost:3002` | Business (the Apps API) and the guest site. |
| `PORT` / `FAKE_SITEMINDER_PORT` | `3006` / `4011` | The app and the fake SiteMinder. |
| `E2E_PROPERTY_ID`, `E2E_ROOM_ID`, `E2E_RATE_PLAN_ID` | Canal Lantern Hotel, Classic Double, Flexible | What to connect and book (seed ids). |
| `E2E_OWNER_EMAIL` | `owner@openbookings.test` | Who connects and cancels. |
| `E2E_CHECK_IN` | the hotel's today + 40 | First night of the 2-night stay (the load sets a 2-night minimum). |

Afterwards the hotel is disconnected and the test booking is cancelled and refunded in Stripe test mode. Run
`bun run testing:setup` again for a clean core database; it leaves the app's schema `siteminder` alone (`DROP SCHEMA
siteminder CASCADE` on that local database for a clean app).

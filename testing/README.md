# testing/

Everything you need for a local database you can run the apps and the test suites against:

| Path | What it is |
| --- | --- |
| `docker-compose.yml` | Postgres 17 with PostGIS 3.5 on `127.0.0.1:5433`, the same image CI uses |
| `schema/schema.sql` | A snapshot of the full database schema (structure only, no data) |
| `seed/*.sql` | Seed data with fixed IDs: accounts, hotels, rooms, rates, bookings, reviews, messages |
| `scripts/setup.ts` | Wipes the local database and rebuilds it from the snapshot, migrations and seed |
| `scripts/dump-schema.sh` | Refreshes the snapshot from a database that has the current schema |

## Use it

```bash
bun run testing:db      # start Postgres (Docker)
bun run testing:setup   # wipe it, then load schema + migrations + seed (about a second)
bun run testing:down    # stop it and delete its data
```

Then point the apps at it in their `.env.local` files:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/openbookings
DATABASE_URL_DIRECT=postgres://postgres:postgres@127.0.0.1:5433/openbookings
```

Run `testing:setup` again at any time to get back to a clean seed. It only connects to
`localhost`: it refuses any other host, because it drops every table. It uses
`TESTING_DATABASE_URL` if set, never `DATABASE_URL`.

To let a seeded hotel take a Stripe test payment, pass your test connected account:

```bash
STRIPE_CONNECT_ACCOUNT_ID=acct_... bun run testing:setup
```

That account goes on **Canal Lantern Hotel**. Without it, use the demo hotels (below) to try checkout.

> **Apple Silicon:** `postgis/postgis` only ships amd64 images, so Docker Desktop runs it under
> emulation. That's slower to start, but it's the image CI uses.

## Sign in

Every account signs in with an email link. Set `EMAIL_TRANSPORT=console` in the app's
`.env.local`, and the link is printed in the dev server's terminal instead of being emailed.

| Email | Name | Signs in to | Role |
| --- | --- | --- | --- |
| `owner@openbookings.test` | Sanne de Vries | Host dashboard | Owner of Lantern Hotels: every property |
| `admin@openbookings.test` | Lotte Jansen | Host dashboard | Admin: every property |
| `manager@openbookings.test` | Daan Bakker | Host dashboard | Manager: Canal Lantern Hotel only |
| `guest@openbookings.test` | Emma Visser | Guest site | Guest (NL) |
| `guest2@openbookings.test` | Lukas Schneider | Guest site | Guest (DE) |

Host accounts can't sign in to the guest site, and guest accounts can't sign in to the host dashboard.

## What's in the seed

**Lantern Hotels B.V.** is a Dutch organisation with a complete billing profile and the
inclusive-rates confirmation, so its live hotels pass the readiness check.

| Hotel | City | State | Cancellation | Rooms |
| --- | --- | --- | --- | --- |
| Canal Lantern Hotel | Amsterdam | live | Flex (24 h) | Classic Double ×8, Canal View Double ×4, Family Room ×2 |
| Dom Garden Suites | Utrecht | live | Standard (7 days) | Garden Studio ×6, Dom View Suite ×2 |
| Singel Loft House | Amsterdam | draft | Standard | Loft ×3; legal details missing, so not ready |

Things to find on the rates grid, all relative to today:

- Classic Double has a **Non-refundable** rate and costs **€30 more on Fridays and Saturdays**.
- Family Room's rate includes breakfast and has a **2-night minimum**.
- One Canal View Double is **out of service** from day +7 to day +10.
- Garden Studio has a **3-night minimum** from day +28 to day +34.
- Dom View Suite is **closed** from day +60 to day +62.
- Tourist tax: Amsterdam 12.5% of the room price before 9% VAT; Utrecht €3.50 per adult per night.

Bookings (dates relative to the day you ran `testing:setup`):

| ID ends | Status | Guest | Hotel | Stay | Use it to test |
| --- | --- | --- | --- | --- | --- |
| `…0001` | confirmed | Emma | Canal Lantern | +14 → +17 | Free cancellation, an unread guest message |
| `…0002` | confirmed | Emma | Canal Lantern | +30 → +32 | A non-refundable booking |
| `…0003` | confirmed | Lukas | Dom Garden | +45 → +48 | Two rooms in one booking |
| `…0004` | checked in | Lukas | Canal Lantern | −1 → +2 | A guest in house |
| `…0005` | completed | Emma | Canal Lantern | −40 → −37 | A 9/10 review with a host reply |
| `…0006` | completed | Lukas | Dom Garden | −20 → −18 | A 7/10 review waiting for a reply |
| `…0007` | completed | Emma | Dom Garden | −3 → −1 | A stay that just ended (review invitation) |
| `…0008` | cancelled | Emma | Canal Lantern | +20 → +22 | A guest cancellation |
| `…0009` | no-show | Lukas | Dom Garden | −10 → −8 | A no-show |

Full IDs follow one pattern per table, e.g. booking `5eed4000-0000-4000-8000-000000000001`:
properties `5eed1000-…`, rooms `5eed2000-…`, rate plans `5eed3000-…`, bookings `5eed4000-…`,
reservations `5eed5000-…`, reviews `5eed6000-…`, message threads `5eed7000-…`.

Seeded bookings carry the cancellation windows, per-night prices, tourist tax and commission
that checkout would have written. They have no Stripe payment and no commission-ledger entries,
so they won't appear on a commission invoice.

### Demo hotels

With testing mode on (`TESTING=true` and an `sk_test_` Stripe key), the first search near any
point creates eight extra **demo hotels** there, one per booking-flow edge case (last room, sold
out, minimum stay, no arrival, non-refundable, weekend prices, …). Every host who signs in
becomes an owner of the demo organisation, and checkout at demo hotels uses
`STRIPE_CONNECT_ACCOUNT_ID`. See `packages/demo`. `bun run --cwd packages/demo demo:reset`
removes them.

## Run the test suites against it

```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/openbookings
export DATABASE_URL_DIRECT=$DATABASE_URL
export PENDING_MIGRATIONS_APPLIED=1   # setup.ts already applied them
bun run test
```

Tests roll back their own fixtures, so the seed stays as it is.

## Keeping it current

- **A new migration:** add it to `packages/db/src/testing/pending-migrations.ts` (as before).
  `setup.ts` applies that list on top of the snapshot, so nothing else changes.
- **Refreshing the snapshot:** once the migrations are on the development database, dump it
  again and empty the pending list:

  ```bash
  SCHEMA_SOURCE_URL=postgres://… bun run --cwd testing schema:dump
  ```

- **New seed data:** add rows to the matching `seed/*.sql` file, or a new numbered file. Use fixed
  IDs that follow the patterns above, dates relative to `current_date`, and `.test` email
  addresses. Never use real people's names, addresses or contact details.

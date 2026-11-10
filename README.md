# OpenBookings

**An open-source booking engine and marketplace for European hotels.**

OpenBookings gives professionally run hotels a booking engine of their own: rooms, rates and
availability, a guest checkout with Stripe, reservations, guest messaging, reviews and monthly
commission invoices. It is built for the EU. Prices are in euros, rates include tax, and VAT,
ICP and DAC7 reporting are built in.

The code is free to use, self-host and change. The hosted service at
[openbookings.co](https://openbookings.co) runs the same code.

> **Status:** pre-release (`0.x`). The booking flow works end to end in test mode, but
> interfaces, the database schema and configuration can still change without notice.
> See the [changelog](./CHANGELOG.md).

## What's in the repository

A [Turborepo](https://turborepo.com) monorepo, run with [Bun](https://bun.sh).

| Path | What it is | Local port |
| --- | --- | --- |
| `apps/web` | The guest site: search, property pages, checkout, guest account | 3002 |
| `apps/business` | The host dashboard: property, rooms, rates, reservations, payouts | 3001 |
| `apps/docs` | The documentation site ([Fumadocs](https://fumadocs.dev)) | 3004 |
| `apps/admin` | An internal admin console, for local use only and never deployed | 3005 |
| `apps/support-bot` | The support assistant behind the Chatwoot inboxes | 3003 |
| `apps/invoice-job` | The monthly commission-invoice job (a Bun CLI) | — |
| `packages/*` | Shared code: `db`, `auth`, `authz`, `billing`, `pricing`, `stripe`, `mailing`, `messaging`, … | — |
| `testing/` | A local Postgres, a schema snapshot and seed data for trying the apps | 5433 |

## Quick start

You need [Bun](https://bun.sh) 1.3, Node.js 22.20 or newer, and Docker.

```bash
git clone https://github.com/OpenBookings/OpenBookings.git
cd OpenBookings
bun install

# A local Postgres with PostGIS, the schema and seed data
bun run testing:db
bun run testing:setup

# Environment: copy each example and fill in what you need
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local
cp apps/business/.env.example apps/business/.env.local
# then set a BETTER_AUTH_SECRET in each app (openssl rand -base64 32)

bunx turbo run dev --filter=@openbookings/web --filter=@openbookings/business
```

Then open <http://web.localhost:3002> (guest site) and <http://business.localhost:3001>
(host dashboard). The seeded accounts are listed in [`testing/README.md`](./testing/README.md).

The full walkthrough is in the docs:
[Self-hosting → Tutorials → Run OpenBookings locally](./apps/docs/content/docs/self-hosted/tutorials/run-locally.mdx).

## Common commands

```bash
bun run dev         # every app in watch mode
bun run build       # build everything
bun run lint        # lint everything
bun run typecheck   # type-check everything
bun run test        # every test suite (DB suites need DATABASE_URL)
```

## Documentation

- **Running and self-hosting OpenBookings:** `apps/docs/content/docs/self-hosted`, organised as
  tutorials, how-to guides, reference and explanation.
- **Using OpenBookings as a hotel:** `apps/docs/content/docs/business`.
- **The database package:** [`packages/db/README.md`](./packages/db/README.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first. In short:

- every commit carries a `Signed-off-by` line ([DCO](./DCO)), and
- you sign the [Contributor License Agreement](./CLA.md) once, on your first pull request.

Everyone taking part is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
How decisions are made is described in [GOVERNANCE.md](./GOVERNANCE.md).

## Security

Please don't report vulnerabilities in public issues. See [SECURITY.md](./SECURITY.md).

## License

OpenBookings is licensed under the [GNU Affero General Public License v3.0](./LICENSE)
(`AGPL-3.0-only`). You can use, change and self-host it freely. If you run a **modified** version
as a service for others, you must offer those users the source code of your version, under the
same license. Third-party notices are in [NOTICE.md](./NOTICE.md).

## Trademarks

The code is open source; the OpenBookings name and logo are not. Forks must use their own name
and branding. See [TRADEMARKS.md](./TRADEMARKS.md).

# @openbookings/db

Postgres access for every app in the monorepo: the shared pool, the Drizzle
client, the schema, and the support-bot's read helpers.

## Connections

Two pools exist per process, against the same database:

| Pool | Owner | Default max | Env override |
| --- | --- | --- | --- |
| Application | `src/index.ts` | 10 | `PGPOOL_MAX` |
| Better Auth | `packages/auth/src/server.ts` | 5 | `AUTH_PGPOOL_MAX` |

So a deployment holds roughly `instances × 15` connections, before drizzle-kit
or a seed script adds its own. Check that against the compute's connection
limit before raising instance count — Neon's ceiling depends on compute size,
and exhausting it fails requests rather than queueing them. If instance count
has to grow past what the ceiling allows, the answer is a pooler (Neon's
`-pooler` host) rather than a smaller `max`.

Both pools set `statement_timeout` and `idle_in_transaction_session_timeout`
(`PG_STATEMENT_TIMEOUT_MS` / `PG_IDLE_TX_TIMEOUT_MS`, 15s each), so one slow or
stuck query cannot hold a connection indefinitely, and both attach an `error`
listener — a pool without one turns a dropped idle connection into an uncaught
exception and takes the process down.

`ENV_TYPE=dev` switches the connection string to `DEV_DATABASE_URL`; everything
else reads `DATABASE_URL`. TLS comes from the connection string (`sslmode=require`
on the URL Neon issues); a production URL without it logs an error at boot.

## Authorization

**There is no row-level security.** No table has RLS enabled, no policies
exist, and every app connects as `neondb_owner` — which holds `BYPASSRLS`, so
policies added today would not apply to the application anyway. Tenant
isolation is entirely application-level, and its single choke point is
`@openbookings/authz`: `userOwnsProperty`, `userOwnsRoom`, `userOwnsRatePlan`,
`getThreadForParticipant`, `getHostScopedDb`.

The practical rule that follows: **no endpoint writes its own ownership SQL.**
A query that filters on an id taken from the request, without going through
authz or `getHostScopedDb`, is a cross-tenant read waiting to happen — there is
no second layer underneath it to catch the mistake.

Adding real RLS is a two-part change and neither half works alone: a
least-privilege role for the apps (no `BYPASSRLS`, no table ownership), and
per-table policies keyed off a request-scoped `set_config`. Until both exist,
treat the authz package as load-bearing.

## Migrations

Migrations in `drizzle/` are **applied by hand** (psql or the Neon SQL editor).
There is no `meta/_journal.json`, so `drizzle-kit migrate` does not track these
files and must not be used to apply them. Every file is written to be
idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) so re-running one is a
no-op.

`0000`–`0005` predate the repo and exist only in the database.

**`db:push` is dangerous here.** It diffs `src/schema.ts` against the live
database and offers to drop whatever the schema does not declare. The database
contains tables this schema does not describe — `audit_log`, `property_access`,
`property_content`, `property_highlights`, `icons`, `org_profile`,
`org_consent`, `team`, `teamMember`, plus Better Auth's own (`user`, `session`,
`account`, `verification`, `organization`, `member`, `invitation`, `passkey`,
`twoFactor`) — and pushing against it will propose dropping them. Declare a
table here before touching push, or use `db:generate` and apply the SQL by hand.

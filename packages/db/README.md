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

The application pool keeps idle connections for 4 minutes (`PGPOOL_IDLE_TIMEOUT_MS`),
not pg's default 10s: a fresh connection to Neon costs 100–900ms, and a 10s
reap meant a quiet site paid that on almost every request. Four minutes is
below Neon's 5-minute scale-to-zero, so idle connections are closed before the
compute suspends. On the `-pooler` endpoint idle clients are cheap; against a
direct (non-pooled) URL each one holds a real Postgres backend for that long,
so lower it there if connection count is tight.

Both pools set `statement_timeout` and `idle_in_transaction_session_timeout`
(`PG_STATEMENT_TIMEOUT_MS` / `PG_IDLE_TX_TIMEOUT_MS`, 15s each), so one slow or
stuck query cannot hold a connection indefinitely, and both attach an `error`
listener — a pool without one turns a dropped idle connection into an uncaught
exception and takes the process down.

`ENV_TYPE=dev` switches the connection string to `DEV_DATABASE_URL`; everything
else reads `DATABASE_URL`. TLS comes from the connection string (`sslmode=require`
on the URL Neon issues); a production URL without it logs an error at boot.

## Authorization

The first layer is `@openbookings/authz`: `userCan`, `userOwnsProperty`,
`userOwnsRoom`, `userOwnsRatePlan`, `getThreadForParticipant`,
`getHostScopedDb`. **No endpoint writes its own ownership SQL.** A query that
filters on an id taken from the request goes through one of these.

The second layer is row-level security on the guest-data tables
(`drizzle/0049_rls_guest_data.sql`): bookings and everything hanging off
them, checkout holds, guest profiles, messages, reviews, and the login tables.
A host sees only rows at properties they may read, a guest only their own.
The rule mirrors `propertyReadAccessSql`; `packages/authz/src/rls.db.test.ts`
checks the two agree for every role.

**It is not active yet.** Every app still connects as `neondb_owner`, which
owns the tables and holds `BYPASSRLS`, so the policies do not apply to it.
They apply once an app connects as one of the roles 0049 creates:

| Role           | For                                                    | RLS      |
| -------------- | ------------------------------------------------------ | -------- |
| `ob_web`       | guest site (member of `ob_app`)                        | enforced |
| `ob_business`  | host dashboard (member of `ob_app`)                    | enforced |
| `ob_auth`      | Better Auth's pool and hooks                           | bypassed |
| `ob_system`    | Stripe webhooks, crons, invoice job, support bot, mail | bypassed |
| `neondb_owner` | migrations only                                        | bypassed |

The roles are created without LOGIN; give one a password by hand
(`ALTER ROLE ob_web LOGIN PASSWORD '…'`), never in a migration. App roles
cannot read password hashes, session tokens or 2FA secrets, and only read the
invoicing tables.

Switching an app over needs each request wrapped in a transaction that starts
with `SELECT set_config('app.user_id', $1, true)` (plus
`set_config('app.testing', 'on', true)` in testing mode). Transaction-local
matters: the Neon pooler shares server connections between clients. Without
it, policies match nothing and queries return no rows. Availability must read
other guests' rooms through `app.room_units_taken(...)` (counts only) rather
than joining `reservations` / `booking_intent_rooms` as a guest.

A table added by a later migration is not granted to any app role until that
migration grants it: there are deliberately no default privileges.

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
`org_consent`, `invitation_property_access`, `team`, `teamMember`, plus Better Auth's own (`user`, `session`,
`account`, `verification`, `organization`, `member`, `invitation`, `passkey`,
`twoFactor`) — and pushing against it will propose dropping them. Declare a
table here before touching push, or use `db:generate` and apply the SQL by hand.

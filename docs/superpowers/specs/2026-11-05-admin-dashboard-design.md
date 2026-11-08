# Admin dashboard (dev super-admin) — design

Date: 2026-11-05
Status: draft for review

## Why

Wouter wants to play with the demo data: find a booking, see everything that
happened to it, and push it into any state (cancel it, un-cancel it, mark a
no-show, undo that) without signing in as a guest or a host and without the
booking rules getting in the way.

It is also the first piece of a future support dashboard for OpenBookings
staff. That version is not being built now, but this one should be easy to
turn into it: the parts that will survive (search, the booking page, the
timeline, the rule-following actions) are shaped for production; the parts
that won't (the env-var gate, the forced edits) are kept in one obvious place
each.

## Decided by Wouter

- A separate app in the monorepo.
- Functional, not pretty.
- Dev only. "Super admin" mode is switched on by an env var. No login.
- In super-admin mode anything goes, including reversing a cancellation.
- Minimal. Nothing for the future yet.
- Product rule for later (not built now, recorded so it isn't lost): in
  production a cancellation is final, like Airbnb and Booking.com. No undo
  window, no held refunds. Staff never refund from a host's balance on their
  own; a refund request goes to the host, who has at most 48 hours, with an
  option to appeal.

## Goals

1. Find a booking fast.
2. See all of it on one page: guest, property, rooms, nights, money, refunds,
   messages, support tickets, and a timeline of what happened.
3. Run the real booking actions (the same code hosts and guests use), acting
   as the guest or the host.
4. Force any state, ignoring the rules, for playing with demo data.

## Non-goals

- Staff accounts, roles, login. (Production work, later.)
- Refund requests to hosts, appeals, emails. (Production work, later.)
- Editing properties, rooms, rates, users.
- Deploying the app anywhere. No Dockerfile, not in CI deploys.
- Design polish.

## Anti-goals

- The app, or its forced edits, being reachable in production. This would be
  a failure even if everything else works.
- Forced edits quietly calling Stripe. Forced edits touch the database only.
- A second copy of the booking rules. Rule-following actions call
  `@openbookings/db/booking-lifecycle`, nothing else.

## Shape

### The app

- `apps/admin`, Next.js (same version and setup as `apps/business`), port
  **3005** (3001–3004 are taken). shadcn/ui with the default theme, only the
  components it needs (table, input, button, select, badge, dialog, card).
- No Sentry, no PostHog, no auth packages.
- Reads the database through `@openbookings/db` like the other apps, with the
  same `.env.local`.

### The gate (the one place that changes for production)

- `lib/super-admin.ts` exports `requireSuperAdmin()`. It passes only when
  `ADMIN_SUPER_MODE=1` **and** `NODE_ENV === "development"` (i.e. `next dev`).
  Otherwise it throws.
- `proxy.ts` calls the same check and answers every request with a plain 404
  page when it fails, so a misconfigured deploy shows nothing.
- Every page and every server action calls `requireSuperAdmin()` first.
  Defence in depth: the proxy is not trusted alone.
- In production this function becomes `requireStaff(permission)`; call sites
  stay the same.
- A red banner on every page: "Super admin — dev only — connected to
  `<database host>`", so it is always clear which database is being changed.

### Pages

**`/` — search**

- One search box. It matches, in this order: booking id, reservation id
  (exact uuid), Stripe payment intent id (exact), guest email (exact or
  prefix), guest name (contains), property name (contains).
- Filters: status (any `booking_status`), check-in date range, property.
- Results table, newest first, 50 rows: booking id (short), guest, property,
  check-in → check-out, rooms, status, total. Row links to the booking page.
- Empty search shows the 50 most recent bookings.

**`/bookings/[id]` — the booking**

Sections, top to bottom:

1. Header: status badge, booking id (copyable), guest name and email,
   property, dates, total, booking fee, Stripe payment intent id.
2. Rooms: one row per reservation — room, rate plan, guests, nights, price
   per night, total, tourist tax, cancellation tier, free-cancellation
   deadline, cancelled at.
3. Money: transactions (type, amount, status, provider id) and refunds
   (reason, amount, status, Stripe refund id, created by, created at).
   Totals: paid, refunded, still pending or failed.
4. Timeline (see below).
5. Messages: the booking's thread, read-only.
6. Support tickets linked to the booking (`support_tickets` where
   `linked_type = 'booking'` and `linked_id` is the booking id), read-only:
   title, category, status, Chatwoot conversation id, last activity.
7. Actions (see below).
8. Raw data: the booking, reservation and refund rows as JSON, collapsed.
   Useful when playing.

### The timeline

A new table, `booking_events`:

| column | type | note |
|---|---|---|
| id | uuid pk | |
| booking_id | uuid fk → bookings | indexed with created_at |
| reservation_id | uuid fk → reservations, nullable | when the event is about one room |
| kind | text | e.g. `confirmed`, `rooms_cancelled`, `checked_in`, `no_show`, `early_departure`, `goodwill_refund`, `refund_succeeded`, `refund_failed`, `forced_status`, `forced_uncancel`, … |
| actor_kind | text | `guest`, `host`, `system`, `admin` |
| actor_id | text, nullable | user id; for admin, the fixed id `dev-super-admin` |
| reason | text, nullable | |
| data | jsonb | before/after values, amounts, anything useful |
| created_at | timestamptz | |

Written by:

- Every action in `booking-lifecycle` (cancel, check in, no-show, early
  departure, goodwill, refund sent/failed), inside the same transaction as the
  change. These are one insert each. This is the part that also serves
  production, for hosts and guests as much as for staff.
- Booking confirmation (`confirmBookingPolicy`).
- Every forced edit in the admin app.

Bookings from before the table (all the demo data) have no events. For those,
the timeline also shows entries rebuilt from what the rows already hold
(created, confirmed, each room's cancelled_at, no-show reported, each refund
and transaction), marked "reconstructed". Rebuilt entries are computed at read
time, never written.

### Actions

Two groups, visibly separated.

**Real actions** — call `booking-lifecycle` exactly as the business app does
(same `deps`, so Stripe refunds really go out in Stripe test mode when the
booking has a payment intent and a connected account; the demo bookings mostly
don't, so their refunds stay `pending`, which is the module's existing
behaviour).

- An "Act as: guest / host" switch. The actor passed in is the booking's
  real guest (`bookings.user_id`), or for host the property's
  `owner_user_id`; if that is NULL, host actions are disabled with a note
  saying so. Guest name and email come from the Better Auth `"user"` table,
  joined on `bookings.user_id`, as the business app's reservations query
  does. The admin app skips `userCan` (there is no session); the lifecycle
  module trusts the actor it is given, as it already does. The event row
  gets `data.via = "admin"` so it's clear who really pressed it.
- Only the actions `allowedActions` returns for that actor right now are
  enabled: cancel rooms (pick rooms, see `previewRefund` first), check in,
  no-show, early departure (pick last night stayed), goodwill refund (host
  only, amount), retry refunds.
- Errors from the module (`not_allowed`, `nothing_to_refund`, …) are shown
  as-is.

**Forced edits** — database only, never Stripe, ignore every rule. Each asks
for an optional reason and writes a `booking_events` row with before/after.

- Set booking status to any value.
- Un-cancel rooms: clear `cancelled_at` on chosen reservations; if the booking
  was `cancelled`, set it back to `confirmed` and clear `cancelled_at` and
  `cancellation_reason`. Refund rows are left alone unless the next option is
  used.
- Cancel rooms without refunds: set `cancelled_at`, and `cancelled` on the
  booking if every room is.
- Delete a refund row.
- Set a refund row's status (to test the pending/failed/retry screens).
- Clear `no_show_reported_at` / `departed_early_on`.

All forced edits live in one file, `lib/forced-edits.ts`, so they can be
dropped or locked behind an owner-only permission later.

## Constraints

- EUR only, EU only (existing rule). Amounts shown as the business app shows
  them (`bigint` columns are whole euros; refunds are `numeric`).
- Server actions and pages run on the server; no database access from the
  browser.
- New table goes in through a normal Drizzle migration in `packages/db`.
- Tests: the gate (`requireSuperAdmin` passes/fails on the env combinations),
  the search matcher, the reconstructed timeline, each forced edit against the
  existing DB test harness, and one test per lifecycle action that it writes
  its event.

## Left to the builder

- Exact layout, component choice, table vs list in each section.
- How search decides which field a query is (uuid shape, `pi_` prefix, `@`).
- Event `kind` names beyond the ones listed, and what goes in `data`.

## My calls (Claude), for Wouter to check

1. Port 3005, app name `apps/admin`.
2. The gate needs both `ADMIN_SUPER_MODE=1` and `next dev`, not the env var
   alone, so `next start` can never enable it.
3. A new `booking_events` table, written by the lifecycle module too (small
   change to shared code), instead of a timeline rebuilt only from existing
   columns. Rebuilt-only can't show check-ins, who did what, or forced edits.
4. Real actions use the real Stripe deps (test mode), forced edits never touch
   Stripe.
5. "Act as guest / host" instead of a new `admin` actor kind in the lifecycle
   module, so the module's rules don't change.

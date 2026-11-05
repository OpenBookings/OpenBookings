# Admin Dashboard (dev super-admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only `apps/admin` Next.js app to find any booking, see everything about it including a timeline, run the real booking actions as guest or host, and force any state on demo data.

**Architecture:** A new `booking_events` table in `@openbookings/db`, written by the booking-lifecycle module, by booking confirmation and by the admin app. The admin app is server-rendered pages plus server actions. Every entry point goes through one gate, `requireSuperAdmin()`, which later becomes staff auth. Real actions call `@openbookings/db/booking-lifecycle`. Forced edits are plain SQL in one file and never call Stripe.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Tailwind 4, shadcn/ui, `pg` via `@openbookings/db`, bun test.

**Spec:** `docs/superpowers/specs/2026-11-05-admin-dashboard-design.md`

## Global Constraints

- App lives at `apps/admin`, package name `@openbookings/admin`, dev port **3005**.
- Super-admin mode is on only when `ADMIN_SUPER_MODE === "1"` **and** `NODE_ENV === "development"`.
- Every page and every server action calls `requireSuperAdmin()` first; `proxy.ts` also returns a plain 404 when the gate is off.
- A red banner on every page: `Super admin — dev only — connected to <database host>`.
- The admin actor is `{ kind: "admin", id: "dev-super-admin" }`.
- Forced edits touch the database only, never Stripe. Real actions use the same Stripe deps as `apps/business/lib/reservations/actions.ts`.
- No Sentry, no PostHog, no auth packages, no Dockerfile, no CI deploy entry.
- EUR only. `bookings`/`reservations` `bigint` money columns are whole euros; `refunds` amounts are `numeric` euros.
- Migrations are hand-written SQL in `packages/db/drizzle/`, additive, idempotent (`IF NOT EXISTS`), and mirrored in `packages/db/src/schema.ts`.
- `apps/admin` is a Next.js version with breaking changes: read `apps/admin/node_modules/next/dist/docs/` (or the root `node_modules/next/dist/docs/`) for `proxy.ts`, async `params`/`searchParams` and server actions before writing them.

## Review Focus

1. **Search text with SQL wildcard or quote characters** (`%`, `_`, `'`, `\`): treated as literal text, no error, no match-everything. Test in Task 4.
2. **A booking URL whose id is not a uuid, or doesn't exist:** renders the 404 page, not a 500. Test in Task 5.
3. **Un-cancelling one room of a two-room booking that is still `confirmed`:** only that room's `cancelled_at` is cleared and the booking status is unchanged. Test in Task 7.
4. **"Act as host" when the property's `owner_user_id` is NULL:** no actor, host actions disabled with a note, no crash. Test in Task 6.
5. **Gate values that look "on" but aren't** (`ADMIN_SUPER_MODE="true"`, `" 1"`, `"0"`, unset, or `NODE_ENV="production"` with `"1"`): disabled. Test in Task 3.

---

### Task 1: `booking_events` table and helpers

**Files:**
- Create: `packages/db/drizzle/0032_booking_events.sql`
- Modify: `packages/db/src/schema.ts` (add `bookingEvents` after `transactions`)
- Create: `packages/db/src/booking-events.ts`
- Modify: `packages/db/src/index.ts` (add `export * from "./booking-events";` next to the other `export *` lines)
- Modify: `packages/db/src/testing/db-harness.ts` (`PENDING = ["0032_booking_events.sql"]`)
- Modify: `packages/db/package.json` exports: add `"./testing": "./src/testing/db-harness.ts"`
- Test: `packages/db/src/booking-events.db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BookingEventKind =
    | "confirmed" | "rooms_cancelled" | "checked_in" | "no_show" | "early_departure"
    | "goodwill_refund" | "refund_succeeded" | "refund_failed" | "refund_uncertain"
    | "forced_status" | "forced_uncancel" | "forced_cancel" | "forced_refund_deleted"
    | "forced_refund_status" | "forced_markers_cleared";
  export type BookingEventActor = { kind: "guest" | "host" | "system" | "admin"; id: string | null };
  export type NewBookingEvent = {
    bookingId: string; reservationId?: string | null; kind: BookingEventKind;
    actor: BookingEventActor; reason?: string | null; data?: Record<string, unknown>;
  };
  export type BookingEvent = {
    id: string; bookingId: string; reservationId: string | null; kind: BookingEventKind;
    actorKind: BookingEventActor["kind"]; actorId: string | null; reason: string | null;
    data: Record<string, unknown>; createdAt: Date;
  };
  export async function recordBookingEvent(db: Queryable, e: NewBookingEvent): Promise<void>;
  /** Oldest first (created_at, id). */
  export async function loadBookingEvents(db: Queryable, bookingId: string): Promise<BookingEvent[]>;
  export const ADMIN_ACTOR: BookingEventActor; // { kind: "admin", id: "dev-super-admin" }
  ```
  `Queryable` comes from `./reservation-policy`.

- [ ] **Step 1: Write the migration** `0032_booking_events.sql`, with a header comment in the style of `0031`. It creates `booking_events` with the columns in the spec's table: `booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE`, `reservation_id uuid NULL REFERENCES reservations(id) ON DELETE SET NULL`, `kind text NOT NULL`, `actor_kind text NOT NULL CHECK (actor_kind IN ('guest','host','system','admin'))`, `actor_id text NULL`, `reason text NULL`, `data jsonb NOT NULL DEFAULT '{}'::jsonb`, `created_at timestamptz NOT NULL DEFAULT now()`, plus `CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events (booking_id, created_at)`. Mirror it in `schema.ts` as `bookingEvents`.

- [ ] **Step 2: Write the failing test** `booking-events.db.test.ts`, using `describeWithDb`, `applyPendingMigrations`, `seedProperty` and `seedBooking`, with each test inside `BEGIN … ROLLBACK` like `lifecycle.db.test.ts`:
  - `records and loads events oldest first`: record `confirmed` (system, id null) then `no_show` (host, `"h1"`, reason `"test"`, data `{ a: 1 }`). `loadBookingEvents` returns two events in that order, the second with `actorKind: "host"`, `actorId: "h1"`, `reason: "test"`, `data: { a: 1 }`, `reservationId: null`.
  - `loads nothing for a booking without events`: returns `[]`.
  - `rejects an unknown actor kind`: a raw `INSERT` with `actor_kind = 'robot'` throws.

- [ ] **Step 3: Run it to verify it fails**
  Run: `cd packages/db && bun --env-file=../../.env.local test src/booking-events.db.test.ts`
  Expected: FAIL (module `./booking-events` not found).

- [ ] **Step 4: Implement `booking-events.ts`** with the signatures above. JSON-encode `data` with `$n::jsonb`, defaulting to `{}`.

- [ ] **Step 5: Run the test to verify it passes** (same command). Expected: 3 pass. If the output says the suite was skipped, `DATABASE_URL` is missing: stop and say so, don't report a pass.

- [ ] **Step 6: Commit**
  `git add packages/db && git commit -m "Add booking_events table"`

---

### Task 2: Lifecycle and confirmation write events

**Files:**
- Modify: `packages/db/src/booking-lifecycle/index.ts`
- Modify: `packages/db/src/reservation-policy.ts` (`confirmBookingPolicy`)
- Test: `packages/db/src/booking-lifecycle/lifecycle.db.test.ts` (add tests)

**Interfaces:**
- Consumes: `recordBookingEvent`, `BookingEventKind` (Task 1).
- Produces: `Actor` becomes `{ kind: "guest" | "host"; userId: string; via?: "admin" }`. When `via` is set, every event that action writes has `data.via = "admin"`.

Events written. All lifecycle events use `actor = { kind: i.actor.kind, id: i.actor.userId }`, except refund outcomes, which use `{ kind: "system", id: null }`.

| Where | kind | reservation_id | data |
|---|---|---|---|
| `cancelRooms`, inside the transaction after the updates | `rooms_cancelled` | the room's id when exactly one room is cancelled, else null | `{ reservationIds, cancelsBooking, refundTotal }` (euros) |
| `markCheckedIn` | `checked_in` | null | `{}` |
| `markNoShow` | `no_show` | null | `{}` |
| `recordEarlyDeparture`, in the transaction | `early_departure` | null | `{ lastNightStayed }` |
| `issueGoodwillRefund`, in the transaction | `goodwill_refund` | null | `{ requested, amount }` |
| `sendRefunds`, after each row's outcome | `refund_succeeded` / `refund_failed` / `refund_uncertain` (for `pending`) | the row's `reservationId` | `{ refundId, amount, stripeRefundId? , error? }` |
| `confirmBookingPolicy`, only when its `UPDATE bookings … WHERE status = 'pending'` changed a row (add `RETURNING id`) | `confirmed` | null | `{}`, actor system |

`setStatus` needs the event kind: add a parameter `kind: BookingEventKind`. A booking with no payment intent or no connected account makes `sendRefunds` push `pending` without trying Stripe. Write no event in that case: nothing happened.

- [ ] **Step 1: Write the failing tests** in `lifecycle.db.test.ts`, reusing its fixtures (`deps()`, `guest`, `host`, the confirmed seeded booking):
  - `cancel writes rooms_cancelled and refund_succeeded`: guest cancels all rooms. The events are `rooms_cancelled` (actorKind `guest`, `data.cancelsBooking === true`) followed by one `refund_succeeded` per refunded room (actorKind `system`).
  - `no-show writes no_show with via admin`: `markNoShow(deps(afterCheckInCloses), { bookingId, actor: { ...host, via: "admin" } })`. One `no_show` event, `data.via === "admin"`. Pick the `now` the existing no-show test uses.
  - `a refused action writes nothing`: guest `markNoShow` returns `not_allowed` and there are no events.
  - `confirming writes confirmed once`: calling `confirmBookingPolicy` twice gives exactly one `confirmed` event.

- [ ] **Step 2: Run them to verify they fail**
  Run: `cd packages/db && bun --env-file=../../.env.local test src/booking-lifecycle/lifecycle.db.test.ts`
  Expected: the 4 new tests FAIL, the existing ones pass.

- [ ] **Step 3: Add the event writes** from the table above.

- [ ] **Step 4: Run the whole package suite**
  Run: `cd packages/db && bun --env-file=../../.env.local test && bun run typecheck`
  Expected: all pass, no type errors.

- [ ] **Step 5: Typecheck the apps that call the lifecycle**
  Run: `bunx turbo run typecheck --filter=@openbookings/business --filter=@openbookings/web`
  Expected: pass. Making `Actor.via` optional means no caller changes.

- [ ] **Step 6: Commit**
  `git commit -am "Record booking events from lifecycle actions"`

---

### Task 3: Scaffold `apps/admin` with the gate

**Files:**
- Create: `apps/admin/package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`. Copy each from `apps/business` and strip Sentry, PostHog, images, CSP and maplibre.
- Create (via shadcn CLI): `apps/admin/components.json`, `app/globals.css`, `lib/utils.ts`, `components/ui/*`
- Create: `apps/admin/lib/super-admin.ts`, `apps/admin/proxy.ts`, `apps/admin/app/layout.tsx`, `apps/admin/app/not-found.tsx`
- Create: `apps/admin/.env.local` (not committed; `.env*` is gitignored)
- Test: `apps/admin/lib/super-admin.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function isSuperAdminEnabled(env?: { ADMIN_SUPER_MODE?: string; NODE_ENV?: string }): boolean; // defaults to process.env
  export class SuperAdminDisabledError extends Error {}
  export function requireSuperAdmin(): void; // throws SuperAdminDisabledError
  export function databaseHost(url: string | undefined): string; // "ep-xyz.eu-central-1.aws.neon.tech", or "unknown"
  ```

- [ ] **Step 1: Write `package.json`.** Name `@openbookings/admin`. Scripts: `dev: "next dev -p 3005"`, `build: "next build"`, `start: "next start -p 3005"`, `lint: "eslint"`, `test: "bun test"`, `typecheck: "next typegen && tsc --noEmit"`. Dependencies use the same versions as `apps/business/package.json`: `@openbookings/db`, `@openbookings/pricing`, `@openbookings/stripe` (all `workspace:*`), `next`, `react`, `react-dom`, `pg`, `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. devDependencies: `@openbookings/config`, `@tailwindcss/postcss`, `tailwindcss`, `tw-animate-css`, `@types/bun`, `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`, `eslint`, `eslint-config-next`, `typescript`. Run `bun install` at the repo root.

- [ ] **Step 2: Add shadcn.** In `apps/admin`, run `bunx --bun shadcn@latest init --defaults`, then `bunx --bun shadcn@latest add button input table badge card select checkbox textarea label separator`. Keep the default neutral theme.

- [ ] **Step 3: Write the failing test** `super-admin.test.ts`:
  - `on only with "1" in development`: `isSuperAdminEnabled({ ADMIN_SUPER_MODE: "1", NODE_ENV: "development" })` is `true`.
  - `off for look-alike values`: `"true"`, `" 1"`, `"0"`, `""` and `undefined` with `development` are all `false`.
  - `off in production and test`: `"1"` with `NODE_ENV` `"production"` or `"test"` is `false`.
  - `databaseHost`: `postgres://u:p@ep-x.neon.tech/db?sslmode=require` gives `"ep-x.neon.tech"`; `undefined` and `"not a url"` give `"unknown"`.

- [ ] **Step 4: Run it to verify it fails**
  Run: `cd apps/admin && bun test lib/super-admin.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 5: Implement `super-admin.ts`** with the exact rule from Global Constraints.

- [ ] **Step 6: Write `proxy.ts`.** It exports `proxy(request)`, which returns `new NextResponse("Not found", { status: 404 })` when `!isSuperAdminEnabled()` and `NextResponse.next()` otherwise. Match all paths except `_next/static`, `_next/image` and `favicon.ico`. Check `proxy` and `config` against the Next docs and `apps/business/proxy.ts`.

- [ ] **Step 7: Write `layout.tsx` and `not-found.tsx`.** The layout calls `requireSuperAdmin()`, then renders the banner (`bg-red-600 text-white`, text exactly `Super admin — dev only — connected to {databaseHost(process.env.DATABASE_URL)}`), a header link "Bookings" to `/`, and `{children}`. Use the system font: no `next/font`.

- [ ] **Step 8: Create `apps/admin/.env.local`.** Run `grep -E '^(DATABASE_URL|DATABASE_URL_DIRECT|STRIPE_SECRET_KEY)=' apps/business/.env.local > apps/admin/.env.local && echo 'ADMIN_SUPER_MODE=1' >> apps/admin/.env.local`. Never print the file's contents.

- [ ] **Step 9: Verify**
  Run: `cd apps/admin && bun test && bun run typecheck && bun run lint`
  Expected: all pass.
  Then run `bun run dev` in the background and check `curl -s -o /dev/null -w '%{http_code}' localhost:3005/`. It should return `200` and the HTML should contain `Super admin`. Stop the server, restart it with `ADMIN_SUPER_MODE=0 bun run dev`, and the same curl should return `404`.

- [ ] **Step 10: Commit**
  `git add apps/admin bun.lock && git commit -m "Scaffold admin app behind dev super-admin gate"`

---

### Task 4: Search page

**Files:**
- Create: `apps/admin/lib/search.ts`
- Create: `apps/admin/app/page.tsx`
- Test: `apps/admin/lib/search.test.ts`, `apps/admin/lib/search.db.test.ts`

**Interfaces:**
- Consumes: `requireSuperAdmin` (Task 3), `getPool` / `Queryable` from `@openbookings/db`, the harness from `@openbookings/db/testing`.
- Produces:
  ```ts
  export type QueryKind = "empty" | "uuid" | "payment_intent" | "email" | "text";
  export function classifyQuery(q: string): { kind: QueryKind; value: string }; // value is trimmed
  export type SearchInput = { q: string; status?: string; property?: string; from?: string; to?: string }; // from/to: check-in date range, YYYY-MM-DD
  export type BookingSearchRow = {
    id: string; guestName: string | null; guestEmail: string | null; propertyName: string;
    checkIn: string; checkOut: string; rooms: number; status: string; totalAmount: number; createdAt: Date;
  };
  export async function searchBookings(db: Queryable, input: SearchInput): Promise<BookingSearchRow[]>; // max 50, newest created first
  ```

Classification: `uuid` = 36-char hex-and-dash uuid shape; `payment_intent` = starts with `pi_`; `email` = contains `@`; otherwise `text`; blank = `empty`.

Matching per kind:
- `uuid`: `b.id = $ OR EXISTS (reservation with that id on b)`.
- `payment_intent`: `b.stripe_payment_intent_id = $`.
- `email`: `lower(u.email) LIKE lower($) || '%'` (exact or prefix).
- `text`: `u.name ILIKE '%' || $ || '%' OR p.name ILIKE …`.

Escape `\`, `%` and `_` in the value before any `LIKE`, and pass it as a parameter. `status` and the check-in range are extra `AND`s. `property` is a property id from a `<select>` of all properties ordered by name. Guest data comes from `LEFT JOIN "user" u ON u.id = b.user_id`.

- [ ] **Step 1: Write the failing unit tests** in `search.test.ts`: `classifyQuery` on `""` → empty, `"  "` → empty, a uuid → uuid, `"pi_3Abc"` → payment_intent, `"ann@x.nl"` → email, `"Saturnia"` → text, `" Saturnia "` → `{ kind: "text", value: "Saturnia" }`, and a uuid with one character missing → text.

- [ ] **Step 2: Write the failing DB tests** in `search.db.test.ts` (harness, `BEGIN … ROLLBACK`). Seed two bookings via `seedBooking` on one `seedProperty`, then:
  - `finds by booking id`, `finds by reservation id`, `finds by payment intent` (`pi_test` returns both).
  - `finds by email prefix`: the seeded guest email's first 12 characters.
  - `filters by status`: after `UPDATE` sets one to `cancelled`, `status: "cancelled"` returns one.
  - `treats wildcards literally` (Review Focus 1): `q: "%"`, `q: "_"` and `q: "'"` return `[]` (no seeded name contains them) and don't throw.

- [ ] **Step 3: Run them to verify they fail**
  Run: `cd apps/admin && bun --env-file=.env.local test lib/search`
  Expected: FAIL (module not found).

- [ ] **Step 4: Implement `search.ts`.**

- [ ] **Step 5: Run them to verify they pass** (same command). Expected: all pass, none skipped.

- [ ] **Step 6: Write `app/page.tsx`.** It's a server component: `requireSuperAdmin()`, then await `searchParams`, then `searchBookings(getPool(), …)`. A GET `<form>` holds the `q` input, a status `<select>` (blank plus every `booking_status`), a property `<select>`, and `from`/`to` date inputs. Below it, a shadcn `Table` with the spec's columns: first 8 characters of the id, guest (name, then email), property, check-in → check-out, rooms, status `Badge`, and total as `€1,234`. Each row links to `/bookings/{id}`. With no results it shows the text "No bookings match."

- [ ] **Step 7: Verify in the browser.** With the dev server running, `localhost:3005/?q=b0000000-0000-4000-8000-000000000011` lists the demo confirmed booking.

- [ ] **Step 8: Commit**
  `git add apps/admin && git commit -m "Admin: booking search"`

---

### Task 5: Booking page (read side and timeline)

**Files:**
- Create: `apps/admin/lib/booking.ts`, `apps/admin/lib/timeline.ts`
- Create: `apps/admin/app/bookings/[id]/page.tsx`
- Test: `apps/admin/lib/timeline.test.ts`, `apps/admin/lib/booking.db.test.ts`

**Interfaces:**
- Consumes: `loadBookingEvents`, `BookingEvent` (Task 1).
- Produces:
  ```ts
  export type AdminBooking = {
    booking: Record<string, unknown> & { id: string; status: string; user_id: string; created_at: Date;
      confirmed_at: Date | null; cancelled_at: Date | null; no_show_reported_at: Date | null;
      departed_early_on: string | null; hotel_id: string };
    guest: { id: string; name: string | null; email: string | null } | null;
    property: { id: string; name: string; ownerUserId: string | null; timezone: string };
    rooms: (Record<string, unknown> & { id: string; room_name: string; rate_plan_name: string; cancelled_at: Date | null })[];
    transactions: (Record<string, unknown> & { id: string; type: string; amount: number; status: string; created_at: Date })[];
    refunds: (Record<string, unknown> & { id: string; reservation_id: string | null; reason: string; amount: number; status: string; created_by: string | null; created_at: Date })[];
    messages: { id: string; sender_role: string; body: string; created_at: Date }[];
    tickets: { id: string; title: string; category: string; status: string; chatwoot_conversation_id: number; last_activity_at: Date }[];
    events: BookingEvent[];
  };
  export async function loadAdminBooking(db: Queryable, id: string): Promise<AdminBooking | null>; // null for non-uuid or missing
  export type TimelineEntry = {
    at: Date; kind: string; actorKind: string; actorId: string | null; reason: string | null;
    data: Record<string, unknown>; reservationId: string | null; reconstructed: boolean;
  };
  export function buildTimeline(b: Pick<AdminBooking, "booking" | "rooms" | "refunds" | "transactions" | "events">): TimelineEntry[]; // oldest first
  ```

Reconstructed entries, each with `reconstructed: true`, come from: `created` (`booking.created_at`, actor `guest`), `confirmed` (`confirmed_at`, system), `room_cancelled` (each room's `cancelled_at`, actor unknown, `reservationId` set), `booking_cancelled` (`booking.cancelled_at`, `reason = cancellation_reason`), `no_show` (`no_show_reported_at`), `refund_<status>` (each refund's `created_at`; actor `created_by`, or system when null), and `transaction_<type>` (each transaction's `created_at`). Rule: a booking with no stored events gets all of these. Otherwise it gets the stored events, plus `created`, plus reconstructed entries dated *before* the first stored event. Sort by `at`, then stored before reconstructed. Actor kind for reconstructed entries without a known actor is `"unknown"`.

- [ ] **Step 1: Write the failing unit tests** `timeline.test.ts`, with plain objects and no database:
  - `no events → fully reconstructed`: a booking with `created_at`, `confirmed_at`, one room cancelled and one refund gives `created, confirmed, room_cancelled, refund_succeeded` in time order, all `reconstructed: true`.
  - `with events → stored plus earlier facts only`: the same booking plus a stored `forced_uncancel` event dated after everything. Result is `created, confirmed, room_cancelled, refund_succeeded` (reconstructed) and then `forced_uncancel` (stored). Now add a stored `rooms_cancelled` event dated *at* the room's `cancelled_at`, set the first stored event to that time, and check `room_cancelled` is not duplicated: reconstructed facts at or after the first stored event are dropped.
  - `ties sort stored first`.

- [ ] **Step 2: Write the failing DB tests** `booking.db.test.ts`:
  - `returns null for a non-uuid` (Review Focus 2): `loadAdminBooking(db, "abc")` is `null`, and so is a random uuid.
  - `loads a seeded booking`: one `seedBooking` with 2 rooms gives `rooms.length === 2`, `guest.email` ending `@example.test`, `property.name === "Test Property"`, and empty `refunds`/`messages`/`tickets`/`events`.
  - `loads linked tickets only`: insert a `support_tickets` row with `linked_type = 'booking'`, `linked_id = bookingId` and one with another `linked_id`. Exactly one comes back. Fill the not-null columns: `organization_id`, a unique `chatwoot_conversation_id`, `category`, `title`.

- [ ] **Step 3: Run them to verify they fail**
  Run: `cd apps/admin && bun --env-file=.env.local test lib/timeline lib/booking`
  Expected: FAIL (modules not found).

- [ ] **Step 4: Implement `booking.ts` and `timeline.ts`.** Read rooms with the room name and rate plan name joined. Read messages through `message_threads.booking_id`, oldest first. Return refund amounts as `::float8`.

- [ ] **Step 5: Run them to verify they pass** (same command). Expected: all pass.

- [ ] **Step 6: Write `app/bookings/[id]/page.tsx`.** It calls `requireSuperAdmin()`, awaits `params`, and calls `loadAdminBooking(getPool(), id)`; `null` goes to `notFound()`. Sections in spec order:
  1. Header.
  2. Rooms table.
  3. Money: transactions table, refunds table, and totals (paid = sum of the `charge` transactions that `succeeded`; refunded = refunds that `succeeded`; pending/failed = the rest).
  4. Timeline: a list with time in the property timezone, kind, actor (`kind:id`), reason, `data` as compact JSON, and a "reconstructed" badge.
  5. Messages.
  6. Tickets.
  7. An empty `<section id="actions">` placeholder for Tasks 6–7.
  8. A `<details>` element with `JSON.stringify` of booking, rooms and refunds.

- [ ] **Step 7: Verify in the browser.** `localhost:3005/bookings/b0000000-0000-4000-8000-000000000011` renders all sections, the timeline shows reconstructed entries, and `/bookings/nope` is a 404.

- [ ] **Step 8: Commit**
  `git add apps/admin && git commit -m "Admin: booking page with timeline"`

---

### Task 6: Real actions (act as guest / host)

**Files:**
- Create: `apps/admin/lib/actor.ts`
- Create: `apps/admin/lib/real-actions.ts` (`"use server"`)
- Create: `apps/admin/app/bookings/[id]/real-actions-panel.tsx` (`"use client"`)
- Modify: `apps/admin/app/bookings/[id]/page.tsx` (render the panel in `#actions`)
- Test: `apps/admin/lib/actor.db.test.ts`

**Interfaces:**
- Consumes: `cancelRooms`, `markCheckedIn`, `markNoShow`, `recordEarlyDeparture`, `issueGoodwillRefund`, `retryRefunds`, `previewRefund`, `loadBookingState`, `Actor`, `LifecycleDeps`, `LifecycleResult` from `@openbookings/db/booking-lifecycle`; `refundPayment`, `isDefiniteRefundFailure`, `findRefundForRow` from `@openbookings/stripe`.
- Produces:
  ```ts
  // lib/actor.ts
  export type ActAs = "guest" | "host";
  export async function actorFor(db: Queryable, bookingId: string, as: ActAs): Promise<Actor | null>;
  // guest → { kind: "guest", userId: bookings.user_id, via: "admin" }
  // host  → { kind: "host", userId: properties.owner_user_id, via: "admin" }, or null when that column is NULL
  // missing or non-uuid booking → null

  // lib/real-actions.ts (each one calls requireSuperAdmin(), then actorFor, then the lifecycle, then revalidatePath(`/bookings/${bookingId}`))
  export async function allowedFor(bookingId: string, as: ActAs): Promise<{ actor: boolean; actions: BookingAction[] }>;
  export async function adminPreviewRefund(bookingId: string, reservationIds: string[] | null): ReturnType<typeof previewRefund>; // guest-cancellation preview
  export async function adminCancelRooms(bookingId: string, as: ActAs, reservationIds: string[] | null): Promise<LifecycleResult>;
  export async function adminMarkCheckedIn(bookingId: string, as: ActAs): Promise<LifecycleResult>;
  export async function adminMarkNoShow(bookingId: string, as: ActAs): Promise<LifecycleResult>;
  export async function adminRecordEarlyDeparture(bookingId: string, as: ActAs, lastNightStayed: string): Promise<LifecycleResult>;
  export async function adminGoodwillRefund(bookingId: string, amount: number): Promise<LifecycleResult>; // always as host
  export async function adminRetryRefunds(bookingId: string): Promise<LifecycleResult>;
  ```
  A missing actor returns `{ ok: false, error: "not_found" }`. `deps` is the same object shape as in `apps/business/lib/reservations/actions.ts`, but `onRefundProblem` logs with `console.error` instead of Sentry. `allowedFor` uses `loadBookingState(getPool(), bookingId, new Date(), false, as)`.

- [ ] **Step 1: Write the failing DB test** `actor.db.test.ts`:
  - `guest is the booking's user`: `actorFor(db, bookingId, "guest")` returns `{ kind: "guest", userId: <seeded guest id>, via: "admin" }`.
  - `host is the property owner`: after `UPDATE properties SET owner_user_id = <a seedGuest id>`, it returns `{ kind: "host", userId: that id, via: "admin" }`.
  - `no owner → null` (Review Focus 4): the seeded property has a NULL owner, so `"host"` gives `null`.
  - `bad id → null`: `"abc"` and a random uuid both give `null`.

- [ ] **Step 2: Run it to verify it fails**
  Run: `cd apps/admin && bun --env-file=.env.local test lib/actor`
  Expected: FAIL.

- [ ] **Step 3: Implement `actor.ts`**, then run the same command. Expected: PASS.

- [ ] **Step 4: Implement `real-actions.ts`.**

- [ ] **Step 5: Write `real-actions-panel.tsx`.** Its props are `bookingId`, `rooms: { id: string; name: string; cancelled: boolean }[]` and `initial: Record<ActAs, { actor: boolean; actions: BookingAction[] }>`; the page computes `initial` by calling `allowedFor` for both. It holds:
  - An "Act as" toggle (guest/host). When `initial[as].actor` is false, it shows "No host user on this property, so host actions are unavailable." and disables everything.
  - **Cancel rooms:** room checkboxes (active rooms only), a "Preview refund" button that shows `adminPreviewRefund`'s `total` and per-room amounts, and a "Cancel selected" button. If none are selected it cancels all (`null`).
  - **Check in** and **No-show** buttons.
  - **Early departure:** a date input plus button.
  - **Goodwill refund:** an amount input plus button, shown only when "host" is selected.
  - **Retry refunds:** a button, always enabled.
  - Each control is enabled only if its `BookingAction` is in `initial[as].actions`; retry has no `BookingAction`. Results show inline: `ok` with the refund statuses, or the error code as-is.

- [ ] **Step 6: Verify.** `cd apps/admin && bun run typecheck && bun run lint` passes. In the browser, on the demo confirmed booking, act as guest, preview, then cancel one room. The timeline gains a `rooms_cancelled` event with `data.via = "admin"`, and the refund row appears (status `pending` or `succeeded`, depending on whether the demo booking has a payment intent and connected account).

- [ ] **Step 7: Commit**
  `git add apps/admin && git commit -m "Admin: real booking actions as guest or host"`

---

### Task 7: Forced edits

**Files:**
- Create: `apps/admin/lib/forced-edits.ts` (DB logic, no `"use server"`)
- Create: `apps/admin/lib/forced-edits-actions.ts` (`"use server"` wrappers)
- Create: `apps/admin/app/bookings/[id]/forced-panel.tsx` (`"use client"`)
- Modify: `apps/admin/app/bookings/[id]/page.tsx` (render it under the real actions, inside a red-bordered box titled "Forced edits — database only, Stripe is not touched")
- Test: `apps/admin/lib/forced-edits.db.test.ts`

**Interfaces:**
- Consumes: `recordBookingEvent`, `ADMIN_ACTOR` (Task 1).
- Produces (every function runs its writes and one `recordBookingEvent` on the `tx` it is given, and returns `{ ok: true } | { ok: false; error: "not_found" | "invalid" }`):
  ```ts
  export type ForcedResult = { ok: true } | { ok: false; error: "not_found" | "invalid" };
  export async function forceStatus(tx: Queryable, i: { bookingId: string; status: string; reason?: string }): Promise<ForcedResult>;
  // invalid unless status is a booking_status value. Sets status and updated_at only. Event forced_status { from, to }.
  export async function forceUncancelRooms(tx: Queryable, i: { bookingId: string; reservationIds: string[]; reason?: string }): Promise<ForcedResult>;
  // Clears cancelled_at on those rooms (only rooms of this booking). If the booking is 'cancelled', sets it to 'confirmed'
  // and clears cancelled_at and cancellation_reason. Event forced_uncancel { reservationIds, bookingStatusFrom, bookingStatusTo }.
  export async function forceCancelRooms(tx: Queryable, i: { bookingId: string; reservationIds: string[]; reason?: string }): Promise<ForcedResult>;
  // Sets cancelled_at = now() on those rooms. If every room of the booking is now cancelled, sets status 'cancelled',
  // cancelled_at = now(), cancellation_reason = 'Cancelled by admin'. No refund rows. Event forced_cancel { reservationIds, cancelsBooking }.
  export async function forceDeleteRefund(tx: Queryable, i: { bookingId: string; refundId: string; reason?: string }): Promise<ForcedResult>;
  // Deletes the row only when it belongs to the booking. Event forced_refund_deleted { refund: <the deleted row> }.
  export async function forceRefundStatus(tx: Queryable, i: { bookingId: string; refundId: string; status: "pending" | "succeeded" | "failed"; reason?: string }): Promise<ForcedResult>;
  // Event forced_refund_status { refundId, from, to }.
  export async function forceClearMarkers(tx: Queryable, i: { bookingId: string; noShow: boolean; earlyDeparture: boolean; reason?: string }): Promise<ForcedResult>;
  // Nulls no_show_reported_at and/or departed_early_on. Event forced_markers_cleared { noShow, earlyDeparture }.
  ```
  `forced-edits-actions.ts` exports one `"use server"` wrapper per function, named with an `admin` prefix (`adminForceStatus` and so on), taking the same `i`. Each one calls `requireSuperAdmin()`, runs the function inside `withTransaction` from `@openbookings/db`, and calls `revalidatePath`. Passing an empty `reservationIds` returns `invalid`. Lock the booking with `SELECT … FOR UPDATE` first; when it's missing, return `not_found`.

- [ ] **Step 1: Write the failing DB tests** `forced-edits.db.test.ts`. Seed a 2-room booking, confirmed via `confirmBookingPolicy`, then:
  - `forceStatus sets any status and logs from/to`: `checked_in` → event `{ from: "confirmed", to: "checked_in" }`, actor `admin`/`dev-super-admin`. `"bogus"` → `invalid`.
  - `forceCancelRooms both rooms cancels the booking`: status `cancelled`, `cancellation_reason = 'Cancelled by admin'`, and zero refund rows.
  - `forceUncancelRooms restores a cancelled booking`: after the above, un-cancelling both rooms gives status `confirmed`, `cancelled_at` null, `cancellation_reason` null.
  - `uncancel one room of a confirmed booking leaves status alone` (Review Focus 3): force-cancel room 1 only (booking stays `confirmed`), then un-cancel room 1. Room 1's `cancelled_at` is null and the status is still `confirmed`.
  - `ignores rooms of another booking`: un-cancelling with a reservation id from a second booking leaves that room untouched.
  - `forceDeleteRefund` and `forceRefundStatus`: seed a refund row by hand (`INSERT INTO refunds … idempotency_key = 'test:'||gen_random_uuid()`). Delete removes it and records the row in event data. Status `failed` → event `{ from: "pending", to: "failed" }`. A refund id belonging to another booking → `not_found`.
  - `forceClearMarkers`: after setting `no_show_reported_at = now()`, clearing `noShow` nulls it.
  - `missing booking → not_found` for `forceStatus` with a random uuid.

- [ ] **Step 2: Run them to verify they fail**
  Run: `cd apps/admin && bun --env-file=.env.local test lib/forced-edits`
  Expected: FAIL.

- [ ] **Step 3: Implement `forced-edits.ts`.** Run the same command. Expected: all pass.

- [ ] **Step 4: Implement `forced-edits-actions.ts` and `forced-panel.tsx`.** The panel has: a status `<select>` (every `booking_status`) plus "Set"; room checkboxes with "Un-cancel" and "Cancel (no refund)"; per refund row, "Delete" and a status `<select>`; checkboxes for "no-show marker" and "early departure" plus "Clear"; and one shared optional "Reason" textarea used by every button. Show results inline.

- [ ] **Step 5: Verify.** `cd apps/admin && bun test && bun run typecheck && bun run lint` passes. In the browser, on the room cancelled in Task 6, "Un-cancel" brings the booking back to `confirmed`, and the timeline shows `forced_uncancel`.

- [ ] **Step 6: Commit**
  `git add apps/admin && git commit -m "Admin: forced edits for demo data"`

---

### Task 8: Apply the migration to the dev database and verify the whole repo

**Files:** none new.

- [ ] **Step 1: Ask Wouter before touching a database.** Show him the host from `databaseHost(DATABASE_URL_DIRECT)` in `apps/admin/.env.local` and ask him to confirm it is the dev database. Do not continue without a yes.

- [ ] **Step 2: Apply the migration**
  Run: `psql "$(grep '^DATABASE_URL_DIRECT=' apps/admin/.env.local | cut -d= -f2-)" -v ON_ERROR_STOP=1 -f packages/db/drizzle/0032_booking_events.sql`
  Expected: `CREATE TABLE` and `CREATE INDEX` (or `NOTICE … already exists`).

- [ ] **Step 3: Run everything CI runs**
  Run: `bun run lint && bun run typecheck && bun run test` (repo root)
  Expected: all pass. Report any failure along with whether it existed on `main` before this branch.

- [ ] **Step 4: End-to-end in the browser.** Start `apps/admin` (`bun run dev`). Search the demo confirmed booking, open it, cancel a room as guest, force un-cancel it, set status `no_show`, then force status back to `confirmed`. The timeline shows each step in order with the right actor. Then reset the demo data: `bun --env-file=.env.local packages/db/seed/demo-booking.ts` from the repo root.

- [ ] **Step 5: Commit any fixes**, then hand back with a summary.

# Booking Flow + Testing Mode Implementation Plan (part 1: server side)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in guest's room selection becomes a 15-minute hold, a Stripe test-mode payment, and a confirmed multi-room booking with emails, and with `TESTING=true` the eight demo hotels are generated on demand so the whole flow runs on a fresh database.

**Architecture:** New `booking_intents` / `booking_intent_rooms` tables hold the unpaid selection and its hold. One availability rule (`packages/pricing` pure functions plus a `packages/db` loader) feeds search, the stay quote, intent creation, payment confirmation and the host grid. The business app's Connect webhook converts a paid intent into `bookings` and `reservations` through `confirmBookingPolicy`. A new `packages/demo` package owns the testing switch, the factories and the generator.

**Tech Stack:** Bun 1.3 (`bun test`), TypeScript, Next.js (app router; **read `node_modules/next/dist/docs/` before writing Next code, because this version differs from training data**, see `apps/*/AGENTS.md`), Postgres + PostGIS via `pg` with raw SQL, Drizzle schema mirror, Stripe Connect direct charges, Lettermint mail, Better Auth.

**Spec:** `docs/superpowers/specs/2026-11-06-booking-flow-design.md`. Read it before starting any task.

**Out of this plan (part 2, after a UI concept is approved):** the property-page date/guest picker, room selection UI, search card "unavailable" styling, checkout and return-page restyle, email visual design. This plan only makes **minimal** UI edits needed for the flow to run: checkout lists several rooms using its existing components, and the return page gets new copy states. Everything else is API and server work.

## Global Constraints

- Money in DB is **major units** (euros); cents only at the Stripe boundary (`toCents` in `apps/web/app/checkout/_lib/booking-lines.ts`). `reservations.price_per_night`, `reservations.total_amount`, `bookings.total_amount` are `bigint`: store `Math.round(...)` there; the exact per-night amounts live in `reservations.nights` (jsonb), which refund logic reads.
- EUR only, EU only — generated hotels too.
- Rates are tax-inclusive; tourist tax on top; **guest pays no booking/service fee** (`bookings.booking_fee_amount = 0`). Commission = `applicationFeeCents(stayCents(lines), Number(property.commission_rate))`, tourist tax excluded, only when `STRIPE_APPLICATION_FEE_ENABLED === 'true'`.
- No Stripe-named columns in new tables (`payment_session_id`, `payment_account_id`, `payment_provider`).
- Hold: `HOLD_MINUTES = 15`. Stripe session `expires_at` = now + 30 min + 60 s margin (Stripe minimum; existing `MIN_HOLD_MS`/`HOLD_MARGIN_MS` in `apps/web/app/api/checkout/route.ts`).
- Bookings holding stock: `bookings.status IN ('confirmed','checked_in','completed')` and `reservations.cancelled_at IS NULL`, nights `< LEAST(check_out_date, departed_early_on + 1)`. New code never creates `pending` bookings.
- Every booking state change goes through `packages/db/src/booking-lifecycle` or records a `booking_events` row (`recordBookingEvent`, actor `{ kind: "system", id: null }` for webhook work).
- `TESTING=true` is honoured only with a Stripe secret key starting `sk_test_`; with any other key, both apps throw at startup.
- `properties.is_demo = true` rows are invisible (search, property page, quote, intents, checkout) unless testing mode is on.
- Dates are `YYYY-MM-DD` strings end to end; never pass Postgres `date` through JS `Date` (see header comment in `checkout/_lib/booking.ts`).
- DB tests: `describeWithDb` + `BEGIN`/`ROLLBACK` per test, as in `packages/db/src/testing/db-harness.ts`. Run from the package dir with `bun --env-file=../../.env.local test <file>` (apps: `bun --env-file=.env.local test <file>`). Add `0033_booking_intents.sql` to `PENDING` in `db-harness.ts`.
- One commit per task minimum; messages in the repo's style (imperative, sentence case, no prefix), ending with the attribution lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LJ3U7KVTJ76w2D538Ja1VM
  ```

## Review Focus

1. **Two guests (or two tabs) press Book on the last room at the same moment** → exactly one intent is created; the other gets `unavailable`. Pinned in Task 9 (`concurrent intents on the last unit`).
2. **Stripe redelivers `checkout.session.completed`, or sends `checkout.session.expired` after it** → one booking, the `paid` intent is never downgraded. Pinned in Task 11 (`convert is idempotent`, `expire after paid is a no-op`).
3. **Payment lands after the hold ran out and the room was taken meanwhile** → no booking, full refund with commission, intent `refunded_oversold`, one email. Pinned in Task 11 (`late payment on a taken room is oversold`) and Task 12 (`oversold refunds once across retries`).
4. **Guest starts a second selection while the first is still open, then pays the first tab** → the first intent was `abandoned` and its Stripe session expired, so there are never two payable sessions. Pinned in Task 9 (`new intent abandons the previous open one`).
5. **Garbage or hostile input on the new endpoints** (check-out ≤ check-in, past check-in in the property's time zone, > 30 nights, unknown room/rate ids, a room from another property, someone else's intent id, a demo hotel id with testing off) → 400/404, never a hold or a session. Pinned in Task 8 (`quote rejects bad stays`) and Task 9 (`intent rejects foreign and demo rooms`, `intent owner only`).

---

### Task 1: Schema for intents and demo flag

**Files:**
- Create: `packages/db/drizzle/0033_booking_intents.sql`
- Modify: `packages/db/src/schema.ts` (add tables after `bookings`; add `isDemo` to `properties`)
- Modify: `packages/db/src/testing/db-harness.ts` (`PENDING`)
- Test: `packages/db/src/booking-intents-schema.db.test.ts`

**Interfaces:**
- Produces tables:
  - `booking_intents(id uuid pk default gen_random_uuid(), user_id text not null, property_id uuid not null → properties, check_in_date date, check_out_date date, status text not null default 'open' CHECK in ('open','paid','expired','failed','abandoned','oversold','refunded_oversold'), hold_expires_at timestamptz not null, snapshot jsonb not null, total_amount numeric(12,2) not null, tourist_tax_amount numeric(12,2) not null default 0, commission_cents integer not null default 0, currency char(3) not null default 'EUR', payment_provider text not null default 'stripe', payment_session_id text null unique, payment_account_id text null, payment_reference text null, refund_reference text null, booking_id uuid null → bookings ON DELETE SET NULL, created_at, updated_at)`; CHECK `check_out_date > check_in_date`; index `(status, hold_expires_at)`, `(user_id, status)`, `(property_id)`.
  - `booking_intent_rooms(id uuid pk, intent_id uuid not null → booking_intents ON DELETE CASCADE, room_id uuid not null → rooms, rate_plan_id uuid not null → rate_plans, adults int not null, children int not null default 0, nights jsonb not null CHECK array, stay_total numeric(12,2) not null, tourist_tax_amount numeric(12,2) not null default 0, tourist_tax_lines jsonb not null default '[]', sort_order int not null default 0)`; index `(room_id)`, `(intent_id)`.
  - `properties.is_demo boolean not null default false`; partial index `WHERE is_demo`.
- Drizzle: `bookingIntents`, `bookingIntentRooms`, `properties.isDemo` mirroring the SQL.

- [ ] **Step 1: Write the failing test** `booking-intents-schema.db.test.ts`: inside a rolled-back transaction, `applyPendingMigrations`, `seedProperty`, insert one intent + one intent room; assert `status = 'open'`; assert inserting `check_out_date = check_in_date` throws; assert `status = 'bogus'` throws; assert `properties.is_demo` defaults to `false`.
- [ ] **Step 2: Run** `cd packages/db && bun --env-file=../../.env.local test src/booking-intents-schema.db.test.ts` → FAIL (relation does not exist).
- [ ] **Step 3: Write the migration** in the style of `0032_booking_events.sql` (header comment, `IF NOT EXISTS`, additive only), add Drizzle mirrors, add the file to `PENDING`.
- [ ] **Step 4: Run** the test → PASS. Run `cd packages/db && bun run typecheck` → no errors.
- [ ] **Step 5: Apply to the dev DB** with the repo's migrate script (`bun run db:migrate` in `packages/db`); if drizzle-kit refuses a hand-written file, apply it with `psql "$DATABASE_URL" -f` and note that in the commit message.
- [ ] **Step 6: Commit** `Add booking intents tables and demo property flag`.

---

### Task 2: Availability rules (pure)

**Files:**
- Create: `packages/pricing/src/availability.ts`
- Modify: `packages/pricing/src/index.ts` (re-export)
- Modify: `packages/pricing/src/calculator.ts` (add `priced_nights` to `ResolvedRoom`)
- Test: `packages/pricing/src/availability.test.ts`, extend `packages/pricing/src/calculator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type UnavailableReason =
    | 'sold_out' | 'room_closed' | 'rate_closed' | 'closed_to_arrival' | 'closed_to_departure'
    | 'min_stay' | 'max_stay' | 'too_many_guests' | 'not_on_sale';
  /** Priority used when one reason must represent a hotel; first wins. */
  export const REASON_PRIORITY: readonly UnavailableReason[];
  export function nightTotal(i: { override: number | null; totalRooms: number | null; totalUnits: number; blocked: number }): number;
  export function bookableUnits(i: { total: number; booked: number; held: number }): number;
  export type StayRule = { date: string; isClosed: boolean; minStay: number | null; maxStay: number | null; closedToArrival: boolean; closedToDeparture: boolean };
  export function stayRuleReasons(i: { checkIn: string; checkOut: string; planMinStay: number | null; planMaxStay: number | null; rules: StayRule[] }): UnavailableReason[];
  export function perRoomParty(i: { adults: number; children: number; rooms: number }): { adults: number; children: number };
  export function pickReason(reasons: Iterable<UnavailableReason>): UnavailableReason | null;
  ```
  `ResolvedRoom.priced_nights: { date: string; price: number }[]` (each `round2`, last night absorbs rounding so the sum equals `room_price` exactly).
- Rules (from spec §2): `nightTotal` = `override` if not null (blocked **not** subtracted), else `(totalRooms ?? totalUnits) - blocked`, floored at 0. `bookableUnits` = `max(0, total - booked - held)`. `stayRuleReasons`: `rate_closed` if any `isClosed` on a night in `[checkIn, checkOut)`; `closed_to_arrival` if the rule for `checkIn` says so; `closed_to_departure` if the rule for `checkOut` says so; min/max stay from the **arrival date's** rule, falling back to the plan default. `perRoomParty` = ceil-divide both counts by `max(1, rooms)`. `REASON_PRIORITY = ['sold_out','room_closed','rate_closed','closed_to_arrival','closed_to_departure','min_stay','max_stay','too_many_guests','not_on_sale']`.

- [ ] **Step 1: Write failing tests**: `nightTotal({override: 8, totalRooms: null, totalUnits: 10, blocked: 2}) === 8`; `nightTotal({override: null, totalRooms: 5, totalUnits: 10, blocked: 1}) === 4`; `nightTotal({override: null, totalRooms: null, totalUnits: 1, blocked: 3}) === 0`; `bookableUnits({total: 8, booked: 3, held: 2}) === 3`; `bookableUnits({total: 1, booked: 1, held: 1}) === 0`; a 3-night stay with `planMinStay: 5` → `['min_stay']`; arrival-date rule `minStay: 2` overrides plan 5 → `[]`; `closedToArrival` on checkIn → `['closed_to_arrival']`; `closedToArrival` on a middle night → `[]`; `isClosed` on the departure date only → `[]`; `perRoomParty({adults: 3, children: 1, rooms: 2})` → `{adults: 2, children: 1}`; `pickReason(['too_many_guests','sold_out']) === 'sold_out'`; `priced_nights` of a weekend-modified 3-night stay sums to `room_price` to the cent.
- [ ] **Step 2: Run** `cd packages/pricing && bun test src/availability.test.ts src/calculator.test.ts` → FAIL.
- [ ] **Step 3: Implement** the functions above; add `priced_nights` in `resolveRoom` from the existing private `pricedNights(state)`.
- [ ] **Step 4: Run** the tests → PASS; `bun run typecheck` → clean.
- [ ] **Step 5: Commit** `Add shared availability rules`.

---

### Task 3: Availability loader (DB)

**Files:**
- Create: `packages/db/src/availability.ts`
- Modify: `packages/db/src/index.ts` (export)
- Test: `packages/db/src/availability.db.test.ts`

**Interfaces:**
- Consumes: Task 2 functions; Task 1 tables.
- Produces:
  ```ts
  export type RoomNightUnits = { date: string; total: number; booked: number; held: number; bookable: number };
  export type RatePlanAvailability = { ratePlanId: string; isRefundable: boolean; reasons: UnavailableReason[] };
  export type RoomAvailability = {
    roomId: string; onSale: boolean; maxAdults: number; maxChildren: number;
    total: number;      // min night total over the stay
    unitsLeft: number;  // min bookable over the stay
    roomClosed: boolean; nights: RoomNightUnits[]; ratePlans: RatePlanAvailability[];
  };
  export async function loadStayAvailability(db: Queryable, i: {
    propertyId: string; checkIn: string; checkOut: string; now: Date; excludeIntentId?: string | null;
  }): Promise<RoomAvailability[]>;
  export type PropertyAvailability = { propertyId: string; bookable: boolean; reason: UnavailableReason | null };
  export async function loadSearchAvailability(db: Queryable, i: {
    propertyIds: string[]; checkIn: string; checkOut: string; adults: number; children: number; rooms: number; now: Date;
  }): Promise<Map<string, PropertyAvailability>>;
  ```
- SQL: one query per call (date spine via `generate_series(checkIn, checkOut - 1)`), modelled on `AVAILABILITY_SQL` in `apps/business/.../rates-availability/_lib/ari-query.ts` for `booked` and `room_closures`, plus a `held` CTE: `SUM` of `booking_intent_rooms` joined to `booking_intents` with `status = 'open' AND hold_expires_at > $now AND id IS DISTINCT FROM $exclude`, per room per night in the intent's range. Rate-plan rules from `rate_plan_restrictions` (`is_active`, `priority DESC`, one row per date per plan, dates `[checkIn, checkOut]`). Only active rate plans, non-archived rooms; `onSale = rooms.is_active`.
- `loadSearchAvailability`: a room *qualifies* when it is on sale, not closed, fits `perRoomParty`, has `unitsLeft >= 1` and has a plan with no reasons. A property is `bookable` when the **sum of `unitsLeft` over its qualifying rooms** is `>= rooms` (a guest can mix room types). Otherwise `reason`: `sold_out` if some rooms qualify but their units fall short; else `pickReason(all reasons seen)`, where a room's own reasons add `sold_out` (unitsLeft 0), `room_closed`, `too_many_guests`, `not_on_sale`.

- [ ] **Step 1: Write failing tests** (each in its own rolled-back transaction, using `seedProperty` and direct inserts):
  - `host number is the total`: `rooms.total_units = 10`, `room_inventory.available_override = 8` on night 1, one confirmed booking of 1 unit on night 1 → night 1 `{ total: 8, booked: 1, bookable: 7 }`.
  - `blocked only without a host number`: no override, `total_units 5`, `blocked_rooms 2` → `total 3`.
  - `open hold counts, expired hold does not`: intent with `hold_expires_at = now + 5 min` holding 1 → `held 1`; another with `now - 1 min` → ignored; `excludeIntentId` of the first → `held 0`.
  - `cancelled room and early departure free stock`.
  - `pending booking does not hold stock`.
  - `rate rules`: min stay 5 on the plan for a 3-night stay → plan reasons `['min_stay']`; closed-to-arrival restriction on check-in → `['closed_to_arrival']`; room closure over a night → `roomClosed: true`.
  - `search reason`: property with `total_units 1` and one confirmed booking → `{ bookable: false, reason: 'sold_out' }`; room `max_adults 1`, search 2 adults 1 room → `too_many_guests`; same with `rooms: 2` and 2 units → `bookable: true`; `mixed room types`: two room types with 1 unit each, search `rooms: 2` → `bookable: true`, `rooms: 3` → `sold_out`.
- [ ] **Step 2: Run** `cd packages/db && bun --env-file=../../.env.local test src/availability.db.test.ts` → FAIL.
- [ ] **Step 3: Implement** both functions.
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `Load stay and search availability from one rule`.

---

### Task 4: Host grid uses the same rule

**Files:**
- Modify: `apps/business/app/(dashboard)/dashboard/listings/rates-availability/_lib/ari-query.ts` (`AVAILABILITY_SQL` gains a `held` CTE; the cell computation at ~l.556)
- Modify: `apps/business/app/(dashboard)/dashboard/listings/rates-availability/_lib/types.ts` (`AvailabilityCell` gains `held: number`, `left: number`)
- Test: `.../_lib/ari-query.availability.test.ts`

**Interfaces:**
- Consumes: `nightTotal`, `bookableUnits` from `@openbookings/pricing`.
- Produces: `AvailabilityCell.total` stays the night total, `effective` and new `left` = `bookableUnits({ total: nightTotal(...), booked, held })`. `source` unchanged. Existing UI keeps reading `effective`; it now means "left". The "3 of 8 left" wording is a part-2 UI item.

- [ ] **Step 1: Update/add failing tests**: override 8 with 3 booked → `effective 5`, `left 5` (was 8); no override, total 4, blocked 1, booked 1, held 1 → `left 1`.
- [ ] **Step 2: Run** `cd apps/business && bun --env-file=.env.local test app/\(dashboard\)/dashboard/listings/rates-availability/_lib/ari-query.availability.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Replace `override ?? computed` with the shared functions; add `held` to the SQL the same way as Task 3.
- [ ] **Step 4: Check every reader of `effective`** — `rg -n "\.effective\b" apps/business --glob '!**/node_modules/**'` (today: `ari-grid.tsx`, `ari-detail-panel.tsx`, `runs.ts`, `mock-ari.ts` + test). Each must treat it as "rooms left", not the night total; where one shows or edits the host's own number, switch it to `total`/`override`. Update `mock-ari.ts` so its cells carry `held` and `left`.
- [ ] **Step 5: Run** → PASS; `bun run typecheck` and `bun test` in `apps/business` → clean.
- [ ] **Step 6: Commit** `Show bookable rooms in the rates grid, host number as total`.

---

### Task 5: Testing switch and startup guard

**Files:**
- Create: `packages/demo/package.json` (`@openbookings/demo`, exports `"."` → `src/index.ts`, scripts `test`, `typecheck`, deps `@openbookings/db`, `@openbookings/pricing`, `@openbookings/images`, `pg`), `packages/demo/tsconfig.json` (copy `packages/pricing`'s), `packages/demo/src/index.ts`, `packages/demo/src/mode.ts`
- Modify: `apps/web/instrumentation.ts`, `apps/business/instrumentation.ts` (call the guard in the `nodejs` branch), `apps/web/package.json` + `apps/business/package.json` (dep `@openbookings/demo: workspace:*`), `.env.example` files if present (document `TESTING`)
- Test: `packages/demo/src/mode.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function isTestingMode(env?: NodeJS.ProcessEnv): boolean; // TESTING === 'true' && key startsWith 'sk_test_'
  export function assertTestingModeSafe(env?: NodeJS.ProcessEnv): void; // throws if TESTING==='true' and key does not start with 'sk_test_'
  ```

- [ ] **Step 1: Failing tests**: `isTestingMode({TESTING:'true', STRIPE_SECRET_KEY:'sk_test_x'}) === true`; `({TESTING:'true', STRIPE_SECRET_KEY:'sk_live_x'})` → `isTestingMode` false and `assertTestingModeSafe` throws `/TESTING=true requires a Stripe test key/`; `({})` → false, no throw; `TESTING: '1'` → false.
- [ ] **Step 2: Run** `cd packages/demo && bun install && bun test src/mode.test.ts` → FAIL.
- [ ] **Step 3: Implement**; wire `assertTestingModeSafe()` into both `register()` functions.
- [ ] **Step 4: Run** → PASS; `bun run typecheck` in `packages/demo`, `apps/web`, `apps/business` → clean.
- [ ] **Step 5: Commit** `Add testing mode switch with live-key guard`.

---

### Task 6: Factories, seeded randomness, EU places

**Files:**
- Create: `packages/demo/src/random.ts`, `packages/demo/src/places.ts`, `packages/demo/src/factories.ts`
- Test: `packages/demo/src/random.test.ts`, `packages/demo/src/places.test.ts`, `packages/demo/src/factories.db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // random.ts
  export type Rng = { next(): number; int(min: number, max: number): number; pick<T>(xs: readonly T[]): T };
  export function seededRng(seed: string): Rng;           // hash (e.g. cyrb53) → mulberry32
  export function areaKey(lat: number, lon: number): string; // `${lat.toFixed(1)}:${lon.toFixed(1)}`
  // places.ts
  export type EuPlace = { country: string; capital: string; lat: number; lon: number; timezone: string };
  export const EU_PLACES: readonly EuPlace[]; // the 27 EU capitals
  export function nearestEuPlace(lat: number, lon: number): EuPlace;
  // factories.ts — each inserts and returns ids; all take a Queryable (pg Client/PoolClient)
  export async function insertDemoProperty(db: Queryable, p: DemoPropertyInput): Promise<{ propertyId: string; slug: string }>;
  export async function insertDemoRoom(db: Queryable, r: DemoRoomInput): Promise<{ roomId: string }>;
  export async function insertDemoRatePlan(db: Queryable, r: DemoRatePlanInput): Promise<{ ratePlanId: string }>;
  export async function insertRestriction(db: Queryable, r: { ratePlanId: string; startDate: string; endDate: string; closedToArrival?: boolean; minStay?: number | null; isClosed?: boolean }): Promise<void>;
  export async function insertAvailabilityOverride(db: Queryable, r: { roomId: string; startDate: string; endDate: string; available: number }): Promise<void>; // one room_inventory row per date
  export async function insertDayOfWeekModifier(db: Queryable, r: { ratePlanId: string; days: number[]; amount: number }): Promise<void>; // flat surcharge
  export async function insertTouristTaxRule(db: Queryable, r: { propertyId: string; perPersonPerNight: number }): Promise<void>;
  ```
  `DemoPropertyInput` carries name, slug, city, country, timezone, lat, lon, cancellationTier, organizationId, images (hero + 3 gallery URLs). `DemoRoomInput`: propertyId, name, roomType, bedType, sizeSqm, maxAdults, maxChildren, baseOccupancy, totalUnits, imageUrl. `DemoRatePlanInput`: roomId, name, bar (**whole euros**), isRefundable, minStay, mealPlan. Look at `seedProperty` in `db-harness.ts` and `packages/db/seed/demo-booking.ts` for the required columns; `is_demo = true`, `is_active = true`, `stripe_account_id NULL`.
- Images: `parseBackdropManifest` on `packages/images/manifest.json` (bundled), picked with the rng.

- [ ] **Step 1: Failing tests**: `seededRng('a').next()` equals itself across calls with the same seed and differs from `seededRng('b')`; `areaKey(52.3676, 4.9041) === '52.4:4.9'`; `nearestEuPlace(52.37, 4.90).country === 'NL'`, `nearestEuPlace(41.9, 12.5).timezone === 'Europe/Rome'`; DB test: `insertDemoProperty` + room + plan → row has `is_demo = true` and `ST_Y(location::geometry)` ≈ lat.
- [ ] **Step 2: Run** `cd packages/demo && bun test src/random.test.ts src/places.test.ts && bun --env-file=../../.env.local test src/factories.db.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `Add demo data factories and seeded randomness`.

---

### Task 7: The eight demo hotels and the demo organisation

**Files:**
- Create: `packages/demo/src/scenarios.ts`, `packages/demo/src/generate.ts`, `packages/demo/src/organisation.ts`
- Test: `packages/demo/src/generate.db.test.ts`

**Interfaces:**
- Consumes: Task 6; `loadSearchAvailability` (Task 3) in tests; `RATES_TAX_INCLUSIVE_DOC_ID` from `@openbookings/authz/rates-doc`.
- Produces:
  ```ts
  export const DEMO_ORG_ID = 'demo-organisation';
  export async function ensureDemoOrganisation(db: Queryable): Promise<string>; // organization + org_profile + org_consent(rates doc), idempotent
  export type DemoScenario = 'normal' | 'last_room' | 'sold_out' | 'min_stay' | 'no_arrival' | 'non_refundable' | 'weekend_prices' | 'small_rooms';
  export const DEMO_SCENARIOS: readonly DemoScenario[]; // in that order
  /** Any `is_demo` property within 25 km. Lock-free fast path for callers. */
  export async function hasDemoHotelsNear(db: Queryable, i: { lat: number; lon: number }): Promise<boolean>;
  /** Must run inside a transaction (it takes a transaction-scoped advisory lock). */
  export async function ensureDemoHotels(tx: Queryable, i: { lat: number; lon: number; place?: string | null }): Promise<{ created: boolean; propertyIds: string[] }>;
  ```
  Callers wrap it: `withTransaction((tx) => ensureDemoHotels(tx, …))` (`withTransaction` from `@openbookings/db`). Tests call it on their own `BEGIN`…`ROLLBACK` client.
- Behaviour: if any `is_demo` property lies within **25 km** of the point, return `created: false`. Otherwise, under `pg_advisory_xact_lock(hashtext('demo:' || areaKey))`, re-check, then create 8 hotels within ~3 km of the point (rng-jittered), named from the rng (`'<Adjective> <Noun> <Hotel|House|Suites>'` style word lists), city = `place` (first comma part) or `nearestEuPlace().capital`, country/timezone from `nearestEuPlace`, slug `demo-<areaKey slug>-<scenario>`. Scenario setup must hold **for any dates** (range today → today + 730 days):
  - `normal`: 3 room types, `total_units` 6–10, flex tier, refundable + NR. Every NR bar is `Math.floor(refundableBar * 0.85)` (whole euros, and strictly inside the Annex B B.4.3 ≥10%-cheaper rule).
  - `last_room`: one room type, `total_units 1`.
  - `sold_out`: `insertAvailabilityOverride(available: 0)` over the range.
  - `min_stay`: plan `min_stay 5`.
  - `no_arrival`: `closedToArrival` restriction over the range on every plan.
  - `non_refundable`: refundable plan + NR plan, NR bar `Math.floor(refundableBar * 0.85)` (spec: Annex B B.4.3 must not be bypassed).
  - `weekend_prices`: `insertDayOfWeekModifier(days [5,6], amount 40)` + tourist tax €3.50 per person per night.
  - `small_rooms`: rooms `max_adults 1`, `max_children 0`, `total_units 4`.
  - Tiers: `normal`, `weekend_prices`, `small_rooms`, `last_room` → `flex`; others `standard`.
  - All `organization_id = DEMO_ORG_ID`.

- [ ] **Step 1: Failing tests**: first `ensureDemoHotels({lat: 38.72, lon: -9.14, place: 'Lisbon, Portugal'})` → `created: true`, 8 ids, all `is_demo`, city `Lisbon`, country `PT`; second call → `created: false`; same call from a fresh area with the rng gives the same hotel names twice (run, read names, delete, run again, compare); `loadSearchAvailability` for a 3-night stay, 2 adults, 1 room, 40 days out → `sold_out` hotel `{bookable:false, reason:'sold_out'}`, `min_stay` → `'min_stay'`, `no_arrival` → `'closed_to_arrival'`, `small_rooms` → `'too_many_guests'`, `normal` → bookable; `ensureDemoOrganisation` twice → one org, one consent row.
- [ ] **Step 2: Run** `cd packages/demo && bun --env-file=../../.env.local test src/generate.db.test.ts` → FAIL. (Tests commit nothing: each runs in `BEGIN`/`ROLLBACK`.)
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck clean.
- [ ] **Step 5: Commit** `Generate the eight demo hotels on demand`.

---

### Task 8: Search, property page and stay quote

**Files:**
- Modify: `apps/web/app/api/query/route.ts` (generation hook, `is_demo` filter, remove the occupancy filter from `candidate_rooms`, attach availability)
- Modify: `apps/web/app/search/_components/SearchClient.tsx` (send `place=committed.destination` to `/api/query`; pass dates/party into the card `href`: `/p/${slug}?checkin=…&checkout=…&adults=…&children=…&rooms=…`)
- Modify: `apps/web/lib/hotel-page-query.ts` (`AND (NOT p.is_demo OR ${testing})`)
- Create: `apps/web/lib/booking/quote.ts`, `apps/web/lib/booking/stay-input.ts`, `apps/web/app/api/stay-quote/route.ts`
- Test: `apps/web/lib/booking/stay-input.test.ts`, `apps/web/lib/booking/quote.db.test.ts`

**Interfaces:**
- Consumes: `ensureDemoHotels`, `isTestingMode` (`@openbookings/demo`); `loadStayAvailability`, `loadSearchAvailability` (`@openbookings/db`); `resolveRoom`, `freeCancellationUntil`, `snapshotTier` (`@openbookings/pricing`); `searchBoundErrors` from `app/api/query/search-bounds.ts`.
- Produces:
  ```ts
  // stay-input.ts
  export type StayInput = { checkIn: string; checkOut: string; adults: number; children: number; rooms: number };
  export function parseStayInput(p: URLSearchParams | Record<string, unknown>, todayInZone: string): { ok: true; value: StayInput } | { ok: false; errors: string[] };
  // quote.ts
  export type QuotedRatePlan = {
    ratePlanId: string; name: string; isRefundable: boolean; mealPlan: string | null;
    nights: { date: string; price: number }[]; stayTotal: number; touristTax: TouristTaxResult;
    freeCancellationUntil: string | null; reasons: UnavailableReason[];
  };
  export type QuotedRoom = {
    roomId: string; name: string; roomType: string | null; maxAdults: number; maxChildren: number;
    total: number; unitsLeft: number; reasons: UnavailableReason[]; ratePlans: QuotedRatePlan[];
  };
  export type StayQuote = { propertyId: string; slug: string; currency: 'EUR'; stay: StayInput; rooms: QuotedRoom[] };
  export async function quoteStay(db: Queryable, i: { propertyId: string; stay: StayInput; now: Date; testing: boolean }): Promise<StayQuote | null>;
  export type SelectedRoom = { roomId: string; ratePlanId: string; adults: number; children: number };
  export async function priceSelection(db: Queryable, i: { propertyId: string; checkIn: string; checkOut: string; selection: SelectedRoom[]; now: Date; testing: boolean }):
    Promise<{ ok: true; rooms: IntentRoomInput[]; snapshot: IntentSnapshot } | { ok: false; error: 'invalid_selection' | 'too_many_guests' | 'unavailable'; detail: string }>;
  ```
  (`IntentRoomInput`, `IntentSnapshot` are defined in Task 9's `packages/db/src/booking-intents.ts`; create the types file in this task if Task 9 has not landed, and Task 9 moves nothing.)
- Search result items gain `availability: { bookable: boolean; reason: UnavailableReason | null }`. Rooms that do not fit `perRoomParty` or are unavailable are not price candidates; a hotel with none is still returned (priced from its cheapest room) with `bookable: false`.
- `GET /api/stay-quote?property=<slug>&checkin&checkout&adults&children&rooms` → `200 StayQuote`, `400 { errors }`, `404` unknown/inactive/demo-when-off property. Not cached (`dynamic = 'force-dynamic'`), so the cached property page HTML is untouched.
- Quote pricing: one SQL for the property's active rooms × **all** active rate plans, with steps 2–4 of the search query (nightly override, modifiers, tourist tax rules) → `RoomRow` → `resolveRoom(row, { adults, children, arrivalDate }, today)`. NR plans follow the same Annex B B.4.3 filter as `withCancellationTerms` in `apps/web/lib/listing-prices.ts` (extract the predicate into `packages/pricing` if both need it). Quote prices for the **per-room party** (`perRoomParty`); `priceSelection` prices each selected room for its own adults/children and fails `too_many_guests` if a room's party exceeds its max. It also groups the selection by `roomId` and fails `unavailable` (detail names the room) when the count for a room exceeds its `unitsLeft`, or when the chosen rate plan has any reasons. This is an early check so the guest hears it before a hold is attempted; Task 9 re-checks under lock.
- Search in testing mode: first `await hasDemoHotelsNear(db, { lat, lon })` (Task 7; a plain query, no transaction, no lock) and only when it is `false` run `await withTransaction((tx) => ensureDemoHotels(tx, { lat, lon, place }))`, so steady-state searches pay one indexed query and nothing else. Generation failure is logged and the search continues.

- [ ] **Step 1: Failing tests**:
  - `quote rejects bad stays` (`parseStayInput`): checkout = checkin → error; checkin before `todayInZone` → error; 31 nights → error; adults 0 → error; rooms 0 → error; valid input → `ok`.
  - `quote.db.test.ts`: on a `seedProperty` with an override 2 and one confirmed booking → room `unitsLeft 1`; a NR plan not ≥10% cheaper is absent; demo property with `testing: false` → `null`, with `testing: true` → quote; `priceSelection` with a room id from another property → `invalid_selection`; with a party of 3 in a `max_adults 2` room → `too_many_guests`; with a valid two-room selection → 2 `IntentRoomInput`s whose `stayTotal`s sum to `snapshot.roomsTotal`, and `snapshot.commissionCents` = `applicationFeeCents(cents of roomsTotal, rate)` when `STRIPE_APPLICATION_FEE_ENABLED=true`, else 0.
- [ ] **Step 2: Run** `cd apps/web && bun test lib/booking/stay-input.test.ts && bun --env-file=.env.local test lib/booking/quote.db.test.ts` → FAIL.
- [ ] **Step 3: Implement** quote, stay-input, the route, and the search/page changes.
- [ ] **Step 4: Run** → PASS; `bun run typecheck` in `apps/web` → clean. Manual check with `TESTING=true`: `curl 'localhost:3000/api/query?lat=38.72&lon=-9.14&checkin=<+40d>&checkout=<+43d>&adults=2&rooms=1&place=Lisbon'` → 8 demo hotels, reasons as in Task 7.
- [ ] **Step 5: Commit** `Quote stays and show availability in search`.

---

### Task 9: Create the intent and hold the rooms

**Files:**
- Create: `packages/db/src/booking-intents.ts` (export from `index.ts`), `apps/web/app/api/booking-intents/route.ts`, `apps/web/app/api/booking-intents/[id]/expire/route.ts`
- Modify: `packages/stripe/src/payments/checkout.ts` (add `expireBookingCheckout`), `packages/stripe/src/index.ts`
- Test: `packages/db/src/booking-intents.db.test.ts`, `packages/stripe/src/payments/checkout.test.ts`

**Interfaces:**
- Consumes: `loadStayAvailability` (Task 3), `priceSelection` (Task 8).
- Produces:
  ```ts
  export const HOLD_MINUTES = 15;
  export type IntentRoomInput = { roomId: string; ratePlanId: string; adults: number; children: number;
    nights: { date: string; price: number }[]; stayTotal: number; touristTax: number; touristTaxLines: TouristTaxLine[] };
  export type IntentSnapshot = { roomsTotal: number; touristTaxTotal: number; total: number; commissionCents: number; currency: 'EUR';
    rooms: { roomId: string; ratePlanId: string; roomName: string; ratePlanName: string; isRefundable: boolean; freeCancellationUntil: string | null }[] };
  export type BookingIntent = { id: string; userId: string; propertyId: string; propertySlug: string; checkIn: string; checkOut: string;
    status: 'open' | 'paid' | 'expired' | 'failed' | 'abandoned' | 'oversold' | 'refunded_oversold';
    holdExpiresAt: Date; snapshot: IntentSnapshot; rooms: (IntentRoomInput & { id: string })[];
    paymentSessionId: string | null; paymentAccountId: string | null; bookingId: string | null };
  export type AbandonedSession = { intentId: string; sessionId: string; accountId: string };
  export async function createBookingIntent(db: LifecycleDb, i: { userId: string; propertyId: string; checkIn: string; checkOut: string;
    rooms: IntentRoomInput[]; snapshot: IntentSnapshot; now: Date }):
    Promise<{ ok: true; intentId: string; holdExpiresAt: Date; abandoned: AbandonedSession[] } | { ok: false; error: 'unavailable'; roomIds: string[] }>;
  export async function loadIntent(db: Queryable, i: { intentId: string; userId: string }): Promise<BookingIntent | null>;
  /** Return page only. The webhook finds its intent through session metadata (`bookingIntentId`), never through this. */
  export async function loadIntentBySession(db: Queryable, i: { sessionId: string; userId: string }): Promise<BookingIntent | null>;
  export async function attachPaymentSession(db: Queryable, i: { intentId: string; sessionId: string; accountId: string }): Promise<void>;
  export async function expireIntent(db: Queryable, i: { intentId: string; now: Date; force?: boolean }): Promise<{ sessionId: string | null; accountId: string | null } | null>;
  export async function markIntentFailed(db: Queryable, i: { intentId: string }): Promise<void>;
  // packages/stripe
  export async function expireBookingCheckout(sessionId: string, stripeAccountId: string): Promise<void>; // swallows "already expired/complete"
  ```
  `LifecycleDb` is the type in `packages/db/src/booking-lifecycle/index.ts` (`Queryable & { transaction }`); import it with `import type` — that module imports `../index` at runtime, so a value import would be circular.
- `createBookingIntent`: one transaction. **Lock order is always `booking_intents` first, then `rooms` ordered by id** (the same order as Task 11's conversion, so the two can never deadlock): first `UPDATE booking_intents SET status = 'abandoned' WHERE user_id = $1 AND status = 'open' RETURNING id, payment_session_id, payment_account_id` (collect their sessions), then `SELECT … FROM rooms WHERE id = ANY($ids) ORDER BY id FOR UPDATE`, then `loadStayAvailability(excludeIntentId: null)`; count requested units per room; any room short → rollback, `unavailable`. Insert intent (`hold_expires_at = now + HOLD_MINUTES`) and rooms. This is the authoritative availability check; `priceSelection`'s is an early, unlocked one.
- `expireIntent`: `open` → `expired` only if `hold_expires_at <= now` (or `force`); returns the session to expire; any other status → `null`.
- `POST /api/booking-intents` body `{ propertyId, checkIn, checkOut, rooms: SelectedRoom[], expectedTotal: number }`: no session → 401; zod-validate (1–9 rooms); property must be visible (`is_demo` rule); `priceSelection`; `expectedTotal` differs from `snapshot.total` by more than €0.005 → `409 { error: 'price_changed', quote }`; `createBookingIntent`; for each abandoned session `await expireBookingCheckout(...).catch(log)`; → `201 { intentId, holdExpiresAt, checkoutUrl: '/checkout/' + intentId }`; `unavailable` → `409 { error: 'unavailable', roomIds }`. Rate-limit like `apps/web/lib/rateLimit.ts` does elsewhere.
- `POST /api/booking-intents/[id]/expire`: owner only; `expireIntent` (no force) → if a session came back, `expireBookingCheckout`; `200 { status }`.

- [ ] **Step 1: Failing tests** (`booking-intents.db.test.ts`):
  - `concurrent intents on the last unit`: two separate connections (two `Client`s, each in its own transaction on a property committed in a setup step and deleted in `afterAll`) call `createBookingIntent` for the same 1-unit room at once → exactly one `ok: true`.
  - `new intent abandons the previous open one`: user's first intent has `payment_session_id 'cs_a'`; second create → first `status 'abandoned'`, `abandoned` contains `{ sessionId: 'cs_a' }`, and the first intent's hold no longer counts.
  - `hold length`: `holdExpiresAt - now === 15 min`.
  - `intent owner only`: `loadIntent` with another user id → `null`.
  - `intent rejects foreign and demo rooms` lives in Task 8's `priceSelection` tests (add there: two units of a room with `unitsLeft 1` → `unavailable`); here assert `expireIntent` before the hold ends → `null` and status still `open`; after → `expired`; on a `paid` intent → `null`.
  - `checkout.test.ts`: `expireBookingCheckout` swallows a Stripe error whose message says the session is not open (mock `stripe.checkout.sessions.expire` the way the existing tests mock the client).
- [ ] **Step 2: Run** `cd packages/db && bun --env-file=../../.env.local test src/booking-intents.db.test.ts`; `cd packages/stripe && bun test src/payments/checkout.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck `packages/db`, `packages/stripe`, `apps/web` → clean.
- [ ] **Step 5: Commit** `Create booking intents with a 15-minute hold`.

---

### Task 10: Checkout pays an intent

**Files:**
- Move: `apps/web/app/checkout/page.tsx` → `apps/web/app/checkout/[intentId]/page.tsx` (`/checkout` with no id → `redirect('/')`)
- Modify: `apps/web/app/checkout/_lib/booking.ts` (read the intent instead of `CHECKOUT_BOOKING_ID`; `StaySummary` room fields → `rooms: StayRoom[]`; `HOLD_MINUTES` from `@openbookings/db`), `apps/web/app/checkout/_lib/booking-lines.ts` (`buildIntentLines`), `apps/web/app/api/checkout/route.ts` (body gains `intentId`; reuse an open session; metadata), `apps/web/app/checkout/_components/CheckoutClient.tsx`, `TripSummary.tsx`, `PaymentCard.tsx` (minimal: list each room with the existing row styles; countdown from `holdExpiresAt`; on reaching zero call `POST /api/booking-intents/[id]/expire` and show the existing "hold expired" state)
- Test: `apps/web/app/checkout/_lib/booking-lines.test.ts`, `apps/web/app/checkout/_lib/booking.db.test.ts` (new)

**Interfaces:**
- Consumes: `loadIntent`, `attachPaymentSession`, `expireIntent` (Task 9); `retrieveBookingCheckout`, `createBookingCheckout`, `expireBookingCheckout`.
- Produces:
  ```ts
  export type StayRoom = { intentRoomId: string; roomId: string; roomName: string; roomType: string | null; bedType: string | null;
    sizeSqm: number | null; roomImageUrl: string; ratePlanName: string; isRefundable: boolean; adults: number; children: number;
    nights: number; stayTotal: number; cancellation: CheckoutCancellationTerms };
  export async function getBookingSummary(i: { intentId: string; userId: string }): Promise<StaySummary>; // throws BookingNotFoundError
  export function buildIntentLines(rooms: { roomName: string; roomType: string | null; nights: { date: string; price: number }[]; touristTaxLines: TouristTaxLine[] }[]): BookingLine[];
  ```
  `buildIntentLines`: per room one `stay` line, `quantity 1`, `unitAmountCents = toCents(sum of nights)`, name `"<room name> <type> · <n> nights"`; then that room's tourist-tax lines (`kind 'tourist_tax'`). Commission stays `commissionCents(lines, rate)` (unchanged helper).
- `POST /api/checkout` `{ intentId, turnstileToken }`: intent must be the user's and `open` with `hold_expires_at > now` (else `409 { code: 'hold_expired' }`); if `payment_session_id` is set and Stripe says it is `open`, return its client secret (never two payable sessions); else create one (`expiresAt` = now + 30 min + margin), `attachPaymentSession`. Metadata: `{ bookingIntentId, totalCents, touristTaxCents }` — drop `roomId` and `userId` (the intent carries the user; resolves the TODO at old route l.266). Remove `recordTouristTax` (tax is fixed on the intent).
- `ratesConfirmed` / `assertChargeable` unchanged. **Keep the dev fallback** when rewriting the loader: `stripeAccountId = row.stripe_account_id ?? (NODE_ENV === 'production' ? '' : STRIPE_CONNECT_ACCOUNT_ID ?? '')` (today's l.386). Demo hotels have `stripe_account_id NULL` and are only reachable in testing mode, which is local only, so this is what makes them chargeable; add a test that a demo intent's summary gets the fallback account.

- [ ] **Step 1: Failing tests**: `buildIntentLines` for two rooms (3 nights €100/€100/€140; 2 nights €90/€90) with one tax line each → 4 lines, stay amounts `34000` and `18000`, `stayCents` `52000`; `booking.db.test.ts`: `getBookingSummary` of another user's intent throws `BookingNotFoundError`; of a two-room intent → `rooms.length === 2` and `lines` total equals `toCents(snapshot.total)`.
- [ ] **Step 2: Run** `cd apps/web && bun test app/checkout/_lib/booking-lines.test.ts && bun --env-file=.env.local test app/checkout/_lib/booking.db.test.ts` → FAIL.
- [ ] **Step 3: Implement** loader, lines, route, and the minimal component changes.
- [ ] **Step 4: Run** → PASS; `bun run typecheck` in `apps/web` → clean; existing checkout tests still pass (`bun test app/checkout`).
- [ ] **Step 5: Commit** `Pay for a booking intent at checkout`.

---

### Task 11: Turn a paid intent into a booking

**Files:**
- Modify: `packages/db/src/booking-intents.ts` (add conversion), `packages/db/src/booking-events.ts` (`BookingEventKind` gains nothing — reuse `"confirmed"`)
- Test: `packages/db/src/booking-intents-convert.db.test.ts`

**Interfaces:**
- Consumes: `loadStayAvailability`, `confirmBookingPolicy`, `recordBookingEvent`.
- Produces:
  ```ts
  export type ConvertResult =
    | { outcome: 'confirmed'; bookingId: string; firstTime: boolean }
    | { outcome: 'oversold'; firstTime: boolean; paymentIntentId: string; accountId: string; amountCents: number };
  export async function convertIntentToBooking(db: LifecycleDb, i: { intentId: string; paymentIntentId: string; accountId: string; amountCents: number; now: Date }): Promise<ConvertResult>;
  export async function markIntentRefundedOversold(db: Queryable, i: { intentId: string; refundId: string }): Promise<boolean>; // true only on the oversold → refunded_oversold transition
  ```
- Algorithm (one transaction): lock the intent `FOR UPDATE`. `paid` → return `{confirmed, bookingId, firstTime:false}`. `oversold`/`refunded_oversold` → return `{oversold, firstTime:false, …}`. Otherwise lock its rooms (`FOR UPDATE`, ordered by id), `loadStayAvailability(excludeIntentId: intentId)`; short → set `status 'oversold'`, `payment_reference = paymentIntentId`, return `{oversold, firstTime:true}`. Else insert `bookings` (`status 'confirmed'`, `user_id`, `hotel_id`, dates, `total_amount = Math.round(snapshot.total)` — what the guest paid, tourist tax included, matching `transactions.amount` and the guest bookings list's `total_paid` (`apps/web/app/account/bookings/_lib/list.ts`), `booking_fee_amount 0`, `currency`, `stripe_payment_intent_id = paymentIntentId`), one `reservations` row per intent room (`total_nights`, `price_per_night = Math.round(stayTotal / nights)`, `total_amount = Math.round(stayTotal)`, `tourist_tax_amount`, `tourist_tax_lines`, adults/children), then `confirmBookingPolicy(tx, { bookingId, confirmedAt: now, nightPrices })` with each reservation's exact `nights`, `recordBookingEvent(kind 'confirmed', actor system, data { intentId, paymentIntentId })`, a `transactions` row (`type 'charge'`, `provider 'stripe'`, `provider_payment_id`, `amount = Math.round(amountCents / 100)`, `status` = the paid value of `payment_status` enum — read the enum in `schema.ts`), intent → `paid`, `booking_id`, `payment_reference`.
- Works from statuses `open`, `expired`, `abandoned`, `failed` (a late payment is still a payment).

- [ ] **Step 1: Failing tests**:
  - `confirms a two-room intent`: → one booking `confirmed` with `confirmed_at` and `total_amount = Math.round(snapshot.total)`, 2 reservations with `cancellation_tier` set and `nights` equal to the intent's, one `booking_events` row `confirmed`, intent `paid`.
  - `convert is idempotent`: second call → same `bookingId`, `firstTime: false`, still one booking.
  - `late payment on a free room confirms`: intent `expired`, stock still free → `confirmed`.
  - `late payment on a taken room is oversold`: intent `expired`, another confirmed booking took the only unit → `{oversold, firstTime:true}`, no booking row; second call → `firstTime:false`.
  - `expire after paid is a no-op`: `expireIntent({force:true})` on a paid intent → `null`, still `paid`.
  - `markIntentRefundedOversold` → `true` once, then `false`.
- [ ] **Step 2: Run** `cd packages/db && bun --env-file=../../.env.local test src/booking-intents-convert.db.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck clean; `bun --env-file=../../.env.local test` for the whole `packages/db` → no regressions.
- [ ] **Step 5: Commit** `Convert a paid booking intent into a confirmed booking`.

---

### Task 12: Webhook and return page

**Files:**
- Modify: `apps/business/lib/stripe-events.ts` (new deps + cases; remove the "deliberately not handled" comment), `apps/business/app/api/stripe/webhook/route.ts` (wire deps)
- Create: `apps/business/lib/booking-confirmation.ts`
- Modify: `apps/web/app/checkout/return/page.tsx` (intent-first outcome, new `oversold` outcome, retry goes back to the hotel)
- Test: `apps/business/lib/stripe-events.test.ts`, `apps/business/lib/booking-confirmation.test.ts`

**Interfaces:**
- Consumes: `convertIntentToBooking`, `markIntentRefundedOversold`, `markIntentFailed`, `expireIntent`, `loadIntentBySession` (Tasks 9, 11); `refundPayment` (`@openbookings/stripe`); booking mail senders (Task 13 — until it lands, pass no-op functions).
- Produces:
  ```ts
  // StripeEventDeps additions
  onCheckoutPaid?: (i: { eventId: string; intentId: string; sessionId: string; paymentIntentId: string; stripeAccountId: string; amountCents: number }) => Promise<void>;
  onCheckoutFailed?: (i: { intentId: string }) => Promise<void>;
  onCheckoutExpired?: (i: { intentId: string }) => Promise<void>;
  // booking-confirmation.ts
  export type ConfirmationDeps = { db: LifecycleDb; refund: typeof refundPayment; now: () => Date;
    sendConfirmed: (bookingId: string) => Promise<void>; sendOversold: (intentId: string) => Promise<void> };
  export async function confirmPaidCheckout(i: Parameters<NonNullable<StripeEventDeps['onCheckoutPaid']>>[0], deps: ConfirmationDeps): Promise<void>;
  ```
- Event routing: `checkout.session.completed` with `payment_status === 'paid'` → `onCheckoutPaid`; `completed` with `'unpaid'` → ignored (async method pending); `checkout.session.async_payment_succeeded` → `onCheckoutPaid`; `async_payment_failed` → `onCheckoutFailed`; `checkout.session.expired` → `onCheckoutExpired` (uses `expireIntent({force:true})`). `intentId` = `metadata.bookingIntentId`; missing → ignored. `amountCents = amount_total`; `paymentIntentId = payment_intent` (string).
- `confirmPaidCheckout`: `convertIntentToBooking`; `confirmed && firstTime` → `sendConfirmed` (errors logged, never thrown — the booking stands); `oversold` → `refund({ paymentIntentId, stripeAccountId, amountCents, idempotencyKey: 'oversold:' + intentId, metadata: { intentId, reason: 'oversold' } })` (throws → webhook retries), then `markIntentRefundedOversold`; if it returned `true` → `sendOversold`.
- Return page: signed-in user + `session_id` → `loadIntentBySession`; `paid` → paid outcome with action `{ href: '/bookings/' + bookingId, label: 'View booking' }`; `oversold`/`refunded_oversold` → new outcome "Those rooms were just taken" / "Your payment was refunded in full…"; otherwise the existing Stripe-status logic using `intent.paymentAccountId`. `RETRY.href` → the hotel page with the same dates and party, built from `intent.propertySlug`, the intent's dates and its rooms' guest counts (`/p/<slug>?checkin=…&checkout=…&adults=…&children=…&rooms=…`).

- [ ] **Step 1: Failing tests**: `stripe-events.test.ts` — each of the five event shapes calls the right dep with the right fields; missing `bookingIntentId` → `"ignored"`; `completed` + `unpaid` → `"ignored"`; livemode mismatch still `"ignored"`. `booking-confirmation.test.ts` (fakes for every dep): `oversold refunds once across retries` — two calls on an oversold result → `refund` called twice with the same idempotency key, `sendOversold` once; confirmed first time → `sendConfirmed` once; confirmed again → not sent; `sendConfirmed` throwing does not throw out.
- [ ] **Step 2: Run** `cd apps/business && bun test lib/stripe-events.test.ts lib/booking-confirmation.test.ts` → FAIL.
- [ ] **Step 3: Implement** handler cases, `confirmPaidCheckout`, route wiring, return page.
- [ ] **Step 4: Run** → PASS; typecheck `apps/business`, `apps/web` → clean.
- [ ] **Step 5: Manual end-to-end** (local, `TESTING=true` in both apps' env, `stripe listen --forward-connect-to localhost:<business port>/api/stripe/webhook`): search Lisbon → hotel `normal` → `POST /api/booking-intents` from the browser console with two rooms → `/checkout/<id>` → pay with `4242 4242 4242 4242` → return page links to `/bookings/<id>` showing two rooms. **No emails are expected yet**: the senders are no-ops until Task 13, so silence here is not a bug. Record the result in the commit message.
- [ ] **Step 6: Commit** `Confirm bookings from the Stripe webhook`.

---

### Task 13: Booking emails

**Files:**
- Create: `packages/mailing/src/booking-mail.ts` (pure composers, export from `index.ts`), `apps/business/lib/mailing/booking-mail.ts` (load data + send for confirmation/oversold/host-new-booking), `apps/web/lib/mailing/booking-mail.ts` (cancellation sends from the guest side)
- Create: `packages/demo/src/recipients.ts`
- Modify: the cancel call sites — `apps/web/app/bookings/[booking-ref]/_lib/actions.ts`, the host cancel action under `apps/business/app/(dashboard)/dashboard/bookings/reservations/` (find the `cancelRooms(` call), `apps/admin` booking actions (find `cancelRooms(`) — after a successful `cancelRooms`, call the app's `sendCancellation(bookingId, cancelledReservationIds)`; errors logged, never thrown
- Test: `packages/mailing/src/booking-mail.test.ts`, `packages/demo/src/recipients.db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // packages/mailing — every function returns { subject: string; html: string } using the existing "account-action" template (see apps/web/lib/mailing/account-mail.ts compose())
  export type MailRoom = { name: string; ratePlan: string; guests: string; freeCancellationUntil: string | null };
  export function guestBookingConfirmed(i: { propertyName: string; checkIn: string; checkOut: string; rooms: MailRoom[]; total: string; bookingUrl: string }): { subject: string; html: string };
  export function guestOversoldRefunded(i: { propertyName: string; amount: string; searchUrl: string }): { subject: string; html: string };
  export function hostNewBooking(i: { propertyName: string; guestName: string; checkIn: string; checkOut: string; rooms: MailRoom[]; total: string; reservationsUrl: string }): { subject: string; html: string };
  export function guestBookingCancelled(i: { propertyName: string; rooms: string[]; refund: string; bookingUrl: string }): { subject: string; html: string };
  export function hostBookingCancelled(i: { propertyName: string; guestName: string; rooms: string[]; reservationsUrl: string }): { subject: string; html: string };
  // packages/demo
  export async function hostRecipients(db: Queryable, i: { propertyId: string; guestEmail: string; testing: boolean }): Promise<string[]>;
  ```
- `hostRecipients`: `is_demo` property and `testing` → `[guestEmail]`; otherwise the org owners' emails (same query shape as `onExternalAccountChanged` in the webhook route). Dates in mail as "Fri 12 Mar 2027"; money via the euro formatter used for refunds (`28e7d76`: English formatting for euro refunds — reuse it).
- Senders use `getEmailClient().from(FROM_ADDRESS).to(to).subject(subject).html(html).send()`, as in `apps/business/lib/mailing/payout-change-alert.ts`. Wire `sendConfirmed`/`sendOversold` (Task 12 deps) to the business senders; `sendConfirmed` sends the guest mail and the host mail.

- [ ] **Step 1: Failing tests**: each composer escapes a property name `"<b>&"`; `guestBookingConfirmed` html contains every room name and the booking URL; subject of `guestBookingConfirmed` is `Booking confirmed: <property>`; `hostRecipients` for a demo property with `testing: true` → `['guest@example.com']`, with `testing: false` → owners only.
- [ ] **Step 2: Run** `cd packages/mailing && bun test src/booking-mail.test.ts` (add `"test": "bun test"` to its `package.json`); `cd packages/demo && bun --env-file=../../.env.local test src/recipients.db.test.ts` → FAIL.
- [ ] **Step 3: Implement** composers, recipients, senders and call-site wiring.
- [ ] **Step 4: Run** → PASS; typecheck `packages/mailing`, `packages/demo`, `apps/web`, `apps/business`, `apps/admin` → clean.
- [ ] **Step 5: Commit** `Send booking confirmation and cancellation emails`.

---

### Task 14: Demo hosts and reset

**Files:**
- Create: `packages/demo/src/membership.ts`, `packages/demo/scripts/reset-demo.ts` (+ `"demo:reset"` script in `packages/demo/package.json`)
- Modify: `apps/business/app/(dashboard)/layout.tsx` (or the closest server layout that has the session; awaited, only when `isTestingMode()`), and the onboarding wall check if a demo member without their own org would be sent to onboarding (`apps/business/lib/onboarding-wall.ts`)
- Test: `packages/demo/src/membership.db.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function ensureDemoMembership(db: Queryable, i: { userId: string }): Promise<void>; // ensureDemoOrganisation + member(role 'owner') if missing; idempotent
  export async function resetDemoData(db: LifecycleDb): Promise<{ properties: number; bookings: number; intents: number }>;
  ```
- `resetDemoData` deletes, in FK-safe order, everything hanging off `is_demo` properties: intents (cascade rooms), `refunds`, `transactions`, `booking_events`, `reservations`, `bookings`, message threads for those bookings, `room_inventory`, restrictions, modifiers, overrides, images, rate plans, rooms, tourist-tax rules, `property_access`, properties. Keeps the demo organisation and its members.
- Membership is added on every dashboard render in testing mode (cheap `INSERT … ON CONFLICT DO NOTHING`), so it is there on the first page after sign-in. A guest (`account_type 'private'`) never reaches this layout.

- [ ] **Step 1: Failing tests**: `ensureDemoMembership` twice → one `member` row, role `owner`; `resetDemoData` after `ensureDemoHotels` + one converted intent → counts > 0 and no `is_demo` property left, non-demo `seedProperty` untouched.
- [ ] **Step 2: Run** `cd packages/demo && bun --env-file=../../.env.local test src/membership.db.test.ts` → FAIL.
- [ ] **Step 3: Implement**; wire the layout call.
- [ ] **Step 4: Run** → PASS; typecheck `packages/demo`, `apps/business` → clean. Manual: with testing on, sign in to business as a host → demo hotels and the Task 12 booking show under reservations.
- [ ] **Step 5: Commit** `Give hosts the demo organisation in testing mode, add demo reset`.

---

### Task 15: Remove superseded demo pieces

**Files:**
- Delete: `apps/web/lib/demo-data.ts` and every `isDemoMode` / `getDemoSearchResults` / demo branch (`SearchClient.tsx`, `hotel-page-data.ts`, any test referencing them)
- Modify: `packages/db/seed/demo-booking.ts` (drop the pending booking `DEMO_BOOKING_ID` and its reservation/rate plan; keep the confirmed two-room booking), `apps/web/proxy.ts` (fix the stale "/bookings is a dead stub" comment), `apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx` (leave the hard-coded `NIGHTS`; part 2 replaces it — only update its comment to point at `/api/stay-quote`), env examples (drop `NEXT_PUBLIC_DEMO_DATA`)
- Test: existing suites

- [ ] **Step 1: Search** `rg -n "NEXT_PUBLIC_DEMO_DATA|isDemoMode|demo-data|CHECKOUT_BOOKING_ID|DEMO_BOOKING_ID" apps packages` → list every hit.
- [ ] **Step 2: Remove** each hit's dead branch.
- [ ] **Step 3: Run** `bun run typecheck` and `bun run test` at the repo root → all green (DB suites with the env file where needed), and the same `rg` → no hits except this plan/spec.
- [ ] **Step 4: Commit** `Remove the in-memory demo mode and the fixed checkout booking`.

---

## After this plan

Part 2 (separate plan, after Wouter approves a Mobbin-based concept artifact): property-page date/guest picker reading the URL, room selection with quantities and per-room guests calling `/api/stay-quote` and `POST /api/booking-intents`, sign-in interruption that keeps the selection, search-card and room-card unavailable states with reasons, "3 of 8 left" in the host grid and on room cards, checkout and return page restyle, email visual design.

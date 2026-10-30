# Cancellation Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text refundable flag with Annex B's cancellation tiers end to end: a tier per property, Non-refundable as a separate rate type, a policy snapshot on every reserved room, one tested refund calculator, Stripe refunds, and guest and host screens to cancel rooms or record check-ins, no-shows and early departures.

**Architecture:** The pure rules live in `packages/pricing/src/cancellation.ts` (snapshot builder, refund calculator, allowed actions) and `cancellation-copy.ts` (guest/host wording). `packages/db/src/booking-lifecycle.ts` is the only code that changes booking state or records refunds. Stripe is injected as a `refund` dependency, the same way `apps/business/lib/stripe-events.ts` takes its deps. The apps call the lifecycle from server actions.

**Tech Stack:** Bun test, Postgres (hand-applied idempotent SQL in `packages/db/drizzle/`, mirrored in drizzle `schema.ts`), Next.js server actions, Stripe Connect direct charges, `Intl` for time zones (no new dependency).

**Spec:** `docs/superpowers/specs/2026-10-30-cancellation-tiers-design.md`

## Global Constraints

- Money in the DB and in `packages/pricing` is in MAJOR units (euros, 2 decimals). Cents exist only at the Stripe boundary.
- Refunds round to the cent **in the guest's favour** (round the refund up).
- A no-show refunds **nothing**, tourist tax included, on every tier.
- Tourist tax for nights not stayed is refunded on every other event, Non-refundable included.
- Percentages apply to night prices only, never tourist tax.
- Every deadline a guest sees is an exact date and time in the property's time zone, e.g. `Tue 3 Nov 2026, 15:00`.
- Refund logic reads only the reservation snapshot, never the current property tier or rate plan.
- `POLICY_VERSION = "annex-b-2026-10-30"`.
- EUR only.
- Migrations: plain SQL, idempotent, applied by hand. `0027` also drops `rate_plans.cancellation_policy` and `property_content.free_cancellation_days` (no live bookings).
- Commits: one per task, message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **DST and time zones:** a check-in on the night clocks change, or a property outside Amsterdam, must produce the right UTC instant. Pinned in Task 2 (`localTimeToUtc` around 2026-10-25 Europe/Amsterdam, plus Europe/Lisbon).
2. **Cancelling exactly on a deadline:** "at least 24h before" includes the deadline instant itself. Pinned in Task 2 (boundary tests at `fullRefundUntil` and 1ms after).
3. **Cancelling twice, or cancelling an already-cancelled room:** a double-click or a second tab must not refund twice. Pinned in Task 7 (second call returns `already_cancelled`, one `refunds` row, Stripe called once).
4. **Goodwill refund larger than what's left:** an amount above the unrefunded balance is capped, not sent to Stripe. Pinned in Task 7.
5. **Non-refundable rate whose refundable sibling is deactivated or archived:** must be blocked, or the Non-refundable rate silently breaks B.4. Pinned in Task 4 (db test).

---

### Task 1: Migration 0027 and drizzle schema

**Files:**
- Create: `packages/db/drizzle/0027_cancellation_tiers.sql`
- Modify: `packages/db/src/schema.ts` (enums at top, `properties`, `ratePlans`, `propertyContent`, `bookings`, `reservations`, new `refunds`)
- Modify: `apps/business/app/(dashboard)/dashboard/listings/_lib/pending-migrations.ts` (add `"0027_cancellation_tiers.sql"` to `PENDING`)
- Modify: `apps/web/sql/ddl.sql` (reference DDL: mirror the same changes)

**Interfaces — Produces:**
- Enums:
  - `cancellation_tier` (`flex`, `standard`, `limited`)
  - `reservation_cancellation_tier` (`flex`, `standard`, `limited`, `non_refundable`)
  - `refund_reason` (`guest_cancellation`, `early_departure`, `host_cancellation`, `property_unable`, `travel_restriction`, `goodwill`)
  - `booking_status` gains `checked_in`
- `properties.cancellation_tier cancellation_tier NOT NULL DEFAULT 'standard'`
- `bookings`:
  - `confirmed_at timestamptz NULL`
  - `departed_early_on date NULL`
- `reservations`:
  - `cancellation_tier reservation_cancellation_tier NULL`
  - `check_in_at timestamptz NULL`
  - `grace_until timestamptz NULL`
  - `full_refund_until timestamptz NULL`
  - `partial_refund_until timestamptz NULL`
  - `nights jsonb NOT NULL DEFAULT '[]'`, with CHECK `jsonb_typeof(nights)='array'`
  - `policy_version text NULL`
  - `cancelled_at timestamptz NULL`
  - The snapshot columns are nullable because pending (unpaid) reservations have no snapshot yet.
- `refunds`:
  - `id uuid pk default gen_random_uuid()`
  - `booking_id uuid NOT NULL → bookings`
  - `reservation_id uuid NULL → reservations`
  - `reason refund_reason NOT NULL`
  - `accommodation_amount numeric(10,2) NOT NULL`
  - `tourist_tax_amount numeric(10,2) NOT NULL`
  - `amount numeric(10,2) NOT NULL`, with CHECK `amount = accommodation_amount + tourist_tax_amount AND amount >= 0`
  - `breakdown jsonb NOT NULL DEFAULT '{}'`
  - `status payment_status NOT NULL DEFAULT 'pending'`
  - `stripe_refund_id varchar(255) NULL`
  - `idempotency_key varchar(255) NOT NULL UNIQUE`
  - `created_by text NULL`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - index on `booking_id`
- Drop `rate_plans.cancellation_policy` and `property_content.free_cancellation_days`.
- Drizzle exports `cancellationTierEnum`, `reservationCancellationTierEnum`, `refundReasonEnum`, `refunds`.

- [ ] **Step 1: Write the SQL.** Copy the header style of `0026_tourist_tax.sql`: say what, why, "Apply BY HAND … Idempotent."
  - Create enums with `DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object THEN null; END $$;`.
  - `ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'checked_in';`, with a comment that the new value can't be used in the same transaction, so DB tests that write `checked_in` need 0027 applied to the dev database first.
  - Use `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `DROP COLUMN IF EXISTS`.
- [ ] **Step 2: Mirror it in `schema.ts`.** Keep the existing comment style: one line per new column saying why, with `(0027)`. Remove `cancellationPolicy` and `freeCancellationDays`.
- [ ] **Step 3: Run `bun run typecheck` from the repo root.** Expected: errors only in files that read the dropped columns. List them; Tasks 4–6 and 8 remove each one. Don't fix them here.
- [ ] **Step 4: Commit** `Add cancellation tiers migration and schema`. The repo typecheck stays red until Task 8. Say so in the commit body.

---

### Task 2: Refund calculator and snapshot builder (pure)

**Files:**
- Create: `packages/pricing/src/cancellation.ts`
- Create: `packages/pricing/src/cancellation.test.ts`
- Modify: `packages/pricing/src/index.ts` (re-export)

**Interfaces — Produces:**
```ts
export const POLICY_VERSION = "annex-b-2026-10-30";
export type PropertyCancellationTier = "flex" | "standard" | "limited";
export type CancellationTier = PropertyCancellationTier | "non_refundable";
export interface NightValue { date: string; price: number; touristTax: number } // date = YYYY-MM-DD, the night starting that day
export interface PolicySnapshot {
  tier: CancellationTier; confirmedAt: Date; checkInAt: Date;
  graceUntil: Date | null; fullRefundUntil: Date | null; partialRefundUntil: Date | null;
  policyVersion: string;
}
export function snapshotTier(propertyTier: PropertyCancellationTier, isRefundable: boolean): CancellationTier;
export function localTimeToUtc(date: string, time: string, timeZone: string): Date; // time "HH:MM" or "HH:MM:SS"
export function buildPolicySnapshot(i: { tier: CancellationTier; timeZone: string; checkInTime: string; arrivalDate: string; confirmedAt: Date }): PolicySnapshot;
export type RefundEvent =
  | { kind: "guest_cancellation"; at: Date }
  | { kind: "early_departure"; lastNightStayed: string }
  | { kind: "no_show" }
  | { kind: "host_cancellation" | "property_unable" | "travel_restriction" };
export type RefundRule = "grace_period" | "full_refund_window" | "partial_refund_window" | "no_refund_window" | "early_departure" | "no_show" | "full_refund_carve_out";
export interface Amounts { accommodation: number; touristTax: number; total: number }
export interface RefundResult { rule: RefundRule; refund: Amounts; retained: Amounts; nightsRefunded: { date: string; share: number }[] } // share 0..1 of that night's price
export function calculateRefund(s: PolicySnapshot, nights: NightValue[], e: RefundEvent): RefundResult;
export function nonRefundableQualifies(nonRefundableTotal: number, refundableTotals: number[]): boolean; // true iff some r with nonRefundableTotal <= r * 0.9 (to the cent)
```

**Snapshot rules:**
- `checkInAt = localTimeToUtc(arrivalDate, checkInTime || "15:00", timeZone)`
- `fullRefundUntil`:
  - flex: `checkInAt − 24h`
  - standard: `checkInAt − 5d`
  - limited: `checkInAt − 14d`
  - non_refundable: `null`
- `partialRefundUntil`: limited `checkInAt − 7d`, otherwise `null`
- `graceUntil`:
  - `null` for non_refundable
  - otherwise `min(confirmedAt + 24h, checkInAt − 7d)`, and `null` if that is earlier than `confirmedAt`
- "d" means 24h × n. Annex B counts in hours.

**Refund rules by event** (refund rounded up to the cent; `retained = paid − refund` for each part):
- **Carve-outs** (host cancellation, property unable, travel restriction): everything. `rule = "full_refund_carve_out"`.
- **No-show:** zero. `rule = "no_show"`.
- **Guest cancellation at `t`:** all tourist tax is refunded, plus:
  - `t ≤ graceUntil`: full refund, `grace_period`
  - else `fullRefundUntil` set and `t ≤ fullRefundUntil`: full refund, `full_refund_window`
  - else by tier:
    - flex: every night after the first
    - standard: 50% of every night after the first
    - limited and `t ≤ partialRefundUntil`: 50% of all nights
    - limited after that, and non_refundable: nothing
  - Rule: `partial_refund_window` if anything accommodation-related is refunded, otherwise `no_refund_window`.
- **Early departure:** the unused nights are those with `date > lastNightStayed`. Tourist tax is refunded for all unused nights, plus:
  - flex: unused nights after the first
  - standard: 50% of unused nights after the first
  - limited: unused nights after the first 7
  - non_refundable: none
  - `rule = "early_departure"`

- [ ] **Step 1: Write the failing tests** in `cancellation.test.ts`. Fixture: 5 nights from `2026-11-10` at €100, `touristTax: 3`, property `Europe/Amsterdam`, `checkInTime "15:00"`, `confirmedAt` = 2026-10-01T10:00Z unless stated.
  - `localTimeToUtc`:
    - `("2026-11-03","15:00","Europe/Amsterdam")` → `2026-11-03T14:00:00.000Z`
    - `("2026-07-01","15:00","Europe/Amsterdam")` → `13:00Z`
    - `("2026-10-25","15:00","Europe/Amsterdam")` → `14:00Z` (the DST-change day)
    - `("2026-07-01","15:00","Europe/Lisbon")` → `14:00Z`
  - `buildPolicySnapshot`:
    - flex `fullRefundUntil` = checkInAt − 24h
    - limited `partialRefundUntil` = checkInAt − 7d
    - non_refundable has every deadline `null`
    - grace is `null` when confirmed 3 days before check-in
    - grace is `confirmedAt + 24h` when confirmed 30 days before
  - The Annex B table, one test each (refund total):
    - Flex, 2 days before → 515
    - Flex, 10h before → 415
    - Standard, 3 days before → 215
    - Limited, 10 days before → 265
    - Limited, 3 days before → 15
    - Non-refundable, any time → 15
    - travel_restriction → 515
  - `no_show` on flex → refund total 0 and retained total 515.
  - Boundary: flex cancelled at exactly `fullRefundUntil` → 515; 1ms later → 415.
  - Grace beats the window: Limited, confirmed 20 days before check-in, cancelled 2h later (inside grace, outside 14d) → 515.
  - Early departure, Limited, 10 nights, `lastNightStayed` = night 2 → accommodation refund 100 (night 10), tourist tax 24 (nights 3–10).
  - Rounding: Standard with nights `[33.33, 33.33, 33.33]`, cancelled 1 day before → accommodation refund `33.33` (50% of 66.66 = 33.33 exactly). With `[33.33, 33.33, 33.34]` → `33.34` (33.335 rounds up).
  - `nonRefundableQualifies`: `(90, [100])` → true; `(90.01, [100])` → false; `(80, [85, 100])` → true; `(50, [])` → false.
- [ ] **Step 2: Run** `cd packages/pricing && bun test src/cancellation.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `cancellation.ts`.
  - `localTimeToUtc`: guess the UTC instant, read the zone's offset at that instant with `Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23", year..second })`, correct once, then re-check the offset (handles DST).
  - Do the arithmetic in integer cents internally: refund cents = `Math.ceil(raw * 100 - 1e-9)`.
- [ ] **Step 4: Run tests.** Expected: PASS. Also `bun run typecheck` in `packages/pricing`.
- [ ] **Step 5: Commit** `Add cancellation refund calculator`.

---

### Task 3: Nightly tourist tax, policy wording, allowed actions (pure)

**Files:**
- Modify: `packages/pricing/src/tourist-tax.ts` + `tourist-tax.test.ts`
- Create: `packages/pricing/src/cancellation-copy.ts` + `cancellation-copy.test.ts`
- Modify: `packages/pricing/src/cancellation.ts` + test (add `allowedActions`)

**Interfaces — Produces:**
```ts
// tourist-tax.ts
export function touristTaxByNight(rules: TouristTaxRule[], stay: TouristTaxStay): number[];
// cancellation-copy.ts
export const TIER_LABELS: Record<CancellationTier, string>; // Flex, Standard, Limited, Non-refundable
export const TIER_SUMMARIES: Record<CancellationTier, string>;
export function formatDeadline(d: Date, timeZone: string): string; // "Tue 3 Nov 2026, 15:00"
export function describePolicy(s: PolicySnapshot, timeZone: string, now: Date): string[];
// cancellation.ts
export type BookingAction = "cancel" | "mark_checked_in" | "mark_no_show" | "record_early_departure" | "goodwill_refund";
export function allowedActions(i: { status: "pending"|"confirmed"|"checked_in"|"cancelled"|"completed"|"no_show"; checkInAt: Date; checkInClosesAt: Date; checkOutDate: string; now: Date }): BookingAction[];
export function checkInClosesAt(i: { arrivalDate: string; checkInUntil: string | null; timeZone: string }): Date; // checkInUntil on arrival day, else 00:00 the next day
```

- `touristTaxByNight` returns one amount per night. Per-night charges go to their night. Once-per-stay charges go to night 0. Each amount is rounded to 2 decimals, and any rounding difference goes to night 0, so `sum === calculateTouristTax(...).total` exactly.
- `TIER_SUMMARIES`, exact copy:
  - flex: `"Free cancellation until 24 hours before check-in. After that, the first night is charged."`
  - standard: `"Free cancellation until 5 days before check-in. After that, the first night and half of the other nights are charged."`
  - limited: `"Free cancellation until 14 days before check-in, 50% refund until 7 days before. After that, no refund."`
  - non_refundable: `"No refund if you cancel. Cheaper than the refundable rate."`
- `describePolicy` returns these lines in order, skipping any line whose deadline is `≤ now`:
  1. grace, only when `graceUntil` is later than `fullRefundUntil` (or that is null): `Full refund if you cancel by {graceUntil}.`
  2. `Free cancellation until {fullRefundUntil}.`
  3. limited only: `50% refund if you cancel by {partialRefundUntil}.`
  4. The tier's after-deadline line:
     - flex: `After that, the first night is charged and the other nights are refunded.`
     - standard: `After that, the first night and half of the other nights are charged.`
     - limited: `After that, no refund.`
     - non_refundable: `This rate is non-refundable.`
  5. Always: `Tourist tax is refunded for nights you don't stay.`
  6. Always: `If you don't show up, nothing is refunded.`
- `allowedActions`:
  - `confirmed`:
    - always: `cancel`, `goodwill_refund`
    - from `now ≥ checkInAt − 24h`: `mark_checked_in`
    - from `now ≥ checkInClosesAt`: `mark_no_show`
    - from `now ≥ checkInAt` until the check-out date: `record_early_departure`
  - `checked_in`: `record_early_departure` (before the check-out date), `goodwill_refund`
  - `completed`: `goodwill_refund`
  - everything else: `[]`

- [ ] **Step 1: Write the failing tests.**
  - `touristTaxByNight`: €3 per person per night, 2 adults, 3 nights → `[6,6,6]`. Adding a once-per-stay €5 → `[11,6,6]`. Sum equals `calculateTouristTax` for a 12.5% charge on prices `[99.99, 99.99, 99.99]`.
  - `formatDeadline(new Date("2026-11-03T14:00:00Z"), "Europe/Amsterdam")` → `"Tue 3 Nov 2026, 15:00"`.
  - `describePolicy`:
    - flex snapshot, now well before → exactly lines 2, 4, 5 and 6
    - non_refundable → `["This rate is non-refundable.", <5>, <6>]`
    - limited with `now` after `fullRefundUntil` → no line 2
  - `allowedActions`:
    - confirmed, 2 days before → `["cancel","goodwill_refund"]`
    - confirmed, after `checkInClosesAt` → includes `mark_no_show` and `record_early_departure`
    - cancelled → `[]`
- [ ] **Step 2: Run** `cd packages/pricing && bun test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `formatDeadline` uses `Intl.DateTimeFormat("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", hourCycle:"h23", timeZone })`, then removes the commas `en-GB` puts between date parts so the output matches exactly.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add policy wording, nightly tourist tax and booking actions`.

---

### Task 4: Business app — property tier picker and Non-refundable rates

**Files:**
- Modify (`listings/property/`):
  - `_lib/schema.ts`
  - `_lib/schema.test.ts`
  - `_lib/types.ts`
  - `_lib/query.ts`
  - `_lib/actions.ts`
  - `_lib/completion.test.ts`
  - `_components/sections/policies.tsx`
- Modify (`listings/rooms/`):
  - `_lib/schema.ts`
  - `_lib/types.ts`
  - `_lib/query.ts`
  - `_lib/mutations.ts`
  - `_lib/mutations.db.test.ts`
  - `_components/rate-sheet.tsx`
- Modify (`listings/rates-availability/`):
  - `_lib/types.ts`
  - `_lib/ari-query.ts`
  - `_lib/actions.ts`
  - `_lib/mock-ari.ts`
  - `_components/ari-grid.tsx`
  - `_components/ari-detail-panel.tsx`
  - `_components/edit-dialogs.tsx`
  - the matching tests

**Interfaces:**
- Consumes: `PropertyCancellationTier`, `TIER_LABELS`, `TIER_SUMMARIES` (Task 3).
- Produces: the `policiesSchema` field `cancellationTier: z.enum(["flex","standard","limited"])`, which replaces `freeCancellationDays`. The rate form field `refundable: "true"|"false"` replaces `cancellationText`.
- Produces: a new rate save error, under `fieldErrors.refundable`: `"A non-refundable rate needs a refundable rate on this room that costs at least 10% more."`

**Rules:**
- Saving an active rate with `is_refundable=false` requires another active, non-archived rate on the same room with `is_refundable=true` and `bar ≥ nr.bar / 0.9` (`nonRefundableQualifies(nr.bar, refundableBars)`).
- Deactivating, archiving or switching to non-refundable the last refundable rate that a still-active Non-refundable rate depends on is refused, with: `"This room's non-refundable rate depends on this rate. Change or deactivate that one first."`
- Keep the existing new-rate default `is_refundable=false` behaviour only if it doesn't trip the rule. A new rate is inactive until priced, and the rule applies to active rates only.

- [ ] **Step 1: Write the failing tests.**
  - `property/_lib/schema.test.ts`: `cancellationTier: "flex"` parses; `"strict"` and missing both fail.
  - `rooms/_lib/mutations.db.test.ts` (real-Postgres suite; uses `applyPendingMigrations`):
    - activating an NR rate with no refundable sibling → error on `refundable`
    - NR at 90 next to refundable 100 → saves
    - NR at 95 next to refundable 100 → error
    - archiving the only refundable sibling of an active NR → refused
- [ ] **Step 2: Run** `cd apps/business && bun test app/\(dashboard\)/dashboard/listings/property app/\(dashboard\)/dashboard/listings/rooms`. Expected: FAIL. The DB suites are skipped without `DATABASE_URL`. If skipped locally, say so in the report.
- [ ] **Step 3: Implement the data side.**
  - Policies: read and write `properties.cancellation_tier` (it's on `properties`, not `property_content`). Remove every `freeCancellationDays` / `free_cancellation_days` path.
  - Rates: map `refundable` ⇄ `is_refundable`, remove `cancellationText` / `cancellation_policy` from the schema, query, types and mutations, and add both guards inside the existing save, archive and activate transactions.
  - R&A: drop `cancellation_policy` from `ari-query.ts`, its types and mocks. `is_refundable` stays.
- [ ] **Step 4: Implement the UI.**
  - `policies.tsx`: replace the "Coming soon" block with a radio-card group of the three tiers. Each card shows `TIER_LABELS[t]` + `TIER_SUMMARIES[t]`. Below it: `"Changes apply to new bookings only. Existing bookings keep the policy they were booked with."` Use the existing shadcn `RadioGroup`/`Field` components (check `components/ui`).
  - `rate-sheet.tsx`: replace the "Cancellation policy" textarea with a two-option radio:
    - `Refundable — follows your property's policy ({TIER_LABELS[propertyTier]})`
    - `Non-refundable`
    - When Non-refundable is selected, show `TIER_SUMMARIES.non_refundable` + `"Must be at least 10% cheaper than a refundable rate on this room."`
    - The room editor loader must pass `propertyTier`.
  - `ari-grid.tsx`: a small `NR` badge next to the names of Non-refundable rates.
- [ ] **Step 5: Run** `cd apps/business && bun test && bun run typecheck`. Expected: PASS. No typecheck errors left in `apps/business` except files Tasks 7/9 replace.
- [ ] **Step 6: Commit** `Hosts pick a cancellation tier; non-refundable rates are guarded`.

---

### Task 5: Web app — guests see the tier before booking

**Files:**
- Modify:
  - `apps/web/lib/hotel-page-query.ts`
  - `apps/web/lib/hotel-page-data.ts`
  - `apps/web/lib/search-results.ts`
  - `apps/web/lib/demo-data.ts`
  - `apps/web/app/api/query/route.ts`
  - `apps/web/components/search/stay-poster-data.ts`
  - `apps/web/app/p/[hotel_slug]/_components/constants.ts`
  - `apps/web/app/p/[hotel_slug]/_components/PoliciesSection.tsx`
  - `apps/web/app/p/[hotel_slug]/_components/RoomsCarousel.tsx`
  - `packages/pricing/src/calculator.ts` (`RoomRow`: drop `cancellation_policy`, add `cancellation_tier: CancellationTier`)
  - the matching `*.test.ts`

**Interfaces:**
- Consumes: `snapshotTier`, `buildPolicySnapshot`, `describePolicy`, `nonRefundableQualifies`, `TIER_LABELS` (Tasks 2–3).
- Produces: each rate on the hotel page carries `cancellation_tier: CancellationTier` and `policy_lines: string[]`, built with `confirmedAt = now` for the searched arrival date. The hotel object carries `cancellation_tier: PropertyCancellationTier` and `timezone`.

**Rules:**
- Hide a Non-refundable rate from the room's list when `!nonRefundableQualifies(nrStayTotal, refundableStayTotals)` for the searched stay (stay totals from the calculator, excluding tourist tax). With no dates searched, compare BAR.
- Search cards keep the `refundable` boolean, true when the cheapest *shown* rate is refundable.

- [ ] **Step 1: Write the failing tests.**
  - `hotel-page-data.test.ts`:
    - a room with refundable €100 and NR €95 for the stay → the NR rate is absent
    - with NR €90 → present, with `cancellation_tier: "non_refundable"`
    - a refundable rate on a `limited` property has `cancellation_tier: "limited"` and `policy_lines[0]` starting `"Free cancellation until "`
  - `search-results.test.ts` / `listing-prices.test.ts`: update the fixtures to the new fields; existing assertions still pass.
- [ ] **Step 2: Run** `cd apps/web && bun test lib`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - SQL: select `p.cancellation_tier`, `p.timezone`, `p.check_in_time`. Drop `rp.cancellation_policy` / `c.free_cancellation_days`.
  - `PoliciesSection.tsx`: show `TIER_LABELS[tier]` + `TIER_SUMMARIES[tier]`, and if the property has any NR rate, `"Some rates are non-refundable and cheaper."`
  - `RoomsCarousel.tsx`: the rate card's cancellation line = `policy_lines[0]` (or `"Non-refundable"` in the existing red style), with the full `policy_lines` in the existing details/tooltip area. An NR card also shows the saving against its refundable sibling: `"Save €{diff} vs. refundable"`.
  - `demo-data.ts`: convert to the new fields.
- [ ] **Step 4: Run** `cd apps/web && bun test && bun run typecheck`. Expected: PASS, apart from checkout files (Task 6).
- [ ] **Step 5: Commit** `Show cancellation tiers and deadlines to guests`.

---

### Task 6: Snapshot at booking, seed, and checkout

**Files:**
- Create: `packages/db/src/reservation-policy.ts`
- Modify: `packages/db/src/index.ts` (export)
- Modify: `packages/db/package.json` (add `"test": "bun test"` and a `@openbookings/pricing` dependency, if not already present)
- Create: `packages/db/src/reservation-policy.db.test.ts`
- Modify:
  - `packages/db/seed/demo-booking.ts`
  - `apps/web/app/checkout/_lib/booking.ts`
  - `apps/web/app/checkout/page.tsx`
  - `apps/web/app/checkout/_components/TripSummary.tsx`
  - `apps/web/app/checkout/_components/CheckoutClient.tsx` (or whichever component holds the pay button)

**Interfaces — Produces:**
```ts
// Writes the snapshot + nights for every reservation of a booking and sets bookings.confirmed_at / status 'confirmed'.
// Reads property tier/timezone/check_in_time, each rate plan's is_refundable, and tourist tax rules. Idempotent: reservations that already have a snapshot are left alone.
export async function confirmBookingPolicy(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  input: { bookingId: string; confirmedAt: Date; nightPrices: Record<string /*reservationId*/, { date: string; price: number }[]> },
): Promise<void>;
```
- Checkout `StaySummary` replaces `cancellationPolicy: string` + `freeCancellationUntil` with `cancellationTier: CancellationTier`, `policyLines: string[]` (from a snapshot built with `confirmedAt = now`) and `requiresNonRefundableConsent: boolean`.

- [ ] **Step 1: Write the failing DB test** in `reservation-policy.db.test.ts` (same harness as the business db tests: skip without `DATABASE_URL`, transaction + rollback, apply `0027` inside it). Seed a property (`Europe/Amsterdam`, 15:00, `limited`), a refundable rate, a booking with one 3-night reservation.
  - After `confirmBookingPolicy(...)`: `cancellation_tier = 'limited'`, `check_in_at` = arrival 14:00Z (winter), `partial_refund_until` = 7 days earlier, `nights` has 3 entries whose `touristTax` sums to `tourist_tax_amount`, `policy_version = 'annex-b-2026-10-30'`, booking `status = 'confirmed'`, `confirmed_at` set.
  - A second call leaves `check_in_at` unchanged even after the property tier is switched to `flex`.
- [ ] **Step 2: Run** `cd packages/db && bun test`. Expected: FAIL (or SKIP without `DATABASE_URL`; say so).
- [ ] **Step 3: Implement** `confirmBookingPolicy`. Use `touristTaxByNight` for the per-night tax with the reservation's adults/children and `rooms: 1`.
- [ ] **Step 4: Update the seed.**
  - Remove `CANCELLATION_POLICY` and the rate plan's `cancellation_policy` insert.
  - Keep the checkout demo booking `pending` (checkout pays for it).
  - Add a second fixed booking `b0000000-0000-4000-8000-000000000011` with two reservations (`…012`, `…013`) on the same property, check-in 30 days from today, confirmed through `confirmBookingPolicy`, so Tasks 7–9 have a confirmed multi-room booking to work on.
- [ ] **Step 5: Update checkout.**
  - `booking.ts`: select `p.cancellation_tier, p.timezone, p.check_in_time, rp.is_refundable`, and build `policyLines` via `buildPolicySnapshot` + `describePolicy`. Delete `FREE_CANCELLATION_DAYS`.
  - `TripSummary.tsx`: render `policyLines` as a short list under a `TIER_LABELS[tier]` heading.
  - When `requiresNonRefundableConsent`, the pay button stays disabled until a checkbox labelled `"I understand this rate is non-refundable."` is ticked.
- [ ] **Step 6: Run** `bun run typecheck` at the root and `cd apps/web && bun test`. Expected: PASS, apart from the support bot (Task 8).
- [ ] **Step 7: Commit** `Snapshot the cancellation policy at booking; checkout shows it`.

---

### Task 7: Booking lifecycle and Stripe refunds

**Files:**
- Create: `packages/stripe/src/payments/refund.ts`, `refund.test.ts`
- Modify: `packages/stripe/src/index.ts`
- Create: `packages/db/src/booking-lifecycle.ts`, `booking-lifecycle.db.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify availability (cancelled rooms free their dates, checked-in rooms hold them):
  - `apps/business/.../rates-availability/_lib/ari-query.ts:162`: `b.status IN ('confirmed','checked_in','completed') AND res.cancelled_at IS NULL`
  - `apps/business/.../rooms/_lib/mutations.ts:80` `HOLDING_STATUSES` + the three queries using it: add `'checked_in'` and `AND res.cancelled_at IS NULL`
  - Then `grep -rn "join reservations\|JOIN bookings b" apps packages` for any other availability reads, and apply the same to each.

**Interfaces — Produces:**
```ts
// packages/stripe
export function buildRefundParams(i: { paymentIntentId: string; amountCents: number; metadata: Record<string,string> }): Stripe.RefundCreateParams; // refund_application_fee: true, reverse_transfer absent
export async function refundPayment(i: { paymentIntentId: string; stripeAccountId: string; amountCents: number; idempotencyKey: string; metadata: Record<string,string> }): Promise<{ id: string; status: string }>;

// packages/db
export type LifecycleDeps = { refund: typeof refundPayment; now?: () => Date };
export type Actor = { kind: "guest"; userId: string } | { kind: "host"; userId: string };
export type LifecycleResult =
  | { ok: true; refunds: { reservationId: string | null; amount: number; status: "succeeded" | "failed" | "pending" }[] }
  | { ok: false; error: "not_found" | "not_allowed" | "already_cancelled" | "too_early" | "nothing_to_refund" };
// Read-only: what a refund would be, per active room. Default event = guest_cancellation at now.
export function previewRefund(bookingId: string, reservationIds: string[] | null, opts?: { now?: Date; event?: RefundEvent }): Promise<{ perRoom: { reservationId: string; result: RefundResult }[]; total: number } | null>;
export function cancelRooms(deps: LifecycleDeps, i: { bookingId: string; actor: Actor; reservationIds: string[] | null }): Promise<LifecycleResult>;
export function markCheckedIn(deps: LifecycleDeps, i: { bookingId: string; actor: Actor }): Promise<LifecycleResult>;
export function markNoShow(deps: LifecycleDeps, i: { bookingId: string; actor: Actor }): Promise<LifecycleResult>;
export function recordEarlyDeparture(deps: LifecycleDeps, i: { bookingId: string; actor: Actor; lastNightStayed: string }): Promise<LifecycleResult>;
export function issueGoodwillRefund(deps: LifecycleDeps, i: { bookingId: string; actor: Actor; amount: number }): Promise<LifecycleResult>;
```

**Behaviour:**
- **Authorization lives in the callers** (Task 9 checks property access, Task 10 checks booking ownership). The lifecycle trusts `actor` and records `actor.userId` in `created_by` / the audit.
- **`cancelRooms`:**
  - Locks the booking (`SELECT … FOR UPDATE`) and checks `allowedActions` includes `cancel`.
  - Picks the not-yet-cancelled reservations (`null` = all).
  - Calculates each room's refund with `calculateRefund`:
    - guest actor → `guest_cancellation` at `now`
    - host actor → `host_cancellation`
  - Sets `cancelled_at` and inserts a `refunds` row (`pending`, `idempotency_key = refund:<reservationId>:<reason>`) per room with a non-zero refund. When none remain active, sets the booking to `cancelled`, `cancelled_at`, `cancellation_reason`.
  - Commits, then makes **one** Stripe refund for the summed cents, with idempotency key `refund:<bookingId>:<sorted reservation ids joined by ,>`.
  - Updates the rows to `succeeded` + `stripe_refund_id`, or to `failed` (and returns `ok: true` with the failed status: the cancellation stands).
  - Rooms that are all already cancelled → `already_cancelled`.
- **`markNoShow`:** requires `mark_no_show`. Sets `status='no_show'`, `no_show_reported_at`. No refund row, no Stripe call.
- **`markCheckedIn`:** requires `mark_checked_in`. Sets `status='checked_in'`.
- **`recordEarlyDeparture`:**
  - Requires `record_early_departure`, and `lastNightStayed` must be a night of the stay before the last one.
  - Sets `departed_early_on`; `confirmed` becomes `checked_in`.
  - Refunds per active room using the `early_departure` event, with key `refund:<reservationId>:early_departure`.
- **`issueGoodwillRefund`:**
  - Host only.
  - Caps `amount` at `paid − already refunded` (sum of non-failed `refunds.amount` for the booking).
  - A zero cap → `nothing_to_refund`.
  - Records one row with `reservation_id NULL`, `tourist_tax_amount 0`, key `refund:<bookingId>:goodwill:<count of existing goodwill rows>`.
- **Paid amount per room** = sum of `nights[].price + nights[].touristTax`. The Stripe `paymentIntentId` comes from `bookings.stripe_payment_intent_id`, and `stripeAccountId` from the property's connected account (find the column in `schema.ts`). If either is missing, refund rows stay `pending` and the result says `pending`; a seeded booking has no payment.

- [ ] **Step 1: Write the failing Stripe test.** `buildRefundParams({ paymentIntentId:"pi_1", amountCents: 41500, metadata:{bookingId:"b1"} })` equals `{ payment_intent:"pi_1", amount:41500, refund_application_fee:true, metadata:{bookingId:"b1"} }`.
- [ ] **Step 2: Write the failing lifecycle DB tests** (harness as in Task 6). Fixture: the multi-room booking (two rooms, Flex, check-in 10 days out, €100 × 3 nights, €3 tourist tax per night), with a fake `refund` that records calls and returns `{ id: "re_1", status: "succeeded" }`.
  - Guest cancels one room → that room's `cancelled_at` is set, booking still `confirmed`, one `refunds` row of 309 `succeeded`, fake called once with `30900` cents.
  - Guest cancels again with the same room → `already_cancelled`, no new row, fake not called again.
  - Guest cancels the rest → booking `cancelled`.
  - Host cancels (fresh fixture) → each room refunds 309, one Stripe call of `61800`.
  - `markNoShow` before `checkInClosesAt` → `not_allowed`. After it (inject `now`) → status `no_show`, zero `refunds` rows, fake not called.
  - Goodwill of 10000 on a booking with 618 paid → one row of 618. A second goodwill → `nothing_to_refund`.
  - The fake throws → rows `failed`, booking still cancelled.
- [ ] **Step 3: Run** `cd packages/stripe && bun test` and `cd packages/db && bun test`. Expected: FAIL / SKIP.
- [ ] **Step 4: Implement** `refund.ts`. `refundPayment` calls `stripe.refunds.create(buildRefundParams(i), { stripeAccount: i.stripeAccountId, idempotencyKey: i.idempotencyKey })`.
- [ ] **Step 5: Implement** `booking-lifecycle.ts`, using `withTransaction` from `packages/db/src/index.ts`, plus the availability query changes.
- [ ] **Step 6: Run** the tests in both packages and `cd apps/business && bun test`. Expected: PASS.
- [ ] **Step 7: Commit** `Booking lifecycle: per-room cancellation, no-shows, early departure, refunds`.

---

### Task 8: Support bot reads the real tier

**Files:**
- Modify:
  - `packages/db/src/support.ts`
  - `apps/support-bot/src/host/queries.ts`
  - `apps/support-bot/src/host/tools.ts`
  - `apps/support-bot/src/agent/tools.ts`
  - `apps/support-bot/src/agent/prompt.ts`
  - `apps/support-bot/src/testing/mocks.ts`
  - `apps/support-bot/src/agent/tools.test.ts`
  - `apps/support-bot/src/agent/loop.test.ts`
  - `apps/support-bot/README.md`

**Interfaces:**
- Consumes: `snapshotTier`, `TIER_LABELS`, `TIER_SUMMARIES`; reservation snapshot columns.
- Produces: `get_cancellation_policy` returns:
  - `tier`: `TIER_LABELS[...]`
  - `terms`: `TIER_SUMMARIES[...]`
  - for a booked reservation, `deadlines`: `describePolicy` lines from its snapshot
  - always `no_show: "If you don't show up, nothing is refunded."`

- [ ] **Step 1: Update the failing tests.** In `tools.test.ts`, a refundable room on a `standard` property returns `tier: "Standard"`, and an NR room returns `"Non-refundable"`. Delete the `classifyPolicyTier` tests.
- [ ] **Step 2: Run** `cd apps/support-bot && bun test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Select `p.cancellation_tier` and the reservation snapshot columns, and drop `cancellation_policy`.
  - Delete `classifyPolicyTier`.
  - In `prompt.ts`, replace any "Flexible / Moderate / Strict / Firm" wording with the four Annex B tier names and the no-show rule.
- [ ] **Step 4: Run** `bun run typecheck && bun run test` at the repo root. Expected: everything green; the typecheck left red since Task 1 is now clean.
- [ ] **Step 5: Commit** `Support bot explains the Annex B tiers`.

---

### Task 9: Business app — real reservations and host actions

**Files:**
- Create:
  - `apps/business/lib/reservations/query.ts`
  - `apps/business/lib/reservations/actions.ts`
  - `apps/business/lib/reservations/query.db.test.ts`
- Modify:
  - `apps/business/app/(dashboard)/dashboard/bookings/reservations/page.tsx`
  - `apps/business/components/dashboard/reservations-view.tsx`
  - `apps/business/components/dashboard/reservation-detail-panel.tsx`
  - `apps/business/components/dashboard/reservation-status.tsx`
  - `apps/business/components/dashboard/mock-reservations.ts` (keep only `bucketReservations`, retyped to `HostReservation`)

**Interfaces:**
- Consumes: the Task 7 lifecycle functions, `previewRefund`, `allowedActions`, `describePolicy`, `refundPayment`; `PROPERTY_EDIT_ACCESS_SQL` / `memberHasPropertyAccess` from `@openbookings/authz`.
- Produces:
```ts
export type HostReservation = { bookingId: string; reference: string; guestName: string; propertyTimezone: string;
  status: "pending"|"confirmed"|"checked_in"|"cancelled"|"completed"|"no_show";
  checkInDate: string; checkOutDate: string; guests: number; totalAmount: number; refundedAmount: number;
  rooms: { reservationId: string; roomName: string; tierLabel: string; policyLines: string[]; cancelledAt: string | null; paid: number }[];
  actions: BookingAction[] };
export async function loadHostReservations(session: SessionLike): Promise<HostReservation[]>;
// server actions, each re-checks property access for the booking's hotel, then calls the lifecycle with { refund: refundPayment }
export async function hostCancelRooms(bookingId: string, reservationIds: string[] | null): Promise<LifecycleResult>;
export async function hostMarkCheckedIn(bookingId: string): Promise<LifecycleResult>;
export async function hostMarkNoShow(bookingId: string): Promise<LifecycleResult>;
export async function hostRecordEarlyDeparture(bookingId: string, lastNightStayed: string): Promise<LifecycleResult>;
export async function hostGoodwillRefund(bookingId: string, amount: number): Promise<LifecycleResult>;
```
- Status display: map `completed` → "Checked out", `no_show` → "No-show", `cancelled` → "Cancelled".
- `reference` = the first 8 characters of the booking id, uppercase (match the support bot's "short reference" if it defines one; check `apps/support-bot/src/host/queries.ts:101`).

**UI (in the existing detail panel, replacing `ReservationQuickActions`):**
- **Policy:** each room's `tierLabel` + `policyLines`.
- **Action buttons, only those in `actions`:**
  - Mark checked in
  - Mark no-show, which confirms with `"The guest gets no refund. This can't be undone."`
  - Record early departure, with a date picker limited to stay nights except the last; the confirm dialog shows `previewRefund(bookingId, null, { event: { kind: "early_departure", lastNightStayed } })`
  - Cancel booking / Cancel room, per room plus "Cancel all", which confirms with `"The guest gets a full refund of €{x} from your Stripe balance."`
  - Goodwill refund, an amount input capped at `totalAmount − refundedAmount`
- **Error messages:**
  - `not_allowed` → `"That isn't possible for this booking right now."`
  - `already_cancelled` → `"Already cancelled."`
  - A `failed` refund → `"The booking is cancelled, but the refund didn't go through. We'll retry it — contact support if it doesn't arrive."`

- [ ] **Step 1: Write the failing DB test.** `loadHostReservations` returns the seeded multi-room booking for a host with access, with 2 rooms and `actions` containing `cancel`, and returns nothing for a host without access.
- [ ] **Step 2: Run** `cd apps/business && bun test lib/reservations`. Expected: FAIL / SKIP.
- [ ] **Step 3: Implement** the query and actions. Revalidate the reservations path after each action.
- [ ] **Step 4: Implement the UI.** Swap `mockReservations` for `loadHostReservations` in `page.tsx`, keeping `bucketReservations`.
- [ ] **Step 5: Run** `cd apps/business && bun test && bun run typecheck`. Expected: PASS. Then check it in the running app with the `run` skill: open Reservations, open the seeded booking, cancel one room, and confirm the panel shows it cancelled and the booking still confirmed.
- [ ] **Step 6: Commit** `Reservations use real bookings; hosts can cancel, check in, mark no-shows`.

---

### Task 10: Web app — guest booking page with per-room cancel

**Files:**
- Replace: `apps/web/app/bookings/[booking-ref]/page.tsx` (currently a dead-endpoint placeholder)
- Create:
  - `apps/web/app/bookings/[booking-ref]/_lib/load.ts`
  - `apps/web/app/bookings/[booking-ref]/_lib/actions.ts`
  - `apps/web/app/bookings/[booking-ref]/_components/CancelDialog.tsx`
  - `apps/web/app/bookings/[booking-ref]/_lib/load.db.test.ts`
- Replace: `apps/web/app/checkout/confirmation/[booking-ref]/page.tsx` → `redirect(\`/bookings/${ref}\`)`

**Interfaces:**
- Consumes: `getServerSession` (`apps/web/lib/auth.ts`), `previewRefund`, `cancelRooms`, `describePolicy`, `refundPayment`.
- Produces: `loadGuestBooking(bookingId: string, userId: string)`, which returns `null` unless `bookings.user_id = userId`, plus the same room shape as `HostReservation.rooms`. Also `guestCancelRooms(bookingId: string, reservationIds: string[] | null): Promise<LifecycleResult>` (a server action that re-checks ownership).

**Page:**
- Property name, dates, guests and rooms.
- Per room: tier label, `policyLines`, and `Cancel this room` while active.
- `Cancel booking` when more than one room is active.
- The dialog shows the preview before confirming: `"You'll get €{refund} back. The hotel keeps €{retained}."`, or for €0: `"You won't get anything back. The hotel keeps €{retained}."`
- Afterwards the room shows `Cancelled on {date}`, and the refund line `"€{x} refunded to your card. It can take 5–10 days to show."`
- **Not signed in** → redirect to sign-in with a return URL (follow how `apps/web/app/checkout/page.tsx` handles no session).
- **Signed in but not the owner** → `notFound()`.

- [ ] **Step 1: Write the failing DB test.** `loadGuestBooking` returns the seeded booking for its owner and `null` for another user id.
- [ ] **Step 2: Run** `cd apps/web && bun test app/bookings`. Expected: FAIL / SKIP.
- [ ] **Step 3: Implement** load, action, page and dialog, following the checkout page's visual language (components in `apps/web/components/ui`).
- [ ] **Step 4: Run** `cd apps/web && bun test && bun run typecheck`. Expected: PASS. Then check it in the running app with the `run` skill: sign in as the seeded booking's owner, open `/bookings/b0000000-0000-4000-8000-000000000011`, preview and cancel one room.
- [ ] **Step 5: Commit** `Guests can view and cancel their booking per room`.

---

### Task 11: Notion and docs

**Files / pages:**
- Notion pages:
  - "Host Agreement · Annex B: Cancellation Policy Tiers"
  - "Rate Types, No-Shows & Payout Logic"
  - "Guest Terms of Service" §8
  - "Data Storage"
- `apps/business/app/(dashboard)/dashboard/listings/_lib/pending-migrations.ts` comment (no change unless 0027 has been applied to dev)

- [ ] **Step 1: Annex B.**
  - B.1.1 → the Host picks one Tier (Flex, Standard or Limited) for the property. Each Rate Plan is either refundable (follows that Tier) or Non-refundable.
  - B.5.3 → no-show: no refund of any amount, Tourist Tax included.
  - B.5.2 → add "except on a no-show (B.5.3)".
  - Worked examples: add `Any Tier, no-show | €515 | €0`.
  - Close the "Data model" and "No-show refunds" open items, pointing to migration 0027.
  - Add a changelog row dated 30 Oct 2026.
- [ ] **Step 2: Rate Types page.** Update the no-show table row (every tier: nothing refunded), the No-shows section, the lifecycle diagram line, and "What hotels should know" (remove "No-shows can trigger a partial refund…").
- [ ] **Step 3: Guest Terms §8 and Data Storage.** Same changes. Data Storage lists the new columns and the `refunds` table, and removes `cancellation_policy` / `free_cancellation_days`.
- [ ] **Step 4: Flag the in-repo legal terms** (`apps/web/content/legal/terms/2026-10-24/*.mdx`): report that they need a new dated version. Don't edit them.
- [ ] **Step 5: Final verification.** At the repo root, `bun run typecheck && bun run test && bun run lint`. Expected: all green. Report any DB suites that were skipped.

---

## Before running the DB-backed tests

`ALTER TYPE … ADD VALUE` cannot be used in the same transaction that adds it. The lifecycle tests write `checked_in`, so `0027` has to be applied to the dev database first. This is a hand-applied migration on a shared database, so **ask Wouter before applying it** (Neon SQL editor or the Neon MCP `run_sql`). Until then those tests are skipped locally, or fail in CI on that one value.

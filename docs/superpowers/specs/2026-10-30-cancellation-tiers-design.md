# Cancellation tiers — design

**Date:** 2026-10-30 · **Branch:** `feat/cancellation-tiers`
**Source of truth for the rules:** Notion, *Host Agreement · Annex B: Cancellation Policy Tiers* (draft for v1.3), with the changes below that Wouter decided on 2026-10-30.

## Why

Every rate today carries a yes/no "refundable" flag and a free-text policy, and checkout promises "free cancellation until 7 days before" for every refundable rate. Nothing computes a refund. Annex B replaces this with a fixed set of tiers that the platform applies on the host's behalf, so a refund is always a calculation, never a negotiation. This job makes the tiers real: hosts pick one, guests see exact deadlines, and cancellations produce the right refund on Stripe.

## Decisions (Wouter, 2026-10-30)

1. **The base tier is set once per property, not per room or rate:** Flex, Standard or Limited. It applies to every "normal" rate plan.
2. **Non-refundable is a separate type of rate plan,** not a fourth property setting. A rate plan is either *refundable* (follows the property's tier) or *non-refundable*. This is the existing `rate_plans.is_refundable` flag.
3. **No-show = no money back, on every tier.** The hotel keeps everything, **including tourist tax** for the nights not stayed, and OpenBookings keeps its commission. This overrides Annex B B.5.3 (no-show treated as a cancellation at check-in time) and, for no-shows only, B.5.2 (tourist tax always refunded).
4. **Nightly prices are stored as a JSON list on the reservation,** not in a separate table.

## The rules the code implements

Taken from Annex B, with decision 3 applied. "Check-in Time" = the property's `check_in_time` on the arrival date, in the property's time zone.

| Tier | Full refund | Partial refund | No refund | Early departure |
|---|---|---|---|---|
| Flex | ≥ 24h before check-in | < 24h: host keeps the first night, the rest is refunded | — | First unused night kept, the rest refunded |
| Standard | ≥ 5 days before | < 5 days: host keeps the first night + 50% of the remaining nights | — | First unused night kept, 50% of the rest refunded |
| Limited | ≥ 14 days before | 14 to 7 days: 50% refunded | < 7 days | Next 7 unused nights kept, the rest refunded |
| Non-refundable | — | — | Always | Nothing refunded |

On every booking:
- **Grace period:** a full refund if cancelled within 24h of booking **and** at least 7 days before check-in. Not on Non-refundable.
- **Tourist tax** for nights not stayed is refunded on every tier, including Non-refundable, **except on a no-show**.
- **Full refund regardless of tier:** host cancels, property can't host the guest (B.5.5), travel ban or declared emergency (B.5.6, human review).
- **No-show:** no refund of anything.
- **Percentages** apply to the accommodation price only (the night values), never tourist tax.
- **Rounding:** to the cent, in the guest's favour (round the refund up).
- **Commission** is returned in proportion to the refund. Stripe's processing fee is not returned (the host bears it).
- **The tier a guest booked under never changes.** Each reservation stores a snapshot at booking time, and refund logic reads only the snapshot.
- **Non-refundable guardrail (B.4):** a non-refundable rate needs an active refundable rate on the same room, and must be at least 10% cheaper than it.

### Worked example (from Annex B, extended)

5 nights at €100, €3 tourist tax per night, €515 paid.

| Situation | Host keeps | Guest refund |
|---|---|---|
| Flex, cancelled 10h before | €100 | €415 |
| Standard, cancelled 3 days before | €300 | €215 |
| Limited, cancelled 10 days before | €250 | €265 |
| Limited or Non-refundable, cancelled 3 days before | €500 | €15 (tourist tax) |
| **Any tier, no-show** | **€515** | **€0** |
| Any tier, host cancels | €0 | €515 |

## Database (one hand-applied, idempotent migration: `0027_cancellation_tiers.sql`)

Follows the repo convention: plain SQL, applied by hand before deploying the code that reads it, mirrored in `packages/db/src/schema.ts`.

**`properties`**
- `cancellation_tier` — new enum `cancellation_tier` (`flex`, `standard`, `limited`), `NOT NULL DEFAULT 'standard'`. *(My call: Standard as the default and for existing rows, as the closest match to today's "free until 7 days".)*

**`rate_plans`**
- Keep `is_refundable`. Its meaning narrows to "true = follows the property tier, false = Non-refundable".
- Stop reading `cancellation_policy` (free text). The column stays for now and is dropped in a later migration, so the deploy window never has code reading a missing column. *(My call.)*

**`property_content`**
- Stop reading `free_cancellation_days`. Same two-step drop. *(My call.)*

**`bookings`**
- `confirmed_at timestamptz` — the Booking Time Annex B measures the grace period from. `created_at` is when the pending intent was made, which is earlier.
- Add `checked_in` to the `booking_status` enum (`ALTER TYPE … ADD VALUE IF NOT EXISTS`). This is how an early departure is told apart from a no-show.
- `departed_early_on date` — the last night actually stayed, set when the host records an early departure.

**`reservations`** — the policy snapshot, written when the booking is confirmed:
- `cancellation_tier` — snapshot enum `reservation_cancellation_tier` (`flex`, `standard`, `limited`, `non_refundable`). A separate enum, because a snapshot can be Non-refundable but a property setting cannot.
- `check_in_at timestamptz`
- `grace_until timestamptz NULL` (NULL when there is no grace period: Non-refundable, or check-in less than 7 days away)
- `full_refund_until timestamptz NULL` (NULL on Non-refundable)
- `partial_refund_until timestamptz NULL` (Limited only: check-in minus 7 days)
- `nights jsonb NOT NULL DEFAULT '[]'` — `[{ "date": "2026-11-03", "price": 100, "touristTax": 3 }]`, one entry per night, in major units like the rest of the schema. Charges that are owed once per stay, rather than per night, are attributed to the first night. *(My call: that night is always stayed when there is an early departure, and every night is refunded on a cancellation, so the result is the same either way.)*
- `policy_version text NOT NULL DEFAULT 'annex-b-2026-10-30'` — which wording of Annex B the guest agreed to.

**`refunds`** — new table, one row per refund OpenBookings executes or records:
- `id`, `booking_id` (FK), `reservation_id` (FK, nullable: a host cancellation covers the whole booking)
- `reason` — enum `refund_reason`: `guest_cancellation`, `early_departure`, `host_cancellation`, `property_unable`, `travel_restriction`, `goodwill`
- `accommodation_amount numeric(10,2)`, `tourist_tax_amount numeric(10,2)`, `amount numeric(10,2)` (their sum)
- `breakdown jsonb` — the calculator's output (rule applied, nights kept or refunded), so the host and guest can see why
- `status` — reuse `payment_status` (`pending`, `succeeded`, `failed`)
- `stripe_refund_id varchar(255) NULL`, `idempotency_key varchar(255) UNIQUE`
- `created_by text NULL` (Better Auth user id; NULL = system), `created_at`

`transactions` stays the payment ledger. The `charge.refunded` webhook already returns commission, and keeps doing so.

## Code

### 1. Refund calculator — `packages/pricing/src/cancellation.ts` (pure, fully unit tested)
- `buildPolicySnapshot({ tier, isRefundable, timezone, checkInTime, arrivalDate, confirmedAt })` → the snapshot fields above. Handles the property time zone (use `@date-fns/tz` or `Intl`; builder's choice).
- `calculateRefund(snapshot, nights, event)` → `{ refund: { accommodation, touristTax, total }, retained, rule, nights: [...] }`, where `event` is one of:
  - `{ kind: 'guest_cancellation', at }`
  - `{ kind: 'early_departure', lastNightStayed }`
  - `{ kind: 'no_show' }` → always zero
  - `{ kind: 'host_cancellation' | 'property_unable' | 'travel_restriction' }` → everything
- `describePolicy(snapshot, locale)` → the guest-facing sentences with exact local dates and times ("Free cancellation until Tue 3 Nov, 15:00").
- The Annex B worked examples become the first test cases.

### 2. Snapshot at booking
Wherever a reservation becomes confirmed, call `buildPolicySnapshot` and write the snapshot and `nights`. Real booking creation from payments isn't built yet (`checkout.session.completed` is deliberately unhandled), so this job:
- adds a `confirmReservationPolicy(bookingId)` helper in `packages/db` that the future booking-creation code calls
- calls it from the seed (`packages/db/seed/demo-booking.ts`), so the test bookings have snapshots

### 3. Business app — the host picks the tier
- **Property → Policies → Cancellation:** replace the "Coming soon" block in `listings/property/_components/sections/policies.tsx` with a three-option picker (Flex / Standard / Limited). Each option shows its rule in one line, plus the worked example for a 3-night stay. Saving notes that the change only applies to new bookings (B.1.3).
- **Rooms → rate sheet:** replace the free-text "Cancellation policy" field in `rate-sheet.tsx` with a choice: "Refundable — follows your property's policy (Standard)" or "Non-refundable". Choosing Non-refundable shows the B.4 rule inline.
- **B.4 validation on save** (`rooms/_lib/schema.ts` + `mutations.ts`): block saving an active Non-refundable rate unless the room has an active refundable rate whose BAR is at least 10% higher. Also block deactivating or archiving the last refundable rate while an active Non-refundable rate depends on it.
- **The rates & availability grid** shows a small "NR" marker on Non-refundable rates (it currently reads `is_refundable` for display).

### 4. Web app — the guest sees the tier
Replace every place that derives "free cancellation" from `is_refundable` and a fixed 7 days (`checkout/_lib/booking.ts`, `TripSummary.tsx`, `p/[hotel_slug]/_components/PoliciesSection.tsx`, `RoomsCarousel.tsx`, `constants.ts`, `components/search/stay-poster-data.ts`, `lib/hotel-page-data.ts`, `lib/search-results.ts`, `lib/demo-data.ts`):
- **Before booking** (hotel page, rate cards, checkout): the tier name and its deadlines as exact dates and times for the dates being booked, computed with `buildPolicySnapshot` from the search dates (B.5.9).
- **Non-refundable rates** are labelled clearly, shown next to their refundable sibling, and the price difference is visible.
- **At display time, a Non-refundable rate that isn't at least 10% cheaper for the actual stay is hidden** (B.4.4). Save-time validation checks BAR only; date overrides can still break the rule for specific stays.
- **Checkout** requires an explicit tick for a Non-refundable rate: "I understand this rate can't be refunded" (B.4.3).
- **Confirmation page** shows the snapshot's deadlines, plus: "If you don't show up, there is no refund."
- **Guest terms** (`apps/web/content/legal/terms/2026-10-24/{en,nl,fr}.mdx`): flagged for a new dated version that matches the tiers and the no-show rule. The legal wording itself waits for Notion and the lawyer; this job doesn't write it.

### 5. Executing refunds — `packages/stripe` + a booking service
- `packages/stripe`: `refundPayment({ paymentIntentId, stripeAccountId, amountCents, idempotencyKey })` — creates the refund on the connected account (`Stripe-Account` header) with `refund_application_fee: true`. The existing `charge.refunded` handler then finds no commission left to return, which is correct and idempotent.
- A booking service (`packages/db` or a new small module next to the business app's server actions):
  - `cancelByGuest(bookingId, userId)`
  - `cancelByHost(bookingId, hostUserId)`
  - `recordEarlyDeparture(bookingId, lastNightStayed)`
  - `markNoShow(bookingId)`
  - `markCheckedIn(bookingId)`
  - `issueGoodwillRefund(bookingId, amount)`
  - Each one runs in a transaction: lock the booking row, check the status transition is allowed, run the calculator, insert a `refunds` row (`pending`), commit, call Stripe, then update the row to `succeeded`/`failed`. The idempotency key is `refund:<bookingId>:<reason>:<n>`.
- **Allowed transitions:**
  - `confirmed` → `cancelled` (guest or host), `checked_in`, or `no_show`
  - `checked_in` → `completed`, or early departure (status stays `checked_in` until checkout, with `departed_early_on` set)
  - A no-show can only be marked after the check-in window closes: `check_in_until` on the arrival date, or the end of that day if the property has no cut-off.
- Hosts often won't bother marking a check-in, so *Record early departure* is also allowed straight from `confirmed` once check-in time has passed (it implies the guest checked in).
- **Multi-room bookings:** a guest cancellation cancels the whole booking; each reservation's refund is calculated from its own snapshot, and the amounts are summed into one Stripe refund with one `refunds` row per reservation. Cancelling a single room out of several is a non-goal.
- Moving bookings to `completed` after check-out has no owner today, and stays out of scope.
- `markNoShow` moves no money and creates no `refunds` row.
- A failed Stripe refund leaves the booking cancelled, with the `refunds` row `failed` and an audit entry. A failed refund is retried with the same key. It is not hidden.

### 6. UI for the actions
These pages don't exist yet: `apps/web/app/bookings/[booking-ref]` is a placeholder, and the business reservations list runs on `mock-reservations`. This job builds the minimum:
- **Guest booking page** (`/bookings/[booking-ref]`, signed-in owner only): stay details, the policy with exact deadlines, and a **Cancel booking** button. The button shows the exact refund ("You'll get €415 back. The hotel keeps €100.") before the guest confirms.
- **Host booking detail** in the business app, opened from the reservations list, which now reads real bookings instead of mock data. Shows the snapshot, and offers the actions allowed in the current state: *Mark checked in*, *Mark no-show* (only after the window closes), *Record early departure* (date picker), *Cancel booking* (full refund, with a warning), *Goodwill refund* (an amount, capped at what's left unrefunded).

### 7. Notion
Update to match decisions 1–3:
- Annex B: B.1.1 (tier per property, Non-refundable as a separate rate type), B.5.3 (no-show: no refund), B.5.2 (no-show exception)
- *Rate Types, No-Shows & Payout Logic* (no-show section and table row)
- Guest Terms §8
- *Data Storage* (new columns)
- Close the "Data model" and "No-show refunds" open items in Annex B.

## Goals / non-goals / anti-goals

**Goals:** a host can set the tier, guests see exact deadlines everywhere, the refund for any situation is computed in one tested place from a snapshot that never changes, and cancellations move the right money on Stripe.

**Non-goals (later):**
- Creating real bookings from Stripe payments (separate work; this job only provides the snapshot hook)
- A review queue for travel bans and "property couldn't host" claims: the calculator supports them, and a person triggers them through the host-cancel or goodwill path for now
- The long-stay rule (Annex B open item)
- The monthly statement
- Emails for cancellations, beyond what already exists

**Anti-goals:**
- Any refund amount computed outside `calculateRefund`
- A booking's terms changing after it's made
- A guest seeing a deadline without a date and time

## Order of work

Each phase is one commit or a small set of commits on `feat/cancellation-tiers`:

1. Migration + schema + calculator with tests
2. Snapshot helper + seed
3. Business app: tier picker, rate sheet, B.4 validation
4. Web app: display everywhere, Non-refundable handling, confirmation
5. Stripe refund + booking service with tests
6. Guest booking page + host booking detail (real reservations list)
7. Notion updates

## Left to the builder
- Time zone library choice, component structure, exact copy (follow the existing tone), test layout (follow neighbouring `*.test.ts` / `*.db.test.ts`).

# Full booking flow + testing mode — design

Date: 2026-11-06
Status: approved 2026-11-06

## Why

The two ends of booking exist: property pages, a Stripe checkout page, the
return page, the guest booking page, and everything after a booking is made
(cancel, refund, no-show, check-in, disputes, admin). The middle does not.
A guest cannot pick dates and rooms and turn that into a paid, confirmed
booking:

- The property page hard-codes "tonight + 3 nights" (`RoomsCarousel.tsx`),
  and "Book now" is not wired.
- Checkout always pays for one seeded booking (`CHECKOUT_BOOKING_ID` in
  `apps/web/app/checkout/_lib/booking.ts`).
- The Stripe webhook deliberately skips `checkout.session.completed`, so
  nothing ever confirms a booking.
- Search and the property page do not check availability, closures or stay
  rules for the guest's dates.
- No booking emails exist (only magic-link, security-alert, account-action).

Wouter wants the whole flow laid down, plus a **testing mode** so it can be
exercised end to end without real payments and without hand-building test
hotels.

## Decided by Wouter

- Build the full flow: dates → availability → room selection → hold →
  payment → confirmed booking → emails.
- **A hold of about 15 minutes** on the rooms while the guest pays.
- **A booking-intent table** (separate from `bookings`), with the future in
  mind.
- **A booking can have several rooms, all at one property.** Never several
  properties.
- **An account is required** to book.
- **Testing mode is switched on by an env var** ("testing"). With it on, the
  site behaves as normal; only the inventory is fake: properties, rooms,
  pricing and availability are generated on demand so the flow can be run
  from start to end without creating hotels by hand.
- **Each search in testing mode yields 8 generated hotels**, each covering
  one case (list below). Random-looking is nice; the same hotels for the same
  search is fine and preferred if it keeps size and load down.
- **Payments in testing mode use Stripe test mode** (test cards, real Stripe
  API, real webhook). Not a fake payment step.
- **Testing mode runs locally only, for now.** There is no preview
  environment (CI deploys `main` to production); building one is out of
  scope. The guard is on the Stripe test key, not `NODE_ENV`, so a preview
  environment can be added later without code changes. Never the live site.
- **A host's per-date availability number is the total for that night, and
  it never changes by itself.** The host sets e.g. 8; the stored number stays
  8. What goes down is the *bookable* count: 8 − booked − held. Guest and
  host are both shown that clearly ("3 of 8 left"). Today
  `room_inventory.available_override` "wins outright" and bookings are never
  subtracted from it, which can oversell; that changes.
- **The tester sees the host side too**: with testing on, the signed-in
  account is automatically made a member of the "OpenBookings Demo"
  organisation, so demo bookings show in the business dashboard.
- **The old in-memory demo mode (`NEXT_PUBLIC_DEMO_DATA`) is removed.**
  Running the frontend now always needs a database.
- **UI builds on the existing screens; tweaks only** (concept:
  https://claude.ai/artifact/B1FnzYNT3WmNW43DjqPA34). Answers from its
  review (2026-11-06):
  - Rooms left are shown to guests only when **fewer than 3** are left
    ("2 left"). Guests never see the host's total.
  - The party is **split evenly** over the selected rooms; no per-room
    guest editing for now.
  - **Hotels that can't be booked for the search are not shown in search.**
    Exception: **in testing mode only**, they are listed after the bookable
    ones with their reason, so every demo case is one click away.
  - **Rates that can't be booked are hidden** on the property page; a room
    with no bookable rate is hidden too. If no room is left, the rooms
    section says so in one line and offers to change dates.
- **Emails are really sent in testing mode, to the signed-in account's
  address** — including the host-side emails for generated hotels, so one
  person sees both sides.
- Design inspiration from Mobbin.

### The 8 generated hotels (approved as listed)

1. **Normal** — plenty of rooms, several room types; multi-room booking works.
2. **Last room** — one unit left; for testing the hold (two tabs).
3. **Sold out** — appears, but cannot be booked for the dates.
4. **Minimum stay** — needs 5+ nights; a shorter stay is blocked.
5. **No arrival on check-in day** — closed to arrival.
6. **Non-refundable rate** — the non-refundable confirmation at checkout.
   *(My call: the hotel also has a refundable rate at least 10% dearer on the
   same room, because Annex B B.4.3 — enforced in `refundable-guard.ts` and
   `listing-prices.ts` — only allows a non-refundable rate next to one. The
   guest picks the non-refundable rate. No compliance rule is bypassed.)*
7. **Price varies by night** — weekend nights cost more, tourist tax applies.
8. **Small rooms** — rooms fit fewer guests than searched, unless several are
   booked.

Flex (24h) and Standard (7d) cancellation tiers are spread across them.

## Goals

1. A signed-in guest can search with dates and guests, open a hotel, pick one
   or more rooms, pay, and end up with a confirmed booking on
   `/bookings/[ref]`, with a confirmation email.
2. The host side hears about it: the booking shows in host reservations and a
   new-booking email goes out.
3. Nobody can be sold a room that is not there; nobody is charged twice; what
   is charged is what was shown.
4. With testing on, all of the above works on a fresh database with no manual
   setup beyond env vars and Stripe CLI webhook forwarding.

## Non-goals

- Bookings across several properties.
- Booking without an account.
- A fake payment step, or payment providers other than Stripe (but see
  constraints: keep the provider swappable).
- A public demo site, a preview environment, or testing mode on production.
- Promo codes, add-ons, extras.
- Changes to the host rates & availability grid beyond what is needed.
- Changing what happens after a booking exists (cancel, refund, etc. already
  work).

## Anti-goals (a failure even if it "works")

- Generated hotels ever showing up, or being chargeable, on the live site.
- A guest charged for a room that cannot be given to them and not refunded
  automatically.
- A guest charged twice for one booking.
- The amount charged differing from the amount shown on the page the guest
  confirmed, without the guest seeing the new amount first.
- Real hosts' properties affected by testing mode (e.g. sold, priced or held
  by generated data).

## Constraints from the project

- Money in the schema is in **major units** (euros); cents only at the Stripe
  boundary (see `checkout/_lib/booking.ts` header).
  The `bigint` booking, reservation and transaction totals are rounded to
  whole euros; the exact charge lives in `transactions.metadata.amountCents`
  and the exact night prices in `reservations.nights`.
- **EUR only, EU only** — generated hotels too.
- Rates are **tax-inclusive**; tourist tax is added on top. Direct charges
  on the host's connected account; OpenBookings never holds funds.
- **Commission: follow the current checkout code.** *(My call — the code is
  newer and deliberate.)* The property's `commission_rate` is taken as a
  Stripe application fee on the **stay amount only, tourist tax excluded**
  (computed into the intent snapshot's `commissionCents` by
  `lib/booking/quote.ts` and charged from it at checkout), and only
  when `STRIPE_APPLICATION_FEE_ENABLED=true`, as today. The guest pays **no
  booking or service fee** (the terms promise this); the seed's 4.5%
  added on top of the guest total is a seed artifact and is not copied. The
  intent snapshot stores the commission, not a "booking fee". Refunds return
  commission in proportion, as the existing refund code already does.
- **Prepayment always**; no pay-at-property.
- Keep PSP calls inside `packages/stripe`; **avoid Stripe-named columns** in
  new tables (`payment_session_id`, not `stripe_session_id`) so a later
  Adyen/Mollie swap stays contained.
- Cancellation policy is snapshotted at confirmation via
  `confirmBookingPolicy` (`packages/db/src/reservation-policy.ts`), which is
  already written for "the code that turns a Stripe payment into a booking".
- `bookings.confirmed_at` is Booking Time (when paid), not when the intent
  was made.
- Booking lifecycle changes go through `booking-lifecycle` and record
  `booking_events`.
- **Stripe Checkout Sessions cannot expire sooner than 30 minutes after
  creation.** The 15-minute hold must therefore be enforced by OpenBookings,
  not by the session's `expires_at` alone.
- The property page is cached (same HTML for every visitor, `revalidate =
  300`, Cloudflare). Date-specific availability and prices must not break
  that.
- Existing in-memory demo mode: `NEXT_PUBLIC_DEMO_DATA` / `apps/web/lib/demo-data.ts`.
- There is a dev fallback connected account: `STRIPE_CONNECT_ACCOUNT_ID`,
  used when a property has no `stripe_account_id` outside production.

## How it works

### 1. Booking intents (new tables)

`booking_intents` — one row per "I want these rooms for these dates", from
the moment the guest presses Book until it becomes a booking or dies.

- `id`, `user_id`, `property_id`, `check_in_date`, `check_out_date`
- `status`: `open` → `paid` (converted) | `expired` | `failed` |
  `abandoned` | `refunded_oversold`
- `hold_expires_at` — created + 15 minutes
- the priced snapshot the guest confirmed: totals, commission, tourist tax,
  currency, line items, cancellation terms (jsonb + key amount columns)
- `payment_provider` (`'stripe'`), `payment_session_id`,
  `payment_account_id`
- `booking_id` — set when converted
- `created_at`, `updated_at`

`booking_intent_rooms` — one row per room unit in the intent: `room_id`,
`rate_plan_id`, `adults`, `children`, per-night prices (jsonb), totals,
tourist tax lines.

Bookings are only created when payment succeeds, so `bookings` holds real
bookings and abandoned carts never pollute it. The `pending` booking status
stays in the enum but new code does not create pending bookings.

*Builder's call:* exact column types, indexes, the migration number (next is
0033).

### 2. Availability — one shared function

A single function answers, for a property, dates and party: which room types
and rate plans can be sold, how many units, at what price per night, and if
not, why (sold out, closed, min/max stay, closed to arrival/departure, too
many guests). It is used by search, the property page quote, intent creation
and payment confirmation, so all four agree.

Bookable units per room per night = **total for the night** − booked − held,
floored at 0, where:

- **Total for the night** = the host's number for that date
  (`available_override`) if set; otherwise `room_inventory.total_rooms`,
  else `rooms.total_units`, minus `blocked_rooms`. *(My call: when the host
  set a number, `blocked_rooms` is not subtracted from it again — the number
  is what the host says is available.)* Stored numbers are never written to
  by bookings.
- **Booked** = units on confirmed / checked-in bookings, excluding cancelled
  reservations and nights after an early departure.
- **Held** = units in **open intents whose `hold_expires_at` is in the
  future** (the guest's own intent excluded).

Room closures and rate-plan restrictions apply as the host grid defines
them (`ari-query.ts` is the reference for those).

**Host grid**: the rates & availability grid shows the same bookable count
next to the total ("3 of 8 left"), computed by the same rule, instead of
today's `override ?? (total − booked − blocked)`. Held units count as taken
there too. *(My call on the exact wording/layout — goes through the UI
concept.)*

**Guest side**: room cards show how many are left when it is few (exact
threshold decided in the UI concept).

Holds expire lazily: an expired hold simply stops counting. No cron needed
for availability to be correct.

Creating an intent takes a lock (e.g. `SELECT … FOR UPDATE` on the room
rows) and re-checks availability inside the transaction, so two guests
pressing Book on the last room at once cannot both get it.

### 3. The guest's path

1. **Search** carries dates, adults, children and rooms (it already does).
   Results now reflect availability: hotels that cannot be booked for the
   dates are left out. In testing mode only, they are listed after the
   bookable ones with their reason (decided by Wouter).
2. **Search card → property page** passes the dates and party in the URL.
3. **Property page** gets a working date/guest picker. The page HTML stays
   cached; a client call (e.g. `GET /api/stay-quote`) fetches availability
   and exact prices for the chosen dates. Without dates, the page behaves as
   today.
4. **Room selection**: the guest picks one or more rooms (room type × rate
   plan, with a quantity, and guests per room). A summary bar shows the
   total. All at one property.
5. **Book**: not signed in → sign in, then come back with the selection
   intact. Signed in → `POST` creates the intent (re-priced and re-checked on
   the server), holds the rooms for 15 minutes, and sends the guest to
   checkout for that intent. If something changed (price, availability) the
   guest is told before paying.
6. **Checkout** (`/checkout/[intentId]`, owner only) reads the intent instead
   of the fixed booking. Shows every room, the price breakdown, cancellation
   terms per room, and a 15-minute countdown. Creates the Stripe session for
   the intent (session expiry 30 min, the Stripe minimum).
7. **Hold runs out before paying**: the page says so and offers to check
   again (re-check availability, new intent). The Stripe session is expired
   via the API so it can no longer be paid.
8. **Payment** → webhook (`checkout.session.completed` with
   `payment_status=paid`, and `checkout.session.async_payment_succeeded`)
   converts the intent into a confirmed booking: `bookings` +
   `reservations` rows, `confirmBookingPolicy`, a `booking_events` entry,
   the payment recorded in `transactions`, intent → `paid`. Idempotent on
   the intent and the event id.
9. **Paid after the hold ran out** (possible: Stripe's 30-min minimum, slow
   bank methods): re-check availability. Still free → confirm as normal.
   Gone → full automatic refund (commission included), intent →
   `refunded_oversold`, email the guest.
10. `async_payment_failed` → intent `failed`; `checkout.session.expired` →
    intent `expired`.
11. **Return page** reads the intent: paid → link to `/bookings/[ref]`; not
    yet confirmed by the webhook → "processing" and re-checks; failed /
    expired → offer to try again for the same selection.

### 4. Emails

New templates in `packages/mailing`, sent from where the state changes:

- Guest: booking confirmed (rooms, dates, total, cancellation deadline per
  room, link to the booking).
- Guest: payment received but rooms gone → refunded.
- Host: new booking.
- Guest + host: booking cancelled. *(My call: included, since "the full
  flow" ends there and the cancel action already exists.)*

In testing mode, host emails for generated hotels go to the signed-in
guest's own address.

### 5. Testing mode

**Switch**: `TESTING=true`. *(My call on the exact name.)* It is honoured
only when the Stripe secret key is a test key (`sk_test_`); with a live key
and `TESTING=true` the apps refuse to start (fail loudly). Both `apps/web`
and `apps/business` read it. Local only for now; webhooks reach the local
business app through `stripe listen` (Connect events) forwarding.

**Marking generated data**: `properties.is_demo` (new column). Generated
hotels belong to one "OpenBookings Demo" organisation, have no
`stripe_account_id`, and charge on the dev fallback
`STRIPE_CONNECT_ACCOUNT_ID`. With `TESTING` off, `is_demo` hotels are
excluded from search, property pages and booking everywhere. The demo
organisation has rates confirmed tax-inclusive, so checkout accepts its
hotels.

**Host side**: an email is either a guest or a host account (hard email
exclusivity in `packages/auth`), so the guest account cannot open the
business dashboard. Decided by Wouter: with testing on, **any host account
that signs in to the business app is added to the demo organisation as
owner** (idempotent, in the host auth's session-create hook). The tester
uses a separate host account next to their guest account. Generated data
and auto-membership are both scoped to `TESTING`; nothing about them runs
otherwise.

**Generation ("adaptive")**: when a search runs with testing on and there
are no generated hotels within the search radius of the point, the 8 are
created around it in one transaction, then the normal search runs over real
rows. Generation is deterministic from the area (rounded coordinates), so the
same area always gives the same 8 hotels, names and prices. Random-looking
names, photos from the existing CDN backdrops/manifest (allowed by CSP),
EU country/city from the search's destination label.

The 8 cases are set up to hold **for any dates searched** (e.g. "sold out"
via an availability override over a long date range; min stay on the rate
plan; closed-to-arrival on every day; one unit total for "last room";
day-of-week modifiers for weekend pricing). Bookings made during testing
are real rows and do consume the generated stock.

**Factories**: generation is built from small factories (property, room,
rate plan, restriction, tourist-tax rule, images) plus one builder per case.
The same factories are usable from tests and seeds.

**Reset**: a script that deletes all `is_demo` hotels and everything hanging
off them (intents, bookings, reservations, events, refunds).

**Old demo pieces are removed**: the `NEXT_PUBLIC_DEMO_DATA` in-memory mode
(`apps/web/lib/demo-data.ts` and its call sites), and the fixed seeded
pending booking (`CHECKOUT_BOOKING_ID`, the pending part of
`packages/db/seed/demo-booking.ts`). *(My call: the seeded confirmed
two-room booking used by the cancellation screens and admin can stay until
generated hotels cover it, then go too.)*

### 6. UI design process

Per Wouter's usual flow: Mobbin references → concept artifact (desktop +
phone, numbered decisions, open questions with a recommended answer) →
review → implement. No UI code before the concept is approved. Screens:

- Date/guest picker on the property page.
- Room selection with quantities and guests per room; the summary bar.
- Search card and room card states: unavailable + reason.
- The sign-in interruption and return.
- Checkout for several rooms; the hold countdown and "hold ran out" state.
- Return page states; the "rooms gone, refunded" state.
- The emails.

Design context: `DESIGN_SYSTEM.md`, `.impeccable.md`.

## Suggested order

1. Schema: intents, intent rooms, `properties.is_demo`.
2. Availability function + tests; the host grid switched to the same rule.
3. Testing mode switch, factories, generator, reset script.
4. Intent creation (with hold and lock) + checkout reading the intent.
5. Webhook conversion, late-payment re-check and auto-refund, return page.
6. UI concept → review → property page dates, room selection, search states.
7. Emails.
8. Remove superseded demo pieces.

## Left to the builder

- Table/column details, migration layout, API route names.
- Where the availability function lives (`packages/pricing` vs
  `packages/db`).
- Where the factories/generator live (a new package is fine).
- Test strategy details, as long as availability, the hold race, webhook
  idempotency, the late-payment path and the bookable-count rule (with and
  without a host number) have tests.

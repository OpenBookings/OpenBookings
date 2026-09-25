# Business Analytics tab — demo-data implementation

**Date:** 2026-09-25
**Status:** approved design, not yet implemented
**Scope:** the Analytics tab in `apps/business` (sections 1–5, global filters,
per-section CSV export, every state in the States table) running entirely on
generated demo data, behind a data seam real queries can replace later.

## Why

`app/(dashboard)/dashboard/analytics/page.tsx` is a `ComingSoon` stub. Hosts
have no way to see how their property performs on OpenBookings.

This version ships the whole UI on generated data. Real queries come later, so
the single thing that matters architecturally is that **only the implementation
of one function changes when they land** — not the types, not the derivations,
not a single widget.

Two vocabulary points that are not negotiable, because they are the difference
between a number a host can act on and one that misleads:

- **Sell-through, never occupancy.** We only see OpenBookings bookings, not the
  host's other channels. The denominator is the inventory the host made
  available *on OpenBookings*, not the hotel. Calling that "occupancy" invites a
  host to compare it against their PMS and conclude we are wrong.
- **Net room revenue** excludes VAT, tourist tax and non-room fees, and is after
  discounts.

## Approach chosen

**Server-derived view model, dumb client widgets.** `getAnalytics()` runs on the
server and returns a fully-derived `AnalyticsData`; section components render
it; only chart leaves are `"use client"`.

Two alternatives were considered.

*Client-side derivation from a facts payload* — return the night rows and
bookings, derive everything in `useMemo`. Filter changes become instant, but 18
months across two properties, three room types and three rate plans is tens of
thousands of rows shipped to the browser, and when real queries land the
derivation has to move to the server anyway. That rewrite would touch every
widget, which is exactly what this design exists to prevent.

*Route handler plus SWR* — `/api/analytics`, per-widget fetch state. It buys
genuine per-widget loading, but adds a layer with no auth or caching benefit
today. Per-widget failure is solved below without it.

Filters live in the URL, so a period change is already a navigation. A server
round-trip is the honest cost of that, not an extra one.

## Demo data is opt-in, never a fallback

`?demo=1`, matching the ARI grid. `apps/business/app/(dashboard)/dashboard/listings/rates-availability/page.tsx`
states the reason: a property with real-but-thin data should look thin, because
quietly substituting invented numbers is how a host acts on a figure that is not
real. That argument is stronger on a revenue screen than on a rates screen.

So without `?demo=1`, `getAnalytics()` returns a well-formed **empty** dataset
and the page renders the new-property state. That state is a designed screen,
not a blank page — see "States" below.

## Module layout

Everything lives in `apps/business/lib/analytics/`. The UI imports
`getAnalytics` and the types; nothing else.

| File | Purpose |
| --- | --- |
| `types.ts` | `AnalyticsData`, the fact types, `Widget<T>`. No logic. |
| `period.ts` | Period presets ↔ `{ from, to }`, URL parsing and clamping, bucket granularity, previous-period and same-period-last-year ranges. |
| `get-analytics.ts` | The one entry point. Today: generate facts, derive. Later: query, derive. |
| `demo/rng.ts` | Seeded PRNG. |
| `demo/properties.ts` | The three demo properties, their room types and rate plans. |
| `demo/generate.ts` | Facts for one property over one date range. |
| `derive/buckets.ts` | Day / week / month bucketing. |
| `derive/delta.ts` | Comparison against the previous period. |
| `derive/revenue.ts` | Section 1. |
| `derive/sell-through.ts` | Section 2. |
| `derive/bookings.ts` | Section 3. |
| `derive/pricing.ts` | Section 4. |
| `derive/guests.ts` | Section 5. |
| `csv.ts` | View model → CSV rows, per section. |

Components go in `app/(dashboard)/dashboard/analytics/_components/`, following
the `_components` / `_lib` split the listings pages already use. There is no
`_lib` here: the handoff puts the data function at `lib/analytics/`, and that is
the right home for something a future API route may also call.

## The seam

Two fact arrays, shaped to mirror the schema so the real query is a projection
rather than a reshape.

```ts
interface NightFact {
  date: string;            // YYYY-MM-DD
  propertyId: string;
  roomId: string;          // a `rooms` row IS the room type
  ratePlanId: string;
  unitsAvailable: number;  // rooms.total_units − blocked − closures
  unitsSold: number;
  netRevenueCents: number;
  basePriceCents: number;  // plan BAR before modifiers × unitsSold
  modifiers: { type: ModifierType; impactCents: number }[];
}

interface BookingFact {
  id: string;
  propertyId: string;
  createdAt: string;       // ISO — drives lead time and "bookings in period"
  checkIn: string;
  checkOut: string;
  nights: number;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
  cancelledAt: string | null;
  adults: number;
  children: number;
  guestKey: string;        // stands in for bookings.user_id
  guestCountry: string;    // ISO-3166-1 alpha-2
  netRevenueCents: number;
  roomId: string;
  ratePlanId: string;
}
```

Every field maps to something that exists, with one exception recorded below.

| Fact field | Real source |
| --- | --- |
| `roomId`, room type name | `rooms` (`rooms.total_units` is the physical unit count) |
| `unitsAvailable` | `rooms.total_units`, less `room_inventory.blocked_rooms`, or `room_inventory.available_override` when set, less `room_closures` |
| `unitsSold` | `reservations` joined to `bookings` on non-cancelled status |
| `netRevenueCents` | `reservations.total_amount` (see "Money" below) |
| `basePriceCents` | `rate_plans.bar` and `rate_overrides`, before `rate_modifiers` |
| `modifiers` | `rate_modifiers`, resolved through `@openbookings/pricing` |
| `createdAt`, `cancelledAt`, `status` | `bookings` |
| `adults`, `children` | `reservations` |
| `guestKey` | `bookings.user_id` |
| **`guestCountry`** | **No source exists.** |

### The one fictional field

There is no guest country or nationality column anywhere in
`packages/db/src/schema.ts`. The only `country` is on `properties` — the
property's own country, not the guest's. `bookings.user_id` is a Better Auth id
and the auth tables carry no address.

Country of origin is therefore the single widget that cannot be swapped to a
real query without a schema change. It is still built, fully typed, with the
privacy rule below baked in, and this paragraph is the record of why it will
fail to light up when the other four sections do. Adding it is a separate piece
of work: either a column on `bookings`, or derived from the payment method's
country at the Stripe edge.

### Money

Analytics is cents-native, against the grain of the rest of the repo.

`packages/db/seed/demo-booking.ts` states the schema convention: *"every bigint
amount in this schema is in MAJOR units (whole euros)"*, and
`packages/pricing/src/calculator.ts` rounds to two decimals rather than working
in minor units.

Analytics does not follow that, because it divides. ADR is revenue ÷ nights
sold, RevPAR is revenue ÷ nights available, and commission is 4.5% of revenue —
three places where whole-euro inputs produce figures that do not reconcile with
each other once rounded. Integer cents keep them exact until `Intl.NumberFormat`
runs.

The conversion happens **once**, at the point facts are produced:
`demo/generate.ts` multiplies the pricing calculator's euro output by 100 today;
the real query will do the same to the `bigint` columns. Nothing downstream of
`NightFact` sees euros. Every cents-bearing field is named `…Cents` so a
mistake reads as a mistake.

## Derivation

Every widget derives from the two fact arrays. Nothing is hard-coded per widget,
so the acceptance criteria hold by construction rather than by coincidence:
ADR × nights sold equals revenue because ADR *is* revenue ÷ nights sold.

Bucket granularity follows the period length: per day at ≤31 days, per week at
≤6 months, per month beyond. `period.ts` owns that decision so the revenue and
sell-through charts cannot disagree.

Deltas compare against the previous period of equal length, except year to date,
which compares against the same span last year. No comparison data renders "—",
not "0%". Up is green except on Cancellations and Average discount, which invert.

### Decisions the handoff left open

Four definitions admit two readings each. Picking them here, so the
implementation does not pick them by accident.

- **Cancelled bookings earn nothing.** A cancelled booking contributes to
  Number of bookings and to Cancellations, and to nothing else — no revenue, no
  nights sold, no length of stay, no party size. Its nights return to
  `unitsAvailable`. The Bookings section therefore counts a population the
  Revenue section does not, which is intended and is what the Cancellations
  widget measures.
- **Commission rounds once, at the end.** `Math.round(revenueCents * 0.045)`
  over the period's total, not the sum of per-night roundings. Per-night
  rounding drifts by up to a cent per night, which on 4,000 room-nights is a
  visible discrepancy against 4.5% of the revenue figure shown directly above it.
- **Repeat guests look at all history, not the period.** A booking counts as
  repeat when the same `guestKey` has an earlier booking with a check-in before
  this one's, anywhere in the fact set — not merely earlier within the selected
  period. A guest's second stay is their second stay regardless of which window
  the host is looking at. This means the demo generator must carry history
  outside the selected period, which it does.
- **Average discount is weighted by nights sold.** Per night, the discount is
  `1 − achieved ÷ base`; the reported figure is the revenue-weighted mean across
  nights sold, not the unweighted mean of nightly percentages. Unweighted lets a
  single heavily-discounted night in a quiet week outweigh a full week at rack
  rate, which reads as a pricing problem that is not there. Nights with no
  base price are excluded rather than counted as zero discount.

### Contained failure

One `getAnalytics()` call is one failure point, but the States table requires
that one failing widget must not blank the page. Each derivation is wrapped:

```ts
type Widget<T> = { ok: true; value: T } | { ok: false; message: string };
```

A derivation that throws is caught at its own boundary and its widget renders an
error with a retry; retry is `router.refresh()`. This survives the swap to real
queries, where one aggregate can fail while the others succeed — at which point
the wrapper is doing real work rather than defensive work.

## Demo properties

Deterministic throughout: a seeded PRNG (mulberry32 over a string seed derived
from the property id), never `Math.random()` at render, so numbers are identical
across refreshes and server and client agree. Roughly 18 months of history, so
year-to-date against last year has something to compare. Weekend peaks and a
summer high season. Guests mostly NL/BE/DE with a long tail, so the folding rule
below actually fires.

| Property | Shape | What it proves |
| --- | --- | --- |
| Zeeburg Grand | 12 rooms, 3 room types, 3 rate plans, 18 months | Full render; YTD vs last year |
| De Vlierhof | 4-room B&B, 1 room type, 1 rate plan, sparse bookings | "Not enough bookings" on the histogram, heatmap and country list |
| Nieuwehaven | 0 bookings, ever | New-property state |

The property selector appears only when the org has more than one property,
which in demo mode it always does.

## States

| State | Reached by | Behaviour |
| --- | --- | --- |
| Loading | A simulated delay in `getAnalytics()` | Skeleton per widget at final dimensions, inside one page-level `Suspense` |
| Empty | A quiet month on De Vlierhof | Sections still render; KPIs show 0 or "—"; charts show "No stays in this period." |
| New property | Nieuwehaven, or no `?demo=1` | One Alert above the page; sections hidden |
| Too little data | De Vlierhof on a short period | Histogram, heatmap and country list show "Not enough bookings in this period to show this." (<5 bookings) |
| Error | `?fail=<widgetId>` in demo mode | That widget shows an error and a retry; the rest of the page renders |

`?fail=` exists because otherwise the error row of that table is unreachable and
untestable. It is demo-mode only.

### The zero state

Without `?demo=1` there are no real queries yet, so `getAnalytics()` returns an
empty dataset and the page renders the new-property Alert: *"Your analytics will
appear once you receive your first booking."* The property selector stays
intact, the sections hide, and a "Preview with demo data" link points at
`?demo=1`. That keeps the opt-in discoverable without ever showing a host a
revenue figure that is not theirs.

## Widgets

Only shadcn/ui. `chart`, `calendar`, `popover` and `progress` are not yet
installed and come in via the shadcn CLI. shadcn's Chart pulls in **recharts** —
that is shadcn's own dependency, not a second charting library.

Sections 1–5 are as specified in the handoff. One widget needed a decision.

### Busiest days of the week

shadcn has no heatmap. Options weighed: a bar chart of the weekday average
(readable at any period, but drops the week dimension the widget is defined
with), a grouped bar chart of weekday × week (keeps both dimensions, unreadable
past roughly eight weeks — Last 12 months is fifty-two), and a tinted table.

**Chosen: shadcn `Table` with tinted cells.** Rows Mon–Sun, one column per week,
cell background an accent ramp keyed to sell-through. The percentage is
**always printed in the cell**, so the tint is redundant encoding and the widget
never relies on colour alone. The weekday column is sticky and the table scrolls
horizontally, which is how it survives a fifty-two-week period. `Tooltip` gives
the exact value and the cell's date range.

### Country of origin privacy rule

Any country with fewer than five bookings folds into "Other". This is built now,
not later: a four-room B&B with one Japanese guest would otherwise publish that
guest's presence to anyone who can see the screen. The rule belongs in
`derive/guests.ts`, so it applies to the CSV export too.

## Filters, URL and export

Search params: `period`, `from`, `to`, `property`, `demo`, `fail`. Parsed and
clamped server-side in the manner of `parseParams` in the rates-availability
page — query params are user input. Period presets use shadcn `Select`; the
custom range uses `Popover` + `Calendar`. The client writes params with
`URLSearchParams` and `router.push("?…", { scroll: false })` inside a
`useTransition`, matching `ari-view.tsx`.

CSV export is per section, client-side from a `Blob` — no route handler. `csv.ts`
takes the same view model the widgets render, so the export matches the screen
by construction rather than by a parallel code path that can drift.

## Accessibility

Every chart carries an `aria-label` that is a sentence generated from its own
derived values — "Revenue rose from €3,100 to €4,200 over the period" — not a
static description. Delta arrows are accompanied by text ("up 12%"), so colour
and glyph are both redundant. Filters and export buttons are keyboard-reachable
in visual order.

## Testing

`bun test`, alongside the derivation modules, in the manner of
`rates-availability/_lib/derive.test.ts`.

- **Reconciliation.** ADR × nights sold = revenue. Commission = 4.5% of revenue.
  Sell-through = nights sold ÷ nights available. RevPAR × nights available =
  revenue. These are the acceptance criteria, asserted.
- **Determinism.** Two `getAnalytics()` calls with identical arguments produce
  deeply equal output.
- **Bucketing.** 31 days gives daily buckets, 32 gives weekly, 6 months + 1 day
  gives monthly; boundaries are asserted, not assumed.
- **Deltas.** Previous period of equal length; YTD against last year; missing
  comparison yields the "—" sentinel rather than zero.
- **Cancellations.** A cancelled booking raises Number of bookings and
  Cancellations, leaves revenue, nights sold, length of stay and party size
  untouched, and returns its nights to `unitsAvailable`.
- **Repeat guests.** A guest whose first stay falls outside the selected period
  still marks their second booking as repeat.
- **Privacy.** A country with four bookings folds into "Other"; one with five
  does not. Asserted on the CSV output as well as the view model.
- **Vocabulary.** Nothing under `lib/analytics/` or the analytics components
  matches `/occupanc/i`, including CSV headers and aria-label strings.

## Out of scope

The Listing section (views and conversion), real database queries, role-based
access, the monthly summary email or PDF, and a custom report builder.

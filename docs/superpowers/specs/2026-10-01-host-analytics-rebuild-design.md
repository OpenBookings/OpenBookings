# Host analytics rebuild — five pages, shared primitives, demo data

**Date:** 2026-10-01
**Status:** design approved in conversation, awaiting review of this document
**Supersedes:** `2026-09-25-business-analytics-tab-design.md` where the two disagree
**Scope:** the Analytics pages in `apps/business`: page structure, shared header
and period control, widget primitives, empty and demo states, renames and
redirects. Still on generated demo data behind the existing facts seam.

## Why

The first build organised analytics as five sections of cards. Reviewing the
Revenue page showed the pattern failing: single numbers drawn as charts or
placed in tall cards, a smoothed revenue line that falls off a cliff on the
unfinished final week, a property selector for hosts who have one property, and
an empty state that shows nothing of what the page will offer and overflows the
viewport.

This rebuild organises the pages around the questions a host asks, and lets the
shape of the data decide the widget.

**Intended outcome.** A host opens any analytics page and can answer that
page's question without decoding the layout. A host with no bookings sees what
the page will show and what to fix today.

**Test for every metric.** It earns a place only if a host can act on it this
week: open dates, change a rate, tighten a cancellation tier, fix a listing.

## Scope

**In**

- Five pages: Revenue, Occupancy, Booking patterns, Pricing, Guests.
- Shared page header with the period and comparison control beside Export CSV.
- Widget primitives and the widget rules below.
- Ghost empty state with a readiness checklist; demo mode behind `?demo=1`.
- Removal of every property filter, selector and identifier.
- Renames and permanent redirects.
- Fixes to the defects recorded in
  `docs/superpowers/handoffs/2026-09-25-business-analytics-tab-handoff.md`
  (C1, C2, I2, I3, I4, I5, I6 and minors 1, 2, 4) where the code survives.

**Out, each a later spec**

- Real database queries for facts. Outside demo, `Facts` stays empty, so every
  real host sees the ghost empty state.
- The Visibility page and its search and funnel instrumentation. It is not in
  the nav and has no route in this build.
- The `@openbookings/pricing` local-timezone bug (handoff I1).
- Market-wide demand, peer comparisons, marketing attribution, custom reports,
  individual guest views, multi-property rollups.

## Approach

**Rework in place around the existing seam.** `Facts` → `derive/*` → view model
→ page stays. The monolithic `AnalyticsData` is replaced by one view model per
page, all computed through one metric module. The widget components are
replaced. Existing tests are migrated, not discarded.

Rejected: a parallel route tree and `lib` swapped in at the end (two copies of
period logic and derivations for the whole build), and a primitives-only pass
on the existing sections (leaves the wrong page structure and does the layout
work twice).

When real queries land, only the facts source inside `get-analytics.ts`
changes.

## Definitions

These are fixed here and implemented once, in `lib/analytics/metrics.ts`.

| Term | Definition |
| --- | --- |
| Revenue | Net room revenue: excluding VAT, tourist tax and non-room fees, after discounts. |
| Commission | 4.5% of revenue, rounded once on the total. Shown separately, never netted. |
| Nights sold | Unit-nights sold on stay dates in the range, cancelled bookings excluded. |
| Nights available | Total units minus out-of-order units, per date. Dates closed for sale still count as available. |
| Occupancy | Nights sold ÷ nights available. Null when nothing was available. |
| ADR | Revenue ÷ nights sold. Null when no nights sold. |
| RevPAR | Revenue ÷ nights available, which equals ADR × occupancy. |
| Cancellation rate | Cancelled bookings ÷ bookings created in the period. |
| Lead time | Days from booking date to check-in. |
| Day | A Europe/Amsterdam calendar day. |

**Date basis.** Booking date is when the reservation was made; stay date is
when the guest sleeps there. Revenue, Booking patterns and Guests use booking
date. Occupancy and Pricing use stay date. Every card names its basis in its
header, and no card mixes the two.

On the Revenue page, ADR and RevPAR are computed over the stay dates in the
selected range (they need a nights denominator); the stats carry a "by stay
date" note in their tooltip. All money figures on a page derive from the same
facts through `metrics.ts`.

On the Pricing page, the ADR stat, the ADR line and the weekday table use stay
date. The discount stats and the rate plan table use booking date: bookings
created in the period, with their nights, their revenue, and ADR as that
revenue ÷ those nights.

**Vocabulary.** "Occupancy" replaces "sell-through" in everything a host can
read. The earlier spec banned the word because OpenBookings sees only its own
bookings. That caveat moves into the Occupancy stat's tooltip: "Share of the
nights you made available on OpenBookings that were sold here." The source
guard test flips: "sell-through" must not appear in host-reachable copy.

**Commission rate mismatch.** `properties.commission_rate` defaults to 0.035 in
`packages/db/src/schema.ts`; this spec and the current code use 4.5%. This
build keeps 4.5% as one constant in `metrics.ts`. The real-query spec must
resolve which is correct before any host sees real figures.

## Global behaviour

### Property scoping

- No analytics function, component, search param or CSV accepts or emits a
  property identifier. `propertyId` leaves `AnalyticsQuery`, the view model and
  the fact types.
- The only real-data read in this build is the readiness checklist. It resolves
  the property on the server with `owner_user_id = session.user.id`.
- A guard test fails if `propertyId`, `property_id` or a `property` search
  param appears under `lib/analytics` or the analytics route tree
  (`readiness.ts` is the one allowed place for the owner lookup).

### Search params

| Param | Values | Default |
| --- | --- | --- |
| `period` | `last-7-days`, `last-30-days`, `last-3-months`, `last-12-months`, `ytd`, `custom` | `last-3-months` |
| `from`, `to` | ISO dates, only with `custom` | — |
| `compare` | `none`, `previous`, `last-year` | `previous` |
| `demo` | `1` | absent |

Unknown values fall back to the default; nothing throws. Old preset values
(`this-month`, `last-month`) fall back to the default. `property` and `fail`
are ignored. The sidebar links and in-page links preserve `period`, `from`,
`to`, `compare` and `demo` when moving between analytics pages.

### Period and comparison

- `today` is the current Europe/Amsterdam calendar day, computed in one place
  and passed down.
- Granularity: daily up to 31 days, weekly up to 6 months (182 days), monthly
  beyond.
- `previous` compares with the period of equal length immediately before.
  `last-year` shifts both ends back one year.
- `last-year` is available only when facts exist at least 12 months before the
  period start. Otherwise the option is disabled with the tooltip "Available
  once you have 12 months of data", and a URL asking for it falls back to
  `previous`.
- `comparisonRange` returns null for `none` and when the comparison range
  holds no facts. A null comparison means no delta chips and no overlay line.
- A delta chip renders only when a comparison exists and the change is
  non-zero. Never "up 0%", never a dash in place of a chip.
- A time bucket whose end date is after `today` is flagged `incomplete` in the
  view model.

### Number format

Whole euros in stats and chart axes (€338,047). Cents only in tables and the
CSV. `en-GB` formatting, as today.

### Export CSV

- Exports the table data of the current page for the selected period, built
  client-side from the view model as today.
- The same suppression rules as the UI, because it reads the same view model.
- Disabled, with a tooltip, in demo mode and in the never-booked state.

## Widget rules

Does the data have the shape this widget is built for? A single number is not
a chart, and a chart with two points is a sentence.

| Data shape | Widget | Never |
| --- | --- | --- |
| One number, optional delta | Inline stat | A card or chart for a lone value |
| Value over time, 7+ points | Line, or bars for counts | Smoothing |
| Fewer than 7 time points | Stats with deltas, or a small table | A chart |
| Distribution | Bars over ordered buckets | Pie or donut |
| Ranked categories | Horizontal bars, top 5 plus Other | Pie or donut |
| Composition of a whole | One stacked horizontal bar | Pie or donut |
| Items with several attributes | Table | Cards |
| Status or to-do | Checklist with state | A chart |

Layout:

- Content decides the size. No fixed-height tiles, no padding to fill a box.
- Stats sit in one borderless row at the top, separated by whitespace and at
  most hairline dividers.
- Cards are for charts and tables: one per card, with title, unit, date basis
  and period in the header.
- One- or two-column grid of content-driven rows.
- Delta colour signals direction, not judgement. Metrics where a rise is not
  good news (cancellation rate, discounts given, discount depth) use a neutral
  colour.
- Console mode: flat and operational. No glass effects.

## Architecture

### `lib/analytics/`

| File | Responsibility |
| --- | --- |
| `period.ts` | Presets, comparison modes, param parsing, granularity, Amsterdam `today`, bucket enumeration with the `incomplete` flag. |
| `metrics.ts` (new) | Every definition in the table above, plus the commission constant. The only place a ratio is computed. |
| `types.ts` | `Facts`, and one view model type per page. |
| `derive/revenue.ts`, `occupancy.ts`, `booking-patterns.ts`, `pricing.ts`, `guests.ts` | One pure function per page: `(facts, period, comparison, today) → PageViewModel`. |
| `get-analytics.ts` | `getPageData(page, query)`: picks the facts source (demo or empty), calls the page's derivation, returns `{ hasAnyBookings, isDemo, range, comparison, granularity, canCompareLastYear, view }`. |
| `demo/` | One fixed demo property and its deterministic facts. |
| `readiness.ts` (new) | The four checklist items for the session's host. |
| `csv.ts`, `format.ts` | Per-page CSV from the view model; whole-euro and cents formatters. |

Every widget value in a view model is a `Widget<T>` carrying:

```ts
type Widget<T> =
  | { ok: true; value: T; basis: "booking" | "stay"; sample: number }
  | { ok: false; reason: "below-minimum"; needed: number; have: number }
  | { ok: false; reason: "error"; message: string };
```

`sample` is counted on the widget's own basis: stay-shaped widgets count nights
sold, booking-shaped widgets count bookings created. This is what fixes handoff
C1 and I4, where stay-shaped charts were gated on a booking-creation count.

`sell-through.ts` and `bookings.ts` are renamed to `occupancy.ts` and
`booking-patterns.ts`; `SectionId` becomes `PageId` with the five route
segments as its values.

### Demo layer

Demo is a URL filter and nothing more: `?demo=1` fills the same pages with one
fixed set of demo facts.

- `params.demo === "1"` is the only switch. Never a fallback for missing data.
- One property (Zeeburg Grand: three room types, three rate plans). No
  selector, no variants.
- No `fail` param, no artificial delay, no demo-only branches in page or
  widget code. Pages cannot tell demo facts from real ones except through
  `isDemo`, which drives only the banner and the Export button.
- The generator produces **bookings first** and derives night facts from them,
  so nights sold, bookings and stay length reconcile (I3), and discounts are
  priced with the booking's real stay length and lead time (I2).
- Each booking is seeded from `seed:date:index`, so the facts for a given date
  are identical whatever window is requested (C2). Year to date does not move
  when the period changes.
- New generated fields: `groupType` (solo, couple, family, group, derived from
  adults and children), `guestCountry`, `cancellationFeeCents`, per-booking
  `discountCents`, and `unitsOutOfOrder` on night facts.
- Thin-data and never-booked cases are test fixtures, not reachable in demo.

### Readiness checklist

`getReadiness(userId)` returns four items, each `{ done, href }`:

| Item | Source | Fix link |
| --- | --- | --- |
| Listing is live | `properties.is_active` | Listing settings |
| Availability open in the next 90 days | `room_inventory` rows with units open in the window | Rates and availability |
| At least one active rate plan | `rate_plans` | Rate plans |
| Payments connected | Stripe Connect `charges_enabled`, via the existing onboarding status helper | Onboarding verify step |

Exact column names and link targets are confirmed against the schema and the
dashboard routes during implementation. If the host has no property row, all
four are not done. A failed Stripe lookup marks that one item "could not
check" and does not fail the page.

### Routes and navigation

- `/dashboard/analytics/{revenue,occupancy,booking-patterns,pricing,guests}`.
- `/dashboard/analytics` redirects to Revenue, preserving the query.
- Permanent redirects in `next.config.ts`, query preserved:
  `sell-through` → `occupancy`, `bookings` → `booking-patterns`.
- Sidebar: Revenue, Occupancy, Booking patterns, Pricing, Guests.
- `routes.test.ts` keeps tying `PageId` to route directories and now also to
  the sidebar entries.
- The docs page `apps/docs/content/docs/business/analytics/index.mdx` is
  updated for the new names.

### Components (`analytics/_components/`)

| Component | Replaces | Behaviour |
| --- | --- | --- |
| `analytics-page.tsx` (server) | `analytics-section.tsx` | Session check, param parsing, `getPageData`, then header plus page view, ghost page, or page view with demo banner. |
| `page-header.tsx` | `section-shell.tsx`, `analytics-filters.tsx` | Title and one-line description left; period control and Export CSV right. |
| `period-control.tsx` | `analytics-filters.tsx` | One popover trigger showing the selection, e.g. "Last 3 months · vs previous period". Presets, custom range calendar, comparison choice. No external label. |
| `stat-row.tsx` (`StatRow`, `Stat`, `DeltaChip`) | `kpi-card.tsx` | Borderless inline stats; optional tooltip and link. |
| `chart-card.tsx` | `widget-frame.tsx` | Card header (title, unit, basis, period) and the per-widget states. |
| `charts/time-line.tsx` | `charts/line-chart.tsx` | Straight segments, whole-unit axis, comparison line, dashed final segment when the last bucket is incomplete. Under 7 points it renders a small table. |
| `charts/bars.tsx` | `charts/bar-chart.tsx` | Vertical bars over ordered buckets. |
| `charts/ranked-bars.tsx` | `ranked-list.tsx` | Horizontal bars, top 5 plus Other, value and share. Two or fewer rows render as a two-line list. |
| `charts/stacked-bar.tsx` | existing | One horizontal bar with a value legend. |
| `date-strip.tsx` | `heatmap-table.tsx` | Next 90 days, one cell per day, sold against available, weekends marked. One shared tooltip, not one per cell. |
| `ghost-page.tsx`, `readiness-card.tsx` | `NewPropertyAlert` | See Empty states. |
| `demo-banner.tsx` | `DemoBanner` in `states.tsx` | Unchanged copy and behaviour. |

The analytics layout container gets `min-w-0` on its flex children so no page
can run past the viewport.

Page views remain client components (render props and formatters cannot cross
the server boundary); derivation stays on the server and only view models are
serialised.

## Pages

### Revenue — what did I earn, and what does OpenBookings take?

- Stats: Revenue (selected period), Year to date, ADR, RevPAR, Commission
  (4.5%, links to Finance).
- RevPAR tooltip: "Revenue per available room night: ADR multiplied by
  occupancy. Read next to ADR, it tells you whether weak revenue comes from a
  low price or from empty rooms."
- Line: revenue over time, comparison overlay.
- One card with a toggle (room type, rate plan): ranked bars with value and
  share.

### Occupancy — how full am I, and what is still unsold?

- Stats: Occupancy, Nights sold, Nights available, Unsold nights in the next
  30 days.
- Line: occupancy by week, comparison overlay. A bucket with no available
  nights is a gap, not 0%.
- Date strip: next 90 days.
- Line: pace, nights on the books for the next 90 days against the same point
  last year. Rendered only when 12 months of history exist; otherwise the card
  is absent.
- Bars: occupancy by weekday, 7 bars.

### Booking patterns — when do guests book, how long do they stay, who cancels?

- Stats: Bookings, Median lead time, Median stay length, Cancellation rate.
- Bars: lead time (same day, 1–3, 4–7, 8–14, 15–30, 31–60, 61+ days) and stay
  length (1, 2, 3, 4–6, 7+ nights), by bookings.
- Bars: cancellations by days before check-in, same buckets as lead time.
- Table: cancellation rate by rate plan, with fees retained.

### Pricing — are my rates working?

- Stats: ADR, Discounts given (euros and share of bookings), Average discount
  depth.
- Line: ADR over time, comparison overlay. The only place ADR is a trend.
- Table by rate plan: bookings, nights, ADR, revenue.
- Table by weekday: occupancy and ADR side by side. Hint under the table for
  each weekday above 85% occupancy with ADR below the period average: "Rooms on
  {weekday} sell out below your average rate."

### Guests — who is staying with me?

- Stats: Returning guests share, Median party size.
- Ranked bars: booker country, top 5 plus Other.
- Stacked bar: group type (solo, couple, family, group).
- Aggregates only. A segment with fewer than 5 **distinct guests** in the
  period is merged into Other, in the view model, so the UI and CSV cannot
  differ. All three Guests figures use the same population: non-cancelled
  bookings created in the period.

## Mapping from the current build

| Current widget | New home | Verdict |
| --- | --- | --- |
| Revenue: YTD and period revenue cards | Revenue stat row | Rework |
| Revenue: ADR and RevPAR cards with sparklines | Revenue stat row | Rework, sparklines dropped |
| Revenue: Commission card | Revenue stat row | Rework |
| Revenue: over time | Revenue line | Rework |
| Revenue: by room type, by rate plan | One toggled card | Rework, merged |
| Sell-through: percentage, rooms sold | Occupancy stat row | Rework, renamed |
| Sell-through: over time | Occupancy by week | Rework |
| Sell-through: by room type | — | Drop |
| Sell-through: busiest-days heatmap | Occupancy by weekday | Drop, replaced by 7 bars |
| Bookings: count, cancellations | Booking patterns stat row | Rework |
| Bookings: average length of stay | Median stay length stat and stay length bars | Rework |
| Bookings: lead time | Lead time bars | Rework, new buckets |
| Bookings: upcoming 30/60/90 | Occupancy: unsold nights stat and date strip | Rework, moved |
| Pricing: average discount | Pricing stat row | Keep |
| Pricing: base against achieved price | ADR over time | Rework, base line dropped |
| Pricing: top modifiers | — | Drop |
| Guests: party size, repeat guests | Guests stats | Rework, mean to median |
| Guests: countries | Booker country bars | Rework |

## Empty and demo states

| Situation | Treatment |
| --- | --- |
| Host has never had a booking | Ghost page, below |
| Bookings exist, none in the period | Normal page, stats at zero; each chart area shows "No bookings in this period. Try a longer period." |
| A widget is below its minimum sample | That widget only: "Needs at least 5 bookings (3 so far)" |
| A widget's derivation fails | That widget only: a short error line; the rest of the page renders |
| Demo | Normal page on demo facts, amber banner, Export disabled |

**Ghost page**, one component for all pages:

1. The header stays: title, description, period control. Export disabled.
2. The page's real layout as a ghost. Each page exports a ghost definition: its
   stat labels and its chart frames with a one-line caption each. Rendered
   static at about 40% opacity with dashed outlines, an en dash for each stat
   value, axis labels and a dashed baseline but no data line. No shimmer, so
   it cannot be mistaken for loading. `aria-hidden`.
3. One message card over the upper part of the ghost. Headline "Your analytics
   start with your first booking", one sentence, primary button "Preview with
   demo data" (adds `demo=1` to the current URL).
4. Inside the card, "Before your first booking": the four readiness items with
   state and fix link. If all four are done, the checklist is replaced by one
   line saying bookings will appear here.

**Demo banner:** "Demo data: none of these numbers are yours." with a link that
removes `demo` and keeps the host on the same page. Demo and real data are
never mixed on one page.

## Error handling

- Derivations never throw to the page; a failure becomes
  `{ ok: false, reason: "error" }` on that widget.
- All divisions go through `metrics.ts`, which returns null for a zero
  denominator. No NaN or Infinity reaches a view model (asserted in tests).
- Bad search params fall back silently.
- Readiness failures degrade per item.

## Testing

Test-first with `bun test`, from `apps/business`.

- **Metrics and reconciliation**, across every preset: stay-date ADR × nights
  sold = stay-date revenue; RevPAR = ADR × occupancy; commission is 4.5% rounded once;
  breakdowns sum to their total; Year to date is identical for every period;
  sum of booking nights = nights sold; no NaN.
- **Period:** presets, comparison modes, last-year availability, Amsterdam day
  boundary around midnight UTC, granularity boundary at 182 days, incomplete
  bucket flag.
- **Derivations:** per page, including the empty-period, below-minimum and
  no-inventory cases from fixtures.
- **Suppression:** distinct-guest threshold; five bookings from one guest are
  merged into Other; the CSV rows equal the view model rows.
- **Demo:** deterministic across calls and across request windows.
- **Readiness:** the four checks against fixture rows, including no property
  and Stripe failure.
- **Guards:** no property identifier in analytics code; `PageId`, route
  directories and sidebar agree; "sell-through" absent from host-reachable
  copy; no pie or donut chart import; no `type="monotone"` curve.
- **Browser pass**, each page in demo, never-booked and empty-period states,
  at desktop and narrow widths: nothing overflows, period control sits beside
  Export, period and demo carry across pages, old routes redirect.

`bun run typecheck` and `bun run lint` stay clean.

## Acceptance criteria

- The Analytics nav shows Revenue, Occupancy, Booking patterns, Pricing,
  Guests.
- No property filter or switcher anywhere, demo included, and no analytics
  request carries a property identifier.
- The period control sits beside Export CSV on every page, and the period and
  comparison carry across pages in the URL.
- No single figure is drawn as a chart or placed in an oversized card. No pie
  or donut.
- Time charts use straight segments and whole-unit axes, and mark the
  incomplete final bucket.
- A host with no bookings sees the ghost layout, the message card and the
  readiness checklist, and nothing overflows the viewport.
- Export is disabled in demo mode, and suppression applies in the CSV.
- `/dashboard/analytics/sell-through` and `/dashboard/analytics/bookings`
  redirect permanently to their new pages.

## Carried to the real-query spec

- Commission rate: 3.5% schema default against 4.5% here.
- No database source for guest country or group type.
- The schema stores whole euros; facts are in cents.
- Out-of-order units need a host-facing way to be marked.
- Visibility: audit PostHog EU and the database for search and funnel events
  before designing the page.

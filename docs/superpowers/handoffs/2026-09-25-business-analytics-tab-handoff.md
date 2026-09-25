# Analytics tab — implementation handoff

**Date:** 2026-09-25
**Branch:** `feat/business-analytics-tab` (21 commits, `28cf343..b4bedd1`)
**Spec:** `docs/superpowers/specs/2026-09-25-business-analytics-tab-design.md`
**Plan:** `docs/superpowers/plans/2026-09-25-business-analytics-tab.md`
**Decision log:** `.superpowers/sdd/2026-09-25-business-analytics-tab/progress.md` (git-ignored; every deviation from the plan is a `Ruling:` line there)

## State

All nineteen plan tasks are implemented and committed. `app/(dashboard)/dashboard/analytics/page.tsx` was a
`ComingSoon` stub; it now renders five sections on generated demo data behind `getAnalytics()`.

| Check | Result |
| --- | --- |
| `bun test lib/analytics/` | 196 pass, 0 fail, 16 files |
| `bun test` (whole app) | 392 pass, 30 skip (pre-existing `DATABASE_URL`-gated), 0 fail |
| `bun run typecheck` | rc=0 |
| `bun run lint` | rc=0 (16 pre-existing warnings, none in new files) |
| States table (all 8 rows) | verified at the data level against `getAnalytics` |
| Route | 307 → `/login` unauthenticated; sections render 200 with real figures |

**Not verified** — needs a logged-in browser: tooltip hover, sticky weekday column vs row hover, tab order,
actual CSV download.

## How to test it

```bash
cd apps/business
bun test lib/analytics/     # unit + reconciliation
bun run typecheck && bun run lint
bun run dev                 # port 3001
```

| URL | Expect |
| --- | --- |
| `/dashboard/analytics` | New-property alert, "Preview with demo data", no sections |
| `?demo=1` | Demo banner, five sections, Zeeburg Grand, 22 bookings in period |
| `?demo=1&property=demo-nieuwehaven` | New-property alert, selector still usable |
| `?demo=1&property=demo-vlierhof&period=custom&from=2026-02-01&to=2026-02-14` | 2 bookings → "Not enough bookings in this period to show this." |
| `?demo=1&period=custom&from=2024-01-01&to=2024-01-31` | Empty period but **not** new property |
| `?demo=1&fail=revenue.overTime` | One widget errors with Retry, rest render |
| `?demo=1&period=last-12-months` | Monthly buckets, 53-column scrolling heatmap |

The reconciliation suite (`lib/analytics/reconciliation.test.ts`) asserts the acceptance criteria across all
five period presets: ADR × nights sold = revenue, commission = 4.5% rounded once, every breakdown sums back
to period revenue, the country list accounts for every booking, RevPAR ≤ ADR, and no widget reports NaN.

## Findings from the fresh-context review

Raised by an independent Opus reviewer over the whole branch. **None are fixed.** Line references and
measurements are the reviewer's; the implementer reproduced only the git finding (I7) before work stopped.

### Critical — host-visible on the demo path

**C1. Charts print "No stays in this period" beside a non-zero revenue KPI.**
`revenue-section.tsx:19`, `sell-through-section.tsx:20`, `pricing-section.tsx:19` compute
`isEmpty = data.bookingsInPeriod === 0`. `bookingsInPeriod` (`get-analytics.ts:64`) counts bookings
**created** in the period; the charts it gates are about nights **stayed**. Measured on
`?demo=1&property=demo-vlierhof&period=custom&from=2026-02-09&to=2026-02-15`: Revenue €693.50 and Rooms sold 7
above six charts all claiming no stays. 1 of 40 one-week windows on De Vlierhof trips it outright; 37 of 40
fall under the `<5` threshold while holding 4–7 room-nights.
*Fix:* add `nightsSoldInPeriod` (or `hasStaysInPeriod`) to `AnalyticsData` and gate stay-shaped widgets on it.

**C2. "Year to date" changes when the period selector moves** — the card whose tooltip says it ignores the
selector. `factWindow` (`get-analytics.ts:84`) picks a generation start that varies with the period, and
`demo/generate.ts:74,85-93` draws from the per-plan RNG sequentially over `enumerateDates`, with a variable
number of draws per date. Move the start, every later day changes. Measured for `today=2026-09-25`, Zeeburg:
YTD is €330,748.63 on four presets, €333,078.06 on Last 12 months, €330,776.41 on a custom 2024 range. August
2026 is €51,521.98 as a custom range but €53,311.40 as the August bar inside Last 12 months.
`get-analytics.test.ts:9` only compares two calls with identical arguments, so it cannot see this.
*Fix:* seed per night — `makeRng(`${seed}:${plan.id}:${date}`)` — or generate over a fixed window and slice.

### Important

**I1. Demo numbers depend on the server's timezone.** `lib/analytics/` is clean (zero local `Date` getters),
but `demo/generate.ts:65` routes pricing through `@openbookings/pricing`, whose `isEligible` does
`new Date(date).getDay()` (`packages/pricing/src/calculator.ts:81`) — a local getter on a UTC midnight. The
payload hashes identically under `TZ=UTC`/`Europe/Amsterdam`/`Pacific/Kiritimati` and differently under
`TZ=America/Los_Angeles`. Pre-existing defect in another package; it will outlive the demo because the real
query prices against the same calculator. Fixing it changes ARI grid behaviour too, so it needs its own call.

**I2. The Pricing section attributes money to discounts that never happened.** `demo/generate.ts:59-66` calls
`resolveNightlyRates` with no `stayLength`, so `numNights = 1` and each night's arrival is compared against
`today`. `last_minute` is therefore true for **every past night** — 365 firings, −€20,900.04 over 12 months —
while `early_bird` and `length_of_stay` can never fire. Four configured rules, two shown, one wrong by two
orders of magnitude.

**I3. "Rooms sold" and "Number of bookings" cannot both be right.** `demo/generate.ts:150-155` pushes one
entry per sold night row regardless of `unitsSold`, and `:157-176` collapses a run of rows into one booking.
Zeeburg this month: Rooms sold 204, Number of bookings 22, Average stay 2.8 nights — 22 × 2.8 = 61, not 204.
Booking revenue (`:172`) is per-unit, so it is roughly a third of night revenue. The comment at `:132-135`
claims both arrays describe the same trading; they do not.

**I4. `requiresDetail` gates stay-shaped widgets on a booking-creation count** (`sell-through-section.tsx:80`).
Same root as C1. The spec does specify the `<5 bookings` rule for the heatmap, so the rule is right and the
measure is wrong; 37 of 40 windows hide the heatmap despite inventory and sales.

**I5. The privacy fold counts bookings, not distinct guests** (`derive/guests.ts:66-74`). Five bookings from
one repeat corporate guest names their country on screen and in the CSV — the exact disclosure the rule
exists to prevent. The spec's literal wording is satisfied; its stated reason is not.
*Fix:* threshold on `new Set(guestKey).size`, keep the reported value as the booking count so the
reconciliation identity still holds.
Secondary: `countries` counts cancellations while `averagePartySize` and `repeatGuestPct`
(`guests.ts:39,53`) do not, so the Guests section reports three figures over two populations silently.

**I6. The ADR and RevPAR sparklines both plot total revenue** (`derive/revenue.ts:57-73`, rendered at
`revenue-section.tsx:51,61`). Both sparks are byte-identical to each other and to the Revenue-over-time chart.
A host sees a rising line under "€180.59" when what rose was volume. **This is specified that way in the plan**
(lines 2323, 2333, 5645, 5655) and was implemented faithfully.
*Fix:* per-bucket `ratio(bucketRevenue, bucketSold)` and `ratio(bucketRevenue, bucketAvailable)`.

**I7. An unrelated 486-line documentation deletion rides inside the branch.** Commit `119b526` "Remove stale
setup and handoff docs" (authored on this branch mid-run, not by the implementer) deletes
`HANDOFF-checkout-gate.md`, `PRIVACY-RUNBOOK.md`, `STRIPE_SETUP.md` and `TURNSTILE_SETUP.md`. It will merge
with this feature and takes the privacy runbook with it. Decide deliberately.

### Minor (deferred)

1. `?fail=` can crash the page: `get-analytics.ts:96-101` checks only `key in target`, so
   `?demo=1&fail=range.from` puts a `Widget` where `analytics-filters.tsx:109` renders a string →
   "Objects are not valid as a React child". The mechanism that exists to prove failures are contained does
   the opposite. Guard that the current value looks like a `Widget`.
2. `comparisonRange` never returns null (`period.ts:160-167`) despite its doc comment, so every
   `comparison ? … : []` branch is dead (`revenue.ts:25,50`; `sell-through.ts:68,81`; `bookings.ts:33,37`).
3. Granularity boundary is one day off the spec's prose (182 days weekly). Ruled deliberately; worth a line
   in the spec.
4. Sell-through-over-time flattens a no-inventory bucket to 0% (`sell-through.ts:98`) where the heatmap
   correctly reports null — the "nothing sold" claim the heatmap's own comment forbids.
5. Skeleton dimensions don't match the real layout (`analytics-skeleton.tsx:38` uses `[4,2,3,2,3]` KPIs and
   2 charts per section; reality is 4/2/3/1/2 with 4 and 3 charts). The page will jump.
6. 371 Radix Tooltips on the default deep period, 1834 at the 5-year clamp. Consider one tooltip driven by
   hovered-cell state.
7. `nightsAvailable` holds "remaining", not "available" (`types.ts:154`, `bookings.ts:90`), and the CSV row is
   headed "Upcoming nights available" (`csv.ts:97`) — over-reads as inventory in a spreadsheet.
8. Non-demo zero state hides the property selector where the spec says it stays intact. Defensible.
9. The vocabulary guard is evadable on purpose (a split literal slips through) though the requirement holds
   today across the whole app. The source guard and the CSV guard are complementary, not redundant.
10. `guests-section.tsx:33` hard-codes `"—"` and `.toFixed(1)` instead of using `format.ts`; the CSV uses
    `.toFixed(2)` for the same figure.

### Clean bills

- **All five Review Focus inputs** handled in the derivation layer: zero inventory → null → "—"; reversed /
  single-day / year-boundary custom ranges; a period entirely in the future giving three different answers
  (ADR "—", RevPAR €0, sell-through 0%); a range older than history reaching the empty state and never the
  new-property alert. Timezone is clean inside `lib/analytics/` — the one violation is I1, one call away.
- **No NaN or Infinity reachable** anywhere in the payload; `ratio()` is the only division.
- **Money** is cents-native with one conversion point, every field suffixed `Cents`, commission rounded once.
- **Demo data is genuinely opt-in** — `params.demo === "1"` is the only switch, no fallback path exists, and
  `?fail` is ignored outside demo mode. A host cannot be shown invented revenue.
- **"occupancy"** appears nowhere host-reachable, verified across the whole app.
- **No component imports `demo/` or `derive/`.**

## Two decisions a future reader needs

**The section tree is `"use client"`**, against the spec's "only chart leaves are `use client`". The plan's
architecture could not render: every widget hands `WidgetFrame` a render prop and every chart a formatter, and
a function cannot cross a server-to-client boundary — React rejects it at render. The property the spec turns
on still holds: `getAnalytics` derives on the server and only the finished view model is serialized, never the
fact rows.

**Money formats `en-GB`, not `en-NL`.** `en-NL` is a hybrid CLDR resolves per engine — Bun renders
`€ 4.523,90`, Node `€4,523.90` — so tests described output no host would see and a browser would have
mismatched hydration on every money figure. `en-GB` is stable under Bun, Node and browsers, and identical to
what the app already renders. **`reservations-table.tsx`, `reservation-detail-panel.tsx` and
`rates-availability/_lib/format.ts` still use `en-NL` and carry the same latent hazard** — out of scope here.

## When the real queries land

Only `lib/analytics/get-analytics.ts` changes: replace `generateFacts` with queries returning the same two
arrays over the window `factWindow()` computes. The spec's "The seam" table maps every field to its source.
Three things to carry over:

1. **Cents.** The schema stores whole euros; multiply by 100 where facts are built.
2. **`guestCountry` has no source.** No guest country or nationality column exists anywhere in
   `packages/db/src/schema.ts`. It needs a column on `bookings`, or derivation from the payment method's
   country at the Stripe edge. Until then that one widget cannot light up.
3. **`Widget<T>` stops being defensive** and starts doing real work, once one aggregate query can fail while
   its neighbours succeed.

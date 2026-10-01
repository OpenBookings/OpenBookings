# Host Analytics Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild host analytics in `apps/business` as five pages (Revenue, Occupancy, Booking patterns, Pricing, Guests) with a shared header and period control, shape-driven widgets, a ghost empty state with a readiness checklist, and a `?demo=1` data filter.

**Architecture:** `Facts` → pure `derive/*` functions → one view model per page → client page views. One metric module defines every ratio. Demo facts are generated bookings-first, so nights, bookings and revenue reconcile by construction. Outside demo the facts are empty and every page shows the ghost state; the only real-data read is the readiness checklist.

**Tech Stack:** Next.js (App Router, this repo's pinned version: read `apps/business/node_modules/next/dist/docs/` before using any Next API), React, TypeScript, `bun test`, Recharts via `components/ui/chart`, Tailwind, `@openbookings/db` (`queryOne`), `@openbookings/stripe`.

**Spec:** `docs/superpowers/specs/2026-10-01-host-analytics-rebuild-design.md`

## Global Constraints

- All commands run from `apps/business` unless a step says otherwise.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No property identifier anywhere in `lib/analytics` or the analytics route tree. The single exception is `lib/analytics/readiness-query.ts`.
- `params.demo === "1"` is the only demo switch. No `fail` param, no artificial delay, no demo-only branches in page or widget code.
- Commission is 4.5%, one constant, rounded once on the total.
- Revenue is net room revenue: excluding VAT, tourist tax and non-room fees, after discounts.
- Available nights = total units minus out-of-order units. Closed dates still count.
- Days are Europe/Amsterdam calendar days. All date maths is on `YYYY-MM-DD` strings in UTC, as `period.ts` already does.
- Whole euros in stats and chart axes; cents only in tables and the CSV. `en-GB` formatting.
- Every division goes through `ratio` or `pct` in `metrics.ts`. No NaN or Infinity in a view model.
- No pie or donut. No smoothed curves (`type="monotone"` is banned; use `type="linear"`).
- The words "sell-through" and "sell through" do not appear in host-reachable copy.
- A delta chip renders only when a comparison exists and the rounded change is non-zero.
- Console mode: flat, no glass effects, no fixed-height tiles.
- Minimum sample for distribution, ranking and table widgets: 5.

## Review Focus

1. **A custom range entirely in the future.** Booking-date widgets must show zero with "No bookings in this period", stay-date widgets must show the nights already booked, and nothing may be NaN. Test in Task 10.
2. **A custom range older than all history.** The page must render with zeros and no comparison, and must not fall into the never-booked ghost state. Test in Task 10.
3. **Hostile or repeated search params** (`?period=a&period=b`, `compare=foo`, `from` after `to`, `demo=true`). Each falls back to the default without throwing; `demo=true` is not demo. Test in Task 2 and Task 10.
4. **The Amsterdam day boundary.** At 23:30 UTC in summer it is already tomorrow in Amsterdam; "today" and every "last N days" range must agree with the host's wall clock. Test in Task 2.
5. **Short and uneven series.** Fewer than 7 points must render as a table, and a comparison series with a different bucket count must align by index without inventing values. Test in Task 3.

## File Structure

```
apps/business/lib/analytics/
  pages.ts               page ids, titles, descriptions, ghost definitions, URL param carrying
  period.ts              presets, comparison modes, param parsing, granularity, Amsterdam today
  types.ts               facts, widget, view-model types
  metrics.ts             every metric definition and the only divisions
  format.ts              whole-euro, cents, percent, date formatting
  chart-data.ts          pure shaping of points into chart rows
  test-fixtures.ts       builders shared by the derive tests
  derive/widget.ts       Widget<T> constructor with minimum-sample and error containment
  derive/delta.ts        delta or null
  derive/buckets.ts      time buckets with the incomplete flag, series and overlay
  derive/revenue.ts  occupancy.ts  booking-patterns.ts  pricing.ts  guests.ts
  demo/rng.ts            (unchanged)
  demo/zeeburg.ts        the one demo property
  demo/generate.ts       bookings-first deterministic facts
  get-analytics.ts       getPageData(page, query)
  csv.ts                 per-page CSV from the view model
  readiness.ts           pure checklist evaluation
  readiness-query.ts     the one real-data read
  guards.test.ts  routes.test.ts  reconciliation.test.ts

apps/business/app/(dashboard)/dashboard/analytics/
  layout.tsx  page.tsx
  revenue/ occupancy/ booking-patterns/ pricing/ guests/   each a page.tsx
  _components/
    analytics-page.tsx  page-header.tsx  period-control.tsx  export-button.tsx
    demo-banner.tsx  ghost-page.tsx  readiness-card.tsx
    stat-row.tsx  chart-card.tsx  date-strip.tsx
    charts/time-line.tsx  bars.tsx  ranked-bars.tsx  stacked-bar.tsx
    pages/revenue-view.tsx  occupancy-view.tsx  booking-patterns-view.tsx
          pricing-view.tsx  guests-view.tsx
```

---

### Task 1: Clear the old build, lay down routes, types and page metadata

The old section tree and derivations are replaced wholesale. This task removes them, renames the routes, and leaves five empty pages that typecheck, so every later task builds on a green tree.

**Files:**
- Delete: `app/(dashboard)/dashboard/analytics/_components/` (all), `lib/analytics/derive/*`, `lib/analytics/csv.ts`, `lib/analytics/csv.test.ts`, `lib/analytics/get-analytics.ts`, `lib/analytics/get-analytics.test.ts`, `lib/analytics/reconciliation.test.ts`, `lib/analytics/vocabulary.test.ts`, `lib/analytics/demo/generate.ts`, `lib/analytics/demo/generate.test.ts`, `lib/analytics/demo/properties.ts`
- Move: `analytics/sell-through` → `analytics/occupancy`, `analytics/bookings` → `analytics/booking-patterns`
- Create: `lib/analytics/pages.ts`, `lib/analytics/pages.test.ts`
- Rewrite: `lib/analytics/types.ts`, `lib/analytics/routes.test.ts`, the five `page.tsx` files, `analytics/page.tsx`
- Modify: `lib/analytics/format.ts` (`trendSentence`), `components/dashboard/sidebar-08/app-sidebar.tsx:73-83`, `next.config.ts`

**Interfaces:**
- Produces: `PAGE_IDS`, `PageId`, `PAGES: Record<PageId, PageMeta>`, `CARRIED_PARAMS`, `carryQuery(search)`; every type in `types.ts` below.

- [ ] **Step 1: Remove the old build and rename the routes**

```bash
A="app/(dashboard)/dashboard/analytics"
git rm -r -q "$A/_components"
git rm -q lib/analytics/derive/*.ts lib/analytics/csv.ts lib/analytics/csv.test.ts \
  lib/analytics/get-analytics.ts lib/analytics/get-analytics.test.ts \
  lib/analytics/reconciliation.test.ts lib/analytics/vocabulary.test.ts \
  lib/analytics/demo/generate.ts lib/analytics/demo/generate.test.ts \
  lib/analytics/demo/properties.ts
git mv "$A/sell-through" "$A/occupancy"
git mv "$A/bookings" "$A/booking-patterns"
grep -rn "analytics/_components\|lib/analytics/get-analytics\|lib/analytics/csv" app components lib --include="*.ts" --include="*.tsx"
```

Expected: the final grep prints only the five `page.tsx` files and `analytics/page.tsx`. If anything else imports the deleted modules, stop and report it.

- [ ] **Step 2: Write the failing tests**

`lib/analytics/pages.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { carryQuery, PAGE_IDS, PAGES } from "./pages";

describe("pages", () => {
  test("five pages, in nav order", () => {
    expect([...PAGE_IDS]).toEqual(["revenue", "occupancy", "booking-patterns", "pricing", "guests"]);
  });

  test("each path is the id under the analytics root", () => {
    for (const id of PAGE_IDS) expect(PAGES[id].path).toBe(`/dashboard/analytics/${id}`);
  });

  test("every page has a ghost with stats and at least one frame", () => {
    for (const id of PAGE_IDS) {
      expect(PAGES[id].ghost.stats.length).toBeGreaterThan(0);
      expect(PAGES[id].ghost.frames.length).toBeGreaterThan(0);
    }
  });
});

describe("carryQuery", () => {
  test("keeps the period, comparison and demo params and drops everything else", () => {
    const search = new URLSearchParams("period=custom&from=2026-01-01&to=2026-02-01&compare=none&demo=1&property=x&fail=y");
    expect(carryQuery(search)).toBe("?period=custom&from=2026-01-01&to=2026-02-01&compare=none&demo=1");
  });

  test("is empty when there is nothing to carry", () => {
    expect(carryQuery(new URLSearchParams("utm=1"))).toBe("");
  });
});
```

`lib/analytics/routes.test.ts` (replace the whole file):

```ts
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { PAGE_IDS } from "./pages";

const ANALYTICS_DIR = "app/(dashboard)/dashboard/analytics";

describe("analytics routes", () => {
  test("every page id has a route directory and no other directory exists", async () => {
    const entries = await readdir(ANALYTICS_DIR, { withFileTypes: true });
    const segments = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name);
    expect(segments.sort()).toEqual([...PAGE_IDS].sort());
  });

  test("the sidebar is built from the page list", async () => {
    const source = await readFile("components/dashboard/sidebar-08/app-sidebar.tsx", "utf8");
    expect(source).toContain("PAGE_IDS.map");
  });

  test("renamed routes redirect permanently", async () => {
    const config = await readFile("next.config.ts", "utf8");
    expect(config).toContain('source: "/dashboard/analytics/sell-through"');
    expect(config).toContain('destination: "/dashboard/analytics/occupancy"');
    expect(config).toContain('source: "/dashboard/analytics/bookings"');
    expect(config).toContain('destination: "/dashboard/analytics/booking-patterns"');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test lib/analytics/pages.test.ts lib/analytics/routes.test.ts`
Expected: FAIL, `Cannot find module './pages'`.

- [ ] **Step 4: Create `lib/analytics/pages.ts`**

```ts
export const PAGE_IDS = ["revenue", "occupancy", "booking-patterns", "pricing", "guests"] as const;
export type PageId = (typeof PAGE_IDS)[number];

/** One dashed placeholder in the never-booked state. */
export interface GhostFrame {
  title: string;
  /** One line saying what the widget will show. */
  caption: string;
  kind: "line" | "bars" | "table" | "strip";
}

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  ghost: { stats: string[]; frames: GhostFrame[] };
}

export const PAGES: Record<PageId, PageMeta> = {
  revenue: {
    title: "Revenue",
    description: "What you earned, and what OpenBookings takes.",
    path: "/dashboard/analytics/revenue",
    ghost: {
      stats: ["Revenue", "Year to date", "ADR", "RevPAR", "Commission (4.5%)"],
      frames: [
        { title: "Revenue over time", caption: "Your revenue week by week, against the period before.", kind: "line" },
        { title: "Revenue by room type", caption: "Which rooms and rate plans bring in the most.", kind: "bars" },
      ],
    },
  },
  occupancy: {
    title: "Occupancy",
    description: "How full you are, and what is still unsold.",
    path: "/dashboard/analytics/occupancy",
    ghost: {
      stats: ["Occupancy", "Nights sold", "Nights available", "Unsold, next 30 days"],
      frames: [
        { title: "Occupancy over time", caption: "The share of your available nights that sold.", kind: "line" },
        { title: "Next 90 days", caption: "Sold against available, day by day, so unsold weekends stand out.", kind: "strip" },
        { title: "Occupancy by weekday", caption: "Which nights of the week fill and which do not.", kind: "bars" },
      ],
    },
  },
  "booking-patterns": {
    title: "Booking patterns",
    description: "When guests book, how long they stay, and who cancels.",
    path: "/dashboard/analytics/booking-patterns",
    ghost: {
      stats: ["Bookings", "Median lead time", "Median stay length", "Cancellation rate"],
      frames: [
        { title: "Lead time", caption: "How far ahead guests book.", kind: "bars" },
        { title: "Stay length", caption: "How many nights guests stay.", kind: "bars" },
        { title: "Cancellations by rate plan", caption: "Which rate plans get cancelled, and the fees you kept.", kind: "table" },
      ],
    },
  },
  pricing: {
    title: "Pricing",
    description: "Whether your rates are working.",
    path: "/dashboard/analytics/pricing",
    ghost: {
      stats: ["ADR", "Discounts given", "Average discount depth"],
      frames: [
        { title: "ADR over time", caption: "Your average nightly rate, against the period before.", kind: "line" },
        { title: "By rate plan", caption: "Bookings, nights, ADR and revenue for each rate plan.", kind: "table" },
        { title: "By weekday", caption: "Occupancy and ADR side by side for each night of the week.", kind: "table" },
      ],
    },
  },
  guests: {
    title: "Guests",
    description: "Who is staying with you.",
    path: "/dashboard/analytics/guests",
    ghost: {
      stats: ["Returning guests", "Median party size"],
      frames: [
        { title: "Booker country", caption: "Where your guests book from.", kind: "bars" },
        { title: "Group type", caption: "Solo travellers, couples, families and groups.", kind: "bars" },
      ],
    },
  },
};

/** The filters that follow a host from one analytics page to the next. */
export const CARRIED_PARAMS = ["period", "from", "to", "compare", "demo"] as const;

/** `?period=…` with only the carried params, or an empty string. */
export function carryQuery(search: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = search.get(key);
    if (value !== null) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : "";
}
```

- [ ] **Step 5: Replace `lib/analytics/types.ts`**

```ts
/** Calendar date, `YYYY-MM-DD`. Every date in this module is one of these. */
export type IsoDate = string;

/** ISO 8601 instant. Booking creation and cancellation carry a time. */
export type IsoInstant = string;

// ─────────────────────────────────────────────
// Facts — the seam. Real queries will return exactly these shapes.
// ─────────────────────────────────────────────

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";

export interface BookingFact {
  id: string;
  /** The booking date: drives every booking-date widget and lead time. */
  createdAt: IsoInstant;
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: number;
  status: BookingStatus;
  /** Null until the booking is cancelled. */
  cancelledAt: IsoInstant | null;
  adults: number;
  children: number;
  guestKey: string;
  /** ISO-3166-1 alpha-2. */
  guestCountry: string;
  roomId: string;
  ratePlanId: string;
  /** Net room revenue per night, one entry per night. Sums to netRevenueCents. */
  nightlyNetCents: number[];
  /** Net room revenue: ex VAT, ex tourist tax, ex fees, after discounts. */
  netRevenueCents: number;
  /** The rate before discounts. basePriceCents − discountCents = netRevenueCents. */
  basePriceCents: number;
  discountCents: number;
  /** What the host kept when a cancelled booking's tier charged a fee. */
  cancellationFeeCents: number;
}

/** One room type's capacity on one date. */
export interface InventoryFact {
  date: IsoDate;
  roomId: string;
  unitsTotal: number;
  unitsOutOfOrder: number;
}

/** One unit sold for one night. Always expanded from a booking, never invented. */
export interface SoldNight {
  date: IsoDate;
  roomId: string;
  ratePlanId: string;
  bookingId: string;
  revenueCents: number;
}

export interface Facts {
  bookings: BookingFact[];
  inventory: InventoryFact[];
  nights: SoldNight[];
  roomTypeNames: Record<string, string>;
  ratePlanNames: Record<string, string>;
}

// ─────────────────────────────────────────────
// View model primitives
// ─────────────────────────────────────────────

export type Basis = "booking" | "stay";

/**
 * One widget's outcome. `sample` is counted on the widget's own basis: nights
 * sold for stay-date widgets, bookings for booking-date widgets.
 */
export type Widget<T> =
  | { ok: true; value: T; basis: Basis; sample: number }
  | { ok: false; reason: "below-minimum"; basis: Basis; needed: number; have: number }
  | { ok: false; reason: "error"; message: string };

/** Exists only when there is a comparison and the rounded change is non-zero. */
export interface Delta {
  pct: number;
  direction: "up" | "down";
  label: string;
  /** `neutral` for metrics where a rise is not good news. */
  tone: "directional" | "neutral";
}

export interface StatValue {
  value: number | null;
  delta: Delta | null;
}

export type Granularity = "day" | "week" | "month";

export interface Point {
  bucket: IsoDate;
  label: string;
  /** Null where the question had no answer, e.g. occupancy with nothing available. */
  value: number | null;
  /** The comparison period's value for the same position, or null. */
  compare: number | null;
  /** True when the bucket is still in progress or clipped by the range end. */
  incomplete: boolean;
}

export interface Share {
  key: string;
  label: string;
  value: number;
  sharePct: number;
}

export interface Bar {
  key: string;
  label: string;
  value: number;
}

export interface DayCell {
  date: IsoDate;
  sold: number;
  available: number;
  weekend: boolean;
}

export interface CancellationRow {
  key: string;
  label: string;
  bookings: number;
  cancelled: number;
  ratePct: number | null;
  feesRetainedCents: number;
}

export interface RatePlanRow {
  key: string;
  label: string;
  bookings: number;
  nights: number;
  adrCents: number | null;
  revenueCents: number;
}

export interface WeekdayRow {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  label: string;
  occupancyPct: number | null;
  adrCents: number | null;
  /** True when the weekday sells out below the period's average rate. */
  hint: boolean;
}

export type GroupType = "solo" | "couple" | "family" | "group";

// ─────────────────────────────────────────────
// Page view models
// ─────────────────────────────────────────────

export interface RevenueView {
  revenue: Widget<StatValue>;
  yearToDate: Widget<StatValue>;
  adr: Widget<StatValue>;
  revpar: Widget<StatValue>;
  commission: Widget<StatValue>;
  overTime: Widget<Point[]>;
  byRoomType: Widget<Share[]>;
  byRatePlan: Widget<Share[]>;
}

export interface OccupancyView {
  occupancy: Widget<StatValue>;
  nightsSold: Widget<StatValue>;
  nightsAvailable: Widget<StatValue>;
  unsoldNext30: Widget<StatValue>;
  overTime: Widget<Point[]>;
  overTimeGranularity: Granularity;
  next90: Widget<DayCell[]>;
  /** Null until twelve months of history exist. */
  pace: Widget<Point[]> | null;
  byWeekday: Widget<Bar[]>;
}

export interface BookingPatternsView {
  bookings: Widget<StatValue>;
  medianLeadDays: Widget<StatValue>;
  medianStayNights: Widget<StatValue>;
  cancellationRate: Widget<StatValue>;
  leadTime: Widget<Bar[]>;
  stayLength: Widget<Bar[]>;
  cancellationsByDaysBefore: Widget<Bar[]>;
  byRatePlan: Widget<CancellationRow[]>;
}

export interface PricingView {
  adr: Widget<StatValue>;
  discounts: Widget<StatValue & { shareOfBookingsPct: number | null }>;
  discountDepth: Widget<StatValue>;
  adrOverTime: Widget<Point[]>;
  byRatePlan: Widget<RatePlanRow[]>;
  byWeekday: Widget<WeekdayRow[]>;
}

export interface GuestsView {
  returning: Widget<StatValue>;
  medianPartySize: Widget<StatValue>;
  countries: Widget<Share[]>;
  groupTypes: Widget<Share[]>;
}
```

- [ ] **Step 6: Make `trendSentence` accept null values**

In `lib/analytics/format.ts`, replace the `trendSentence` function with:

```ts
export function trendSentence(
  label: string,
  points: Pick<Point, "label" | "value">[],
  format: (value: number) => string,
): string {
  const known = points.filter((p): p is { label: string; value: number } => p.value !== null);
  if (known.length === 0) return `${label} has no data in this period.`;
  const first = known[0];
  const last = known[known.length - 1];
  if (known.length === 1) {
    return `${label} was ${format(first.value)} on ${first.label}, the only point in this period.`;
  }
  const verb =
    last.value > first.value ? "rose" : last.value < first.value ? "fell" : "held steady";
  if (verb === "held steady") {
    return `${label} held steady at ${format(first.value)} from ${first.label} to ${last.label}.`;
  }
  return `${label} ${verb} from ${format(first.value)} on ${first.label} to ${format(last.value)} on ${last.label}.`;
}
```

- [ ] **Step 7: Empty pages and the root redirect**

Each of `revenue/page.tsx`, `occupancy/page.tsx`, `booking-patterns/page.tsx`, `pricing/page.tsx`, `guests/page.tsx`:

```tsx
export default function Page() {
  return null;
}
```

`analytics/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { carryQuery } from "@/lib/analytics/pages";

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Nothing links here: the sidebar entry only expands its sub-items. This exists
 * for the old bookmark and the pasted link, and carries the filters with it.
 */
export default async function AnalyticsIndex({ searchParams }: { searchParams: Promise<RawParams> }) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) search.set(key, first);
  }
  redirect(`/dashboard/analytics/revenue${carryQuery(search)}`);
}
```

- [ ] **Step 8: Sidebar and redirects**

In `components/dashboard/sidebar-08/app-sidebar.tsx`, add the import and replace the Analytics `items` array:

```ts
import { PAGE_IDS, PAGES } from "@/lib/analytics/pages";
```

```ts
  {
    title: "Analytics",
    url: "#",
    icon: TrendingUp,
    items: PAGE_IDS.map((id) => ({ title: PAGES[id].title, url: PAGES[id].path })),
  },
```

In `next.config.ts`, read `node_modules/next/dist/docs/01-app/` for the `redirects` config reference first, then add this method to `nextConfig` directly above `async rewrites()`. Query strings pass through by default. `permanent: true` answers 308, the method-preserving permanent redirect.

```ts
  async redirects() {
    return [
      {
        source: "/dashboard/analytics/sell-through",
        destination: "/dashboard/analytics/occupancy",
        permanent: true,
      },
      {
        source: "/dashboard/analytics/bookings",
        destination: "/dashboard/analytics/booking-patterns",
        permanent: true,
      },
    ];
  },
```

- [ ] **Step 9: Verify and commit**

Run: `bun test lib/analytics && bun run typecheck && bun run lint`
Expected: all pass; typecheck rc=0.

```bash
git add -A . && git commit -m "Clear old analytics build and lay down the five-page routes"
```

---

### Task 2: Period presets, comparison modes, Amsterdam today

**Files:**
- Modify: `lib/analytics/period.ts` (everything from `export type PeriodPreset` to the end of the file)
- Test: `lib/analytics/period.test.ts`

**Interfaces:**
- Produces:
  - `type PeriodPreset = "last-7-days" | "last-30-days" | "last-3-months" | "last-12-months" | "ytd" | "custom"`
  - `DEFAULT_PRESET`, `PERIOD_LABELS`, `PERIOD_PRESETS`
  - `interface DateRange { from: IsoDate; to: IsoDate }`, `interface Period extends DateRange { preset: PeriodPreset }`
  - `type CompareMode = "none" | "previous" | "last-year"`, `DEFAULT_COMPARE`, `COMPARE_LABELS`, `COMPARE_MODES`
  - `type RawParams = Record<string, string | string[] | undefined>`
  - `resolvePeriod(preset, today, custom?) → Period`
  - `parsePeriodParams(params: RawParams, today) → Period`
  - `parseCompareParam(value: string | string[] | undefined) → CompareMode`
  - `comparisonRange(range: DateRange, mode: CompareMode) → DateRange | null`
  - `shiftYears(date, years) → IsoDate`, `granularityFor(range: DateRange) → Granularity`
  - `amsterdamToday(now?: Date) → IsoDate`

- [ ] **Step 1: Write the failing tests**

In `lib/analytics/period.test.ts`, delete every test that mentions `this-month`, `last-month`, `resolvePeriod`, `parsePeriodParams` or `comparisonRange`, update the import line to include the new names, and append:

```ts
describe("resolvePeriod", () => {
  const TODAY = "2026-10-01";

  test("last 7 and last 30 days are inclusive of today", () => {
    expect(resolvePeriod("last-7-days", TODAY)).toEqual({ preset: "last-7-days", from: "2026-09-25", to: TODAY });
    expect(resolvePeriod("last-30-days", TODAY)).toEqual({ preset: "last-30-days", from: "2026-09-02", to: TODAY });
  });

  test("last 3 and last 12 months start the day after the same date back", () => {
    expect(resolvePeriod("last-3-months", TODAY).from).toBe("2026-07-02");
    expect(resolvePeriod("last-12-months", TODAY).from).toBe("2025-10-02");
  });

  test("year to date starts on 1 January", () => {
    expect(resolvePeriod("ytd", TODAY)).toEqual({ preset: "ytd", from: "2026-01-01", to: TODAY });
  });

  test("a custom range the wrong way round is swapped", () => {
    expect(resolvePeriod("custom", TODAY, { from: "2026-03-10", to: "2026-03-01" })).toEqual({
      preset: "custom", from: "2026-03-01", to: "2026-03-10",
    });
  });

  test("a custom range with a malformed date falls back to the default preset", () => {
    expect(resolvePeriod("custom", TODAY, { from: "2026-13-45", to: "2026-03-01" }).preset).toBe("last-3-months");
  });
});

describe("parsePeriodParams", () => {
  const TODAY = "2026-10-01";

  test("defaults to the last 3 months", () => {
    expect(parsePeriodParams({}, TODAY).preset).toBe("last-3-months");
  });

  test("an unknown or retired preset falls back", () => {
    expect(parsePeriodParams({ period: "this-month" }, TODAY).preset).toBe("last-3-months");
    expect(parsePeriodParams({ period: "'; drop table" }, TODAY).preset).toBe("last-3-months");
  });

  test("a repeated param uses its first value", () => {
    expect(parsePeriodParams({ period: ["last-7-days", "ytd"] }, TODAY).preset).toBe("last-7-days");
  });
});

describe("parseCompareParam", () => {
  test("defaults to the previous period", () => {
    expect(parseCompareParam(undefined)).toBe("previous");
    expect(parseCompareParam("foo")).toBe("previous");
  });

  test("accepts each mode, and the first of a repeated param", () => {
    expect(parseCompareParam("none")).toBe("none");
    expect(parseCompareParam(["last-year", "none"])).toBe("last-year");
  });
});

describe("comparisonRange", () => {
  const range = { from: "2026-09-01", to: "2026-09-30" };

  test("none has no comparison", () => {
    expect(comparisonRange(range, "none")).toBeNull();
  });

  test("previous is the equal-length span immediately before", () => {
    expect(comparisonRange(range, "previous")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
  });

  test("last-year shifts both ends back one year, clamping 29 February", () => {
    expect(comparisonRange(range, "last-year")).toEqual({ from: "2025-09-01", to: "2025-09-30" });
    expect(comparisonRange({ from: "2024-02-29", to: "2024-02-29" }, "last-year")).toEqual({
      from: "2023-02-28", to: "2023-02-28",
    });
  });
});

describe("amsterdamToday", () => {
  test("late evening UTC in summer is already tomorrow in Amsterdam", () => {
    expect(amsterdamToday(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });

  test("in winter the day turns at 23:00 UTC", () => {
    expect(amsterdamToday(new Date("2026-01-15T22:59:00Z"))).toBe("2026-01-15");
    expect(amsterdamToday(new Date("2026-01-15T23:00:00Z"))).toBe("2026-01-16");
  });

  test("the last-7-days range follows the Amsterdam day, not the UTC one", () => {
    const today = amsterdamToday(new Date("2026-07-01T22:30:00Z"));
    expect(resolvePeriod("last-7-days", today)).toEqual({ preset: "last-7-days", from: "2026-06-26", to: "2026-07-02" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/period.test.ts`
Expected: FAIL, `parseCompareParam` and `amsterdamToday` are not exported.

- [ ] **Step 3: Implement**

In `lib/analytics/period.ts`, keep everything above `export type PeriodPreset` and replace the rest of the file with:

```ts
export type PeriodPreset =
  | "last-7-days"
  | "last-30-days"
  | "last-3-months"
  | "last-12-months"
  | "ytd"
  | "custom";

export const DEFAULT_PRESET: PeriodPreset = "last-3-months";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "last-7-days": "Last 7 days",
  "last-30-days": "Last 30 days",
  "last-3-months": "Last 3 months",
  "last-12-months": "Last 12 months",
  ytd: "Year to date",
  custom: "Custom",
};

export const PERIOD_PRESETS = Object.keys(PERIOD_LABELS) as PeriodPreset[];

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface Period extends DateRange {
  preset: PeriodPreset;
}

export type CompareMode = "none" | "previous" | "last-year";

export const DEFAULT_COMPARE: CompareMode = "previous";

export const COMPARE_LABELS: Record<CompareMode, string> = {
  none: "No comparison",
  previous: "Previous period",
  "last-year": "Same period last year",
};

export const COMPARE_MODES = Object.keys(COMPARE_LABELS) as CompareMode[];

/** Search params as Next hands them over: a repeated key arrives as an array. */
export type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** One URL must not be able to ask for the whole history at daily grain. */
const MAX_CUSTOM_DAYS = 366 * 5;

export function resolvePeriod(
  preset: PeriodPreset,
  today: IsoDate,
  custom?: { from?: string; to?: string },
): Period {
  switch (preset) {
    case "last-7-days":
      return { preset, from: addDays(today, -6), to: today };
    case "last-30-days":
      return { preset, from: addDays(today, -29), to: today };
    case "last-3-months":
      // 3 months back, then forward one day, so the span is inclusive.
      return { preset, from: addDays(shiftMonths(today, -3), 1), to: today };
    case "last-12-months":
      return { preset, from: addDays(shiftMonths(today, -12), 1), to: today };
    case "ytd":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom": {
      if (!isIsoDate(custom?.from) || !isIsoDate(custom?.to)) {
        return resolvePeriod(DEFAULT_PRESET, today);
      }
      // Swapped rather than rejected: dragging backwards through the calendar
      // produces from > to for the length of the drag.
      const forwards = custom.from <= custom.to;
      const to = forwards ? custom.to : custom.from;
      let from = forwards ? custom.from : custom.to;
      if (daysBetween(from, to) > MAX_CUSTOM_DAYS) from = addDays(to, -(MAX_CUSTOM_DAYS - 1));
      return { preset, from, to };
    }
  }
}

/** Clamps to the last day of the target month, so 31 March minus one month is 28/29 February. */
function shiftMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)));
}

export function shiftYears(date: IsoDate, years: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return fromUtc(Date.UTC(y + years, m - 1, Math.min(d, lastDay)));
}

/** Query params are user input. Anything unrecognised falls back; nothing throws. */
export function parsePeriodParams(params: RawParams, today: IsoDate): Period {
  const requested = first(params.period) ?? "";
  const preset = (PERIOD_PRESETS as string[]).includes(requested)
    ? (requested as PeriodPreset)
    : DEFAULT_PRESET;
  return resolvePeriod(preset, today, { from: first(params.from), to: first(params.to) });
}

export function parseCompareParam(value: string | string[] | undefined): CompareMode {
  const requested = first(value) ?? "";
  return (COMPARE_MODES as string[]).includes(requested) ? (requested as CompareMode) : DEFAULT_COMPARE;
}

/**
 * One decision, in one place: daily up to 31 days, weekly up to 26 whole weeks
 * (182 days), monthly beyond.
 */
export function granularityFor(range: DateRange): Granularity {
  const days = daysBetween(range.from, range.to);
  if (days <= 31) return "day";
  if (days <= 182) return "week";
  return "month";
}

export function comparisonRange(range: DateRange, mode: CompareMode): DateRange | null {
  if (mode === "none") return null;
  if (mode === "last-year") {
    return { from: shiftYears(range.from, -1), to: shiftYears(range.to, -1) };
  }
  const days = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

const AMSTERDAM_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The host's calendar day. A server in UTC would otherwise call it yesterday
 * for the last hour or two of every Amsterdam evening.
 */
export function amsterdamToday(now: Date = new Date()): IsoDate {
  const parts = Object.fromEntries(AMSTERDAM_PARTS.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/analytics/period.test.ts && bun run typecheck`
Expected: PASS, rc=0.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/period.ts lib/analytics/period.test.ts
git commit -m "Add analytics period presets, comparison modes and Amsterdam today"
```

---

### Task 3: Metric module, widget, delta, buckets, formatters, fixtures

**Files:**
- Create: `lib/analytics/metrics.ts`, `lib/analytics/metrics.test.ts`, `lib/analytics/derive/widget.ts`, `lib/analytics/derive/delta.ts`, `lib/analytics/derive/buckets.ts`, `lib/analytics/derive/foundation.test.ts`, `lib/analytics/chart-data.ts`, `lib/analytics/chart-data.test.ts`, `lib/analytics/test-fixtures.ts`
- Modify: `lib/analytics/types.ts` (append), `lib/analytics/format.ts` (append), `lib/analytics/format.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 types; Task 2 `DateRange`, `Period`, `CompareMode`, `comparisonRange`, `granularityFor`, `addDays`, `daysBetween`, `startOfWeek`, `startOfMonth`, `endOfMonth`.
- Produces:
  - `types.ts`: `DeriveContext { facts; period: Period; comparison: DateRange | null; today: IsoDate; granularity: Granularity }`, `PageViews`, `PageData<P>`, `AnyPageData`
  - `metrics.ts`: `COMMISSION_RATE`, `MIN_SAMPLE`, `TOP_N`, `OTHER_KEY`, `ratio`, `pct`, `sum`, `median`, `bookingDate`, `isCancelled`, `inRange`, `bookingsCreatedIn`, `keptBookings`, `nightsIn`, `inventoryIn`, `revenueCents`, `stayRevenueCents`, `nightsAvailable`, `occupancyPct`, `adrCents`, `revparCents`, `commissionCents`, `leadDays`, `groupTypeOf`, `expandNights`, `earliestFactDate`, `groupSum`, `shares`
  - `derive/widget.ts`: `widget<T>(basis, sample, compute, min = 0) → Widget<T>`
  - `derive/delta.ts`: `makeDelta(current, previous, tone = "directional") → Delta | null`
  - `derive/buckets.ts`: `Bucket`, `bucketKey`, `buckets(range, granularity, today)`, `toSeries(rows, date, range, granularity, today, reduce)`, `overlay(current, previous)`
  - `chart-data.ts`: `MIN_CHART_POINTS = 7`, `LineRow`, `lineRows(points)`
  - `format.ts`: `formatEuros(cents)`, `formatDate(iso)`, `formatRange(range)`, `formatDays(n)`
  - `test-fixtures.ts`: `booking(over)`, `inventory(from, to, rooms?, outOfOrder?)`, `facts(bookings, inv?)`, `ctx(facts, opts)`, `ok(widget)`

- [ ] **Step 1: Append the context and page types to `lib/analytics/types.ts`**

Add these imports at the top of the file:

```ts
import type { PageId } from "./pages";
import type { CompareMode, DateRange, Period } from "./period";
```

Append at the bottom:

```ts
// ─────────────────────────────────────────────
// Derivation context and page payload
// ─────────────────────────────────────────────

/** Everything a page derivation needs. Note what is absent: any property. */
export interface DeriveContext {
  facts: Facts;
  period: Period;
  /** Null when no comparison was asked for or none is possible. */
  comparison: DateRange | null;
  today: IsoDate;
  granularity: Granularity;
}

export interface PageViews {
  revenue: RevenueView;
  occupancy: OccupancyView;
  "booking-patterns": BookingPatternsView;
  pricing: PricingView;
  guests: GuestsView;
}

export interface PageData<P extends PageId = PageId> {
  page: P;
  /** True when the facts were generated. Drives the banner and the export button only. */
  isDemo: boolean;
  /** False only for a host who has never had a booking. */
  hasAnyBookings: boolean;
  range: DateRange;
  comparison: DateRange | null;
  /** The comparison actually applied, after any fallback. */
  compare: CompareMode;
  canCompareLastYear: boolean;
  granularity: Granularity;
  view: PageViews[P];
}

/** Discriminated on `page`, so a switch narrows `view`. */
export type AnyPageData = { [P in PageId]: PageData<P> }[PageId];
```

- [ ] **Step 2: Create `lib/analytics/test-fixtures.ts`**

```ts
import { expect } from "bun:test";
import { expandNights } from "./metrics";
import { addDays, comparisonRange, enumerateDates, granularityFor, type CompareMode } from "./period";
import type { BookingFact, DeriveContext, Facts, InventoryFact, IsoDate, Widget } from "./types";

let counter = 0;

/** A two-night completed booking at €100 a night, created 1 September 2026. */
export function booking(over: Partial<BookingFact> = {}): BookingFact {
  counter += 1;
  const nights = over.nights ?? 2;
  const nightlyNetCents = over.nightlyNetCents ?? Array.from({ length: nights }, () => 10_000);
  const net = nightlyNetCents.reduce((total, cents) => total + cents, 0);
  const checkIn = over.checkIn ?? "2026-09-10";
  const discountCents = over.discountCents ?? 0;
  return {
    id: `bk-${counter}`,
    createdAt: "2026-09-01T10:00:00.000Z",
    status: "completed",
    cancelledAt: null,
    adults: 2,
    children: 0,
    guestKey: `guest-${counter}`,
    guestCountry: "NL",
    roomId: "standard",
    ratePlanId: "flex",
    cancellationFeeCents: 0,
    ...over,
    checkIn,
    checkOut: over.checkOut ?? addDays(checkIn, nights),
    nights,
    nightlyNetCents,
    netRevenueCents: over.netRevenueCents ?? net,
    basePriceCents: over.basePriceCents ?? net + discountCents,
    discountCents,
  };
}

/** Ten standard rooms a night unless told otherwise. */
export function inventory(
  from: IsoDate,
  to: IsoDate,
  rooms: Record<string, number> = { standard: 10 },
  outOfOrder = 0,
): InventoryFact[] {
  return enumerateDates(from, to).flatMap((date) =>
    Object.entries(rooms).map(([roomId, unitsTotal]) => ({
      date, roomId, unitsTotal, unitsOutOfOrder: outOfOrder,
    })),
  );
}

export function facts(
  bookings: BookingFact[],
  inv: InventoryFact[] = inventory("2026-01-01", "2026-12-31"),
): Facts {
  return {
    bookings,
    inventory: inv,
    nights: expandNights(bookings),
    roomTypeNames: { standard: "Standard Double", suite: "Junior Suite" },
    ratePlanNames: { flex: "Flexible", saver: "Saver" },
  };
}

export function ctx(
  f: Facts,
  opts: { from: IsoDate; to: IsoDate; compare?: CompareMode; today?: IsoDate },
): DeriveContext {
  const period = { preset: "custom" as const, from: opts.from, to: opts.to };
  return {
    facts: f,
    period,
    comparison: comparisonRange(period, opts.compare ?? "previous"),
    today: opts.today ?? opts.to,
    granularity: granularityFor(period),
  };
}

/** Asserts the widget rendered and hands back its value. */
export function ok<T>(w: Widget<T>): T {
  expect(w.ok).toBe(true);
  return (w as { value: T }).value;
}
```

- [ ] **Step 3: Write the failing tests**

`lib/analytics/metrics.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  adrCents, commissionCents, earliestFactDate, expandNights, groupTypeOf, leadDays,
  median, nightsAvailable, occupancyPct, pct, ratio, revparCents, shares,
} from "./metrics";
import { booking, facts, inventory } from "./test-fixtures";

describe("ratio and pct", () => {
  test("a zero denominator is null, never Infinity or NaN", () => {
    expect(ratio(100, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
    expect(pct(1, 0)).toBeNull();
    expect(ratio(100, 4)).toBe(25);
    expect(pct(1, 4)).toBe(25);
  });
});

describe("median", () => {
  test("odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("nights and availability", () => {
  test("cancelled bookings sell no nights", () => {
    const nights = expandNights([booking(), booking({ status: "cancelled", cancelledAt: "2026-09-02T09:00:00.000Z" })]);
    expect(nights).toHaveLength(2);
    expect(nights.map((n) => n.date)).toEqual(["2026-09-10", "2026-09-11"]);
  });

  test("each night carries its own price and they sum to the booking", () => {
    const b = booking({ nights: 3, nightlyNetCents: [10_000, 12_000, 9_000] });
    const nights = expandNights([b]);
    expect(nights.map((n) => n.revenueCents)).toEqual([10_000, 12_000, 9_000]);
    expect(nights.reduce((t, n) => t + n.revenueCents, 0)).toBe(b.netRevenueCents);
  });

  test("available nights exclude out-of-order units and nothing else", () => {
    expect(nightsAvailable(inventory("2026-09-01", "2026-09-02", { standard: 10 }, 2))).toBe(16);
  });

  test("occupancy, ADR and RevPAR agree: RevPAR = ADR x occupancy", () => {
    const nights = expandNights([booking({ nights: 4 })]);
    const inv = inventory("2026-09-10", "2026-09-13", { standard: 2 });
    expect(occupancyPct(nights, inv)).toBe(50);
    expect(adrCents(nights)).toBe(10_000);
    expect(revparCents(nights, inv)).toBe(5_000);
  });

  test("ADR has no answer when nothing sold; occupancy has none when nothing was available", () => {
    expect(adrCents([])).toBeNull();
    expect(occupancyPct([], [])).toBeNull();
  });
});

describe("commission", () => {
  test("4.5%, rounded once", () => {
    expect(commissionCents(14_447_945)).toBe(650_158);
  });
});

describe("booking helpers", () => {
  test("lead time is whole days from booking date to check-in, never negative", () => {
    expect(leadDays(booking({ createdAt: "2026-09-01T23:00:00.000Z", checkIn: "2026-09-10" }))).toBe(9);
    expect(leadDays(booking({ createdAt: "2026-09-10T08:00:00.000Z", checkIn: "2026-09-10" }))).toBe(0);
    expect(leadDays(booking({ createdAt: "2026-09-12T08:00:00.000Z", checkIn: "2026-09-10" }))).toBe(0);
  });

  test("group type from the party", () => {
    expect(groupTypeOf(booking({ adults: 1 }))).toBe("solo");
    expect(groupTypeOf(booking({ adults: 2 }))).toBe("couple");
    expect(groupTypeOf(booking({ adults: 2, children: 1 }))).toBe("family");
    expect(groupTypeOf(booking({ adults: 4 }))).toBe("group");
  });

  test("the earliest fact is the first booking date, or null with no bookings", () => {
    expect(earliestFactDate(facts([]))).toBeNull();
    expect(
      earliestFactDate(facts([booking({ createdAt: "2026-03-01T10:00:00.000Z" }), booking({ createdAt: "2025-11-05T10:00:00.000Z" })])),
    ).toBe("2025-11-05");
  });
});

describe("shares", () => {
  test("ranks descending with a share of the total", () => {
    const rows = shares(new Map([["a", 25], ["b", 75]]), { a: "Alpha", b: "Beta" });
    expect(rows).toEqual([
      { key: "b", label: "Beta", value: 75, sharePct: 75 },
      { key: "a", label: "Alpha", value: 25, sharePct: 25 },
    ]);
  });

  test("keeps the top five and folds the rest into Other, last", () => {
    const groups = new Map(["a", "b", "c", "d", "e", "f", "g"].map((k, i) => [k, 70 - i * 10] as [string, number]));
    const rows = shares(groups, {});
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "c", "d", "e", "OTHER"]);
    expect(rows.at(-1)).toMatchObject({ label: "Other", value: 30 });
    expect(rows.reduce((t, r) => t + r.value, 0)).toBe(280);
  });

  test("an empty total gives zero shares, not NaN", () => {
    expect(shares(new Map([["a", 0]]), {})[0].sharePct).toBe(0);
  });
});
```

`lib/analytics/derive/foundation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buckets, overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

describe("widget", () => {
  test("carries its basis and sample", () => {
    expect(widget("stay", 12, () => 7)).toEqual({ ok: true, value: 7, basis: "stay", sample: 12 });
  });

  test("declines below its minimum sample and says how far short it is", () => {
    expect(widget("booking", 3, () => 7, 5)).toEqual({
      ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 3,
    });
  });

  test("contains a throwing derivation without leaking its message", () => {
    const w = widget("booking", 9, () => {
      throw new Error("secret detail");
    });
    expect(w).toEqual({ ok: false, reason: "error", message: "We could not work this one out." });
  });
});

describe("makeDelta", () => {
  test("null without a comparison, or against zero", () => {
    expect(makeDelta(10, null)).toBeNull();
    expect(makeDelta(null, 10)).toBeNull();
    expect(makeDelta(10, 0)).toBeNull();
  });

  test("null when the change rounds to zero, so no chip says 0%", () => {
    expect(makeDelta(1000, 1000)).toBeNull();
    expect(makeDelta(10_000, 10_003)).toBeNull();
  });

  test("direction, magnitude and tone", () => {
    expect(makeDelta(110, 100)).toEqual({ pct: 10, direction: "up", label: "up 10%", tone: "directional" });
    expect(makeDelta(95, 100, "neutral")).toEqual({ pct: -5, direction: "down", label: "down 5%", tone: "neutral" });
  });
});

describe("buckets", () => {
  test("weekly buckets cover the range and start on Monday", () => {
    const b = buckets({ from: "2026-09-01", to: "2026-09-20" }, "week", "2026-12-31");
    expect(b.map((x) => x.key)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(b.every((x) => !x.incomplete)).toBe(true);
  });

  test("the bucket containing today is incomplete", () => {
    const b = buckets({ from: "2026-09-01", to: "2026-09-24" }, "week", "2026-09-24");
    expect(b.map((x) => x.incomplete)).toEqual([false, false, false, true]);
  });

  test("a bucket cut short by the range end is incomplete even in the past", () => {
    const b = buckets({ from: "2026-06-01", to: "2026-06-17" }, "week", "2026-12-31");
    expect(b.at(-1)).toMatchObject({ key: "2026-06-15", incomplete: true });
  });

  test("today's daily bucket is incomplete, yesterday's is not", () => {
    const b = buckets({ from: "2026-09-23", to: "2026-09-24" }, "day", "2026-09-24");
    expect(b.map((x) => x.incomplete)).toEqual([false, true]);
  });
});

describe("toSeries and overlay", () => {
  const rows = [
    { date: "2026-09-01", v: 5 },
    { date: "2026-09-01", v: 7 },
    { date: "2026-09-03", v: 1 },
    { date: "2026-08-31", v: 99 },
  ];

  test("groups rows in range, keeps empty buckets, ignores rows outside", () => {
    const points = toSeries(rows, (r) => r.date, { from: "2026-09-01", to: "2026-09-03" }, "day", "2026-12-31",
      (group) => group.reduce((t, r) => t + r.v, 0));
    expect(points.map((p) => p.value)).toEqual([12, 0, 1]);
    expect(points.every((p) => p.compare === null)).toBe(true);
  });

  test("overlay aligns by position and never invents a value", () => {
    const current = toSeries(rows, (r) => r.date, { from: "2026-09-01", to: "2026-09-03" }, "day", "2026-12-31", (g) => g.length);
    const shorter = current.slice(0, 2).map((p) => ({ ...p, value: 40 }));
    expect(overlay(current, shorter).map((p) => p.compare)).toEqual([40, 40, null]);
    expect(overlay(current, null).map((p) => p.compare)).toEqual([null, null, null]);
  });
});
```

`lib/analytics/chart-data.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { lineRows, MIN_CHART_POINTS } from "./chart-data";
import type { Point } from "./types";

const point = (value: number | null, incomplete = false, compare: number | null = null): Point => ({
  bucket: "2026-09-01", label: "1 Sep", value, compare, incomplete,
});

describe("lineRows", () => {
  test("a chart needs seven points", () => {
    expect(MIN_CHART_POINTS).toBe(7);
  });

  test("with nothing incomplete, everything is solid", () => {
    const rows = lineRows([point(1), point(2), point(3)]);
    expect(rows.map((r) => r.solid)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.dashed)).toEqual([null, null, null]);
  });

  test("the dashed segment starts at the last complete point so the two lines join", () => {
    const rows = lineRows([point(1), point(2), point(3, true)]);
    expect(rows.map((r) => r.solid)).toEqual([1, 2, null]);
    expect(rows.map((r) => r.dashed)).toEqual([null, 2, 3]);
  });

  test("gaps stay gaps and the comparison passes through", () => {
    const rows = lineRows([point(null, false, 4), point(2, false, 5)]);
    expect(rows[0]).toMatchObject({ solid: null, compare: 4 });
    expect(rows[1]).toMatchObject({ solid: 2, compare: 5 });
  });
});
```

Append to `lib/analytics/format.test.ts` (add `formatEuros, formatDate, formatRange, formatDays` to its import):

```ts
describe("whole-euro and date formatting", () => {
  test("stats show whole euros, rounded", () => {
    expect(formatEuros(33_804_729)).toBe("€338,047");
    expect(formatEuros(null)).toBe("—");
  });

  test("dates read day, month, year", () => {
    expect(formatDate("2026-10-01")).toBe("1 Oct 2026");
    expect(formatRange({ from: "2026-07-02", to: "2026-10-01" })).toBe("2 Jul 2026 – 1 Oct 2026");
  });

  test("days pluralise", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(12.5)).toBe("12.5 days");
    expect(formatDays(null)).toBe("—");
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `bun test lib/analytics/metrics.test.ts lib/analytics/derive lib/analytics/chart-data.test.ts lib/analytics/format.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Create `lib/analytics/metrics.ts`**

```ts
import { addDays, daysBetween, type DateRange } from "./period";
import type {
  BookingFact, Facts, GroupType, InventoryFact, IsoDate, Share, SoldNight,
} from "./types";

/** OpenBookings' cut of net room revenue. */
export const COMMISSION_RATE = 0.045;
/** Distributions, rankings and tables refuse to render below this. */
export const MIN_SAMPLE = 5;
export const TOP_N = 5;
export const OTHER_KEY = "OTHER";

/**
 * The only divisions in analytics. A host reading "€NaN" learns nothing; a host
 * reading "—" learns the question had no answer this period.
 */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function pct(numerator: number, denominator: number): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : r * 100;
}

export function sum<T>(rows: T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const bookingDate = (b: BookingFact): IsoDate => b.createdAt.slice(0, 10);
export const isCancelled = (b: BookingFact): boolean => b.status === "cancelled";
export const inRange = (date: IsoDate, range: DateRange): boolean =>
  date >= range.from && date <= range.to;

/** Booking-date basis: every booking made in the range, cancelled or not. */
export const bookingsCreatedIn = (bookings: BookingFact[], range: DateRange): BookingFact[] =>
  bookings.filter((b) => inRange(bookingDate(b), range));

export const keptBookings = (bookings: BookingFact[]): BookingFact[] =>
  bookings.filter((b) => !isCancelled(b));

/** Stay-date basis. */
export const nightsIn = (nights: SoldNight[], range: DateRange): SoldNight[] =>
  nights.filter((n) => inRange(n.date, range));

export const inventoryIn = (inventory: InventoryFact[], range: DateRange): InventoryFact[] =>
  inventory.filter((i) => inRange(i.date, range));

/** Net room revenue of bookings that were not cancelled. */
export const revenueCents = (kept: BookingFact[]): number => sum(kept, (b) => b.netRevenueCents);
export const stayRevenueCents = (nights: SoldNight[]): number => sum(nights, (n) => n.revenueCents);

/** Total units minus out-of-order units. Dates closed for sale still count. */
export const nightsAvailable = (inventory: InventoryFact[]): number =>
  sum(inventory, (i) => Math.max(0, i.unitsTotal - i.unitsOutOfOrder));

export const occupancyPct = (nights: SoldNight[], inventory: InventoryFact[]): number | null =>
  pct(nights.length, nightsAvailable(inventory));

export const adrCents = (nights: SoldNight[]): number | null =>
  ratio(stayRevenueCents(nights), nights.length);

export const revparCents = (nights: SoldNight[], inventory: InventoryFact[]): number | null =>
  ratio(stayRevenueCents(nights), nightsAvailable(inventory));

/** Rounded once, on the total. Per-booking rounding drifts by a cent a booking. */
export const commissionCents = (revenue: number): number => Math.round(revenue * COMMISSION_RATE);

/** A booking made after check-in is same-day, not negative days out. */
export const leadDays = (b: BookingFact): number =>
  Math.max(0, daysBetween(bookingDate(b), b.checkIn) - 1);

export function groupTypeOf(b: BookingFact): GroupType {
  if (b.children > 0) return "family";
  if (b.adults === 1) return "solo";
  if (b.adults === 2) return "couple";
  return "group";
}

/**
 * Night facts come from bookings and from nowhere else, so nights sold and
 * bookings cannot disagree.
 */
export function expandNights(bookings: BookingFact[]): SoldNight[] {
  return keptBookings(bookings).flatMap((b) =>
    b.nightlyNetCents.map((revenueCents, index) => ({
      date: addDays(b.checkIn, index),
      roomId: b.roomId,
      ratePlanId: b.ratePlanId,
      bookingId: b.id,
      revenueCents,
    })),
  );
}

export function earliestFactDate(facts: Facts): IsoDate | null {
  let earliest: IsoDate | null = null;
  for (const b of facts.bookings) {
    const date = bookingDate(b);
    if (earliest === null || date < earliest) earliest = date;
  }
  return earliest;
}

export function groupSum<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const groups = new Map<string, number>();
  for (const row of rows) groups.set(key(row), (groups.get(key(row)) ?? 0) + value(row));
  return groups;
}

/**
 * Ranked, with each row's share of the total. Beyond `top` rows the rest fold
 * into Other, which sits last whatever its size: it is a residual, not a rank.
 */
export function shares(
  groups: Map<string, number>,
  names: Record<string, string>,
  top: number = TOP_N,
): Share[] {
  const total = [...groups.values()].reduce((t, v) => t + v, 0);
  const ranked = [...groups.entries()]
    .map(([key, value]) => ({ key, label: names[key] ?? key, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const head = ranked.slice(0, top);
  const tail = ranked.slice(top);
  const rows = tail.length > 0
    ? [...head, { key: OTHER_KEY, label: "Other", value: tail.reduce((t, r) => t + r.value, 0) }]
    : head;
  return rows.map((row) => ({ ...row, sharePct: pct(row.value, total) ?? 0 }));
}
```

- [ ] **Step 6: Create the derive foundation**

`lib/analytics/derive/widget.ts`:

```ts
import type { Basis, Widget } from "../types";

/**
 * Builds one widget. Below its minimum sample it declines and says how far
 * short it is; a derivation that throws is contained here so its neighbours
 * still render. The message is fixed: an error's own text does not reach a host.
 */
export function widget<T>(basis: Basis, sample: number, compute: () => T, min = 0): Widget<T> {
  if (sample < min) return { ok: false, reason: "below-minimum", basis, needed: min, have: sample };
  try {
    return { ok: true, value: compute(), basis, sample };
  } catch {
    return { ok: false, reason: "error", message: "We could not work this one out." };
  }
}
```

`lib/analytics/derive/delta.ts`:

```ts
import type { Delta } from "../types";

/**
 * Null whenever there is nothing honest to show: no comparison, a comparison
 * of zero, or a change that rounds to zero. The UI renders a chip only for a
 * non-null delta, so "up 0%" cannot appear.
 */
export function makeDelta(
  current: number | null,
  previous: number | null,
  tone: Delta["tone"] = "directional",
): Delta | null {
  if (current === null || previous === null || previous === 0) return null;
  const raw = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.abs(raw) < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  if (rounded === 0) return null;
  const direction = rounded > 0 ? "up" : "down";
  return { pct: rounded, direction, label: `${direction} ${Math.abs(rounded)}%`, tone };
}
```

`lib/analytics/derive/buckets.ts`:

```ts
import { formatDayMonth, formatMonthYear } from "../format";
import { addDays, endOfMonth, startOfMonth, startOfWeek, type DateRange } from "../period";
import type { Granularity, IsoDate, Point } from "../types";

export interface Bucket {
  key: IsoDate;
  label: string;
  incomplete: boolean;
}

export function bucketKey(date: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return date;
  if (granularity === "week") return startOfWeek(date);
  return startOfMonth(date);
}

function bucketEnd(key: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return key;
  if (granularity === "week") return addDays(key, 6);
  return endOfMonth(key);
}

function nextKey(key: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return addDays(key, 1);
  if (granularity === "week") return addDays(key, 7);
  return addDays(endOfMonth(key), 1);
}

/**
 * Every bucket the range touches, including the ones nothing happened in. A
 * bucket is incomplete when it is still in progress (it ends today or later)
 * or when the range stops before it does: either way its total is partial,
 * and drawn as a solid line it reads as a collapse.
 */
export function buckets(range: DateRange, granularity: Granularity, today: IsoDate): Bucket[] {
  const out: Bucket[] = [];
  const last = bucketKey(range.to, granularity);
  for (let key = bucketKey(range.from, granularity); key <= last; key = nextKey(key, granularity)) {
    const end = bucketEnd(key, granularity);
    out.push({
      key,
      label: granularity === "month" ? formatMonthYear(key) : formatDayMonth(key),
      incomplete: end >= today || end > range.to,
    });
  }
  return out;
}

/** Rows grouped into the range's buckets and reduced to one value each. */
export function toSeries<T>(
  rows: T[],
  date: (row: T) => IsoDate,
  range: DateRange,
  granularity: Granularity,
  today: IsoDate,
  reduce: (rows: T[], bucket: Bucket) => number | null,
): Point[] {
  const groups = new Map<IsoDate, T[]>();
  for (const row of rows) {
    const d = date(row);
    if (d < range.from || d > range.to) continue;
    const key = bucketKey(d, granularity);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return buckets(range, granularity, today).map((bucket) => ({
    bucket: bucket.key,
    label: bucket.label,
    value: reduce(groups.get(bucket.key) ?? [], bucket),
    compare: null,
    incomplete: bucket.incomplete,
  }));
}

/**
 * Lays the comparison period under the current one, position by position. The
 * two can differ in bucket count by one; a position with no counterpart stays
 * null and no value is invented for it.
 */
export function overlay(current: Point[], previous: Point[] | null): Point[] {
  if (!previous) return current;
  return current.map((point, index) => ({ ...point, compare: previous[index]?.value ?? null }));
}
```

- [ ] **Step 7: Create `lib/analytics/chart-data.ts` and extend `format.ts`**

`lib/analytics/chart-data.ts`:

```ts
import type { Point } from "./types";

/** Below this a time series is a table: a chart with two points is a sentence. */
export const MIN_CHART_POINTS = 7;

export interface LineRow {
  label: string;
  solid: number | null;
  dashed: number | null;
  compare: number | null;
}

/**
 * Splits one series into a solid and a dashed line. The dashed line starts at
 * the last complete point so the two meet, and covers every incomplete bucket.
 */
export function lineRows(points: Point[]): LineRow[] {
  const firstIncomplete = points.findIndex((p) => p.incomplete);
  return points.map((p, index) => ({
    label: p.label,
    solid: firstIncomplete === -1 || index < firstIncomplete ? p.value : null,
    dashed: firstIncomplete !== -1 && index >= firstIncomplete - 1 ? p.value : null,
    compare: p.compare,
  }));
}
```

Append to `lib/analytics/format.ts`:

```ts
const wholeEuros = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Stats and chart axes. Cents belong in tables and the CSV: use formatCents there. */
export function formatEuros(cents: number | null): string {
  return cents === null ? EM_DASH : wholeEuros.format(Math.round(cents / 100));
}

/** "2026-10-01" -> "1 Oct 2026". */
export function formatDate(date: IsoDate): string {
  return `${formatDayMonth(date)} ${date.slice(0, 4)}`;
}

export function formatRange(range: { from: IsoDate; to: IsoDate }): string {
  return `${formatDate(range.from)} – ${formatDate(range.to)}`;
}

export function formatDays(value: number | null): string {
  if (value === null) return EM_DASH;
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}
```

- [ ] **Step 8: Run to verify pass**

Run: `bun test lib/analytics && bun run typecheck`
Expected: PASS, rc=0.

- [ ] **Step 9: Commit**

```bash
git add lib/analytics && git commit -m "Add analytics metric module, widget, delta and bucket foundations"
```

---

### Task 4: Demo facts, bookings first

The demo is a data filter and nothing more. Prices are computed here, not through `@openbookings/pricing`, so the demo cannot inherit that package's local-timezone defect and no discount can fire that a booking did not earn.

**Files:**
- Create: `lib/analytics/demo/zeeburg.ts`, `lib/analytics/demo/generate.ts`
- Test: `lib/analytics/demo/generate.test.ts`

**Interfaces:**
- Consumes: `makeRng`, `Rng` from `demo/rng.ts`; `expandNights`, `bookingDate` from `metrics.ts`; `addDays`, `enumerateDates`, `weekdayOf` from `period.ts`.
- Produces: `buildDemoFacts(today: IsoDate): Facts` (pure), `generateDemoFacts(today: IsoDate): Facts` (memoised on `today`).

- [ ] **Step 1: Write the failing test**

`lib/analytics/demo/generate.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { bookingDate, earliestFactDate } from "../metrics";
import { addDays } from "../period";
import { buildDemoFacts } from "./generate";

const TODAY = "2026-10-01";
const facts = buildDemoFacts(TODAY);

describe("demo facts", () => {
  test("the same day always produces the same facts", () => {
    expect(buildDemoFacts(TODAY)).toEqual(facts);
  });

  test("history does not change when today moves: only newer bookings appear", () => {
    const earlier = buildDemoFacts("2026-07-01");
    const later = new Map(facts.bookings.map((b) => [b.id, b]));
    for (const b of earlier.bookings) {
      const same = later.get(b.id);
      expect(same).toBeDefined();
      expect(same!.createdAt).toBe(b.createdAt);
      expect(same!.checkIn).toBe(b.checkIn);
      expect(same!.netRevenueCents).toBe(b.netRevenueCents);
    }
    const expected = facts.bookings.filter((b) => bookingDate(b) <= "2026-07-01").length;
    expect(earlier.bookings).toHaveLength(expected);
  });

  test("no booking is made in the future, and some stays are still to come", () => {
    expect(facts.bookings.every((b) => bookingDate(b) <= TODAY)).toBe(true);
    expect(facts.bookings.some((b) => b.checkIn > TODAY)).toBe(true);
  });

  test("every booking's money adds up", () => {
    for (const b of facts.bookings) {
      expect(b.nightlyNetCents).toHaveLength(b.nights);
      expect(b.nightlyNetCents.reduce((t, c) => t + c, 0)).toBe(b.netRevenueCents);
      expect(b.basePriceCents - b.discountCents).toBe(b.netRevenueCents);
      expect(b.discountCents).toBeGreaterThanOrEqual(0);
      expect(b.checkOut).toBe(addDays(b.checkIn, b.nights));
    }
  });

  test("a room type is never sold beyond the units in service", () => {
    const capacity = new Map(
      facts.inventory.map((i) => [`${i.roomId}:${i.date}`, i.unitsTotal - i.unitsOutOfOrder]),
    );
    const sold = new Map<string, number>();
    for (const n of facts.nights) {
      const key = `${n.roomId}:${n.date}`;
      sold.set(key, (sold.get(key) ?? 0) + 1);
    }
    for (const [key, count] of sold) {
      expect(capacity.has(key)).toBe(true);
      expect(count).toBeLessThanOrEqual(capacity.get(key)!);
    }
  });

  test("there is enough of everything to fill the pages", () => {
    const cancelled = facts.bookings.filter((b) => b.status === "cancelled");
    expect(facts.bookings.length).toBeGreaterThan(1500);
    expect(cancelled.length / facts.bookings.length).toBeGreaterThan(0.03);
    expect(cancelled.length / facts.bookings.length).toBeLessThan(0.2);
    expect(cancelled.every((b) => b.cancelledAt !== null && b.cancelledAt.slice(0, 10) <= TODAY)).toBe(true);
    expect(facts.bookings.some((b) => b.discountCents > 0)).toBe(true);
    expect(cancelled.some((b) => b.cancellationFeeCents > 0)).toBe(true);
    expect(new Set(facts.bookings.map((b) => b.guestCountry)).size).toBeGreaterThan(8);
  });

  test("history reaches back far enough for a year-over-year comparison", () => {
    expect(earliestFactDate(facts)! <= "2024-10-01").toBe(true);
  });

  test("a guest always books from the same country", () => {
    const country = new Map<string, string>();
    for (const b of facts.bookings) {
      expect(country.get(b.guestKey) ?? b.guestCountry).toBe(b.guestCountry);
      country.set(b.guestKey, b.guestCountry);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/demo/generate.test.ts`
Expected: FAIL, `Cannot find module './generate'`.

- [ ] **Step 3: Create `lib/analytics/demo/zeeburg.ts`**

```ts
import type { IsoDate } from "../types";

export interface DemoRoomType {
  id: string;
  name: string;
  units: number;
}

export interface DemoRatePlan {
  id: string;
  roomId: string;
  name: string;
  /** Standing nightly rate before weekend uplift and discounts. */
  barCents: number;
  refundable: boolean;
  /** This plan's share of the demand for its room type. */
  share: number;
}

export interface DemoHotel {
  seed: string;
  openedOn: IsoDate;
  /** Baseline share of inventory that sells on an ordinary midweek night. */
  demand: number;
  roomTypes: DemoRoomType[];
  ratePlans: DemoRatePlan[];
}

/** The one demo hotel. Twelve rooms in Amsterdam, trading since June 2024. */
export const ZEEBURG: DemoHotel = {
  seed: "zeeburg-grand",
  openedOn: "2024-06-01",
  demand: 0.62,
  roomTypes: [
    { id: "zb-standard", name: "Standard Double", units: 6 },
    { id: "zb-canal", name: "Canal View Double", units: 4 },
    { id: "zb-suite", name: "Junior Suite", units: 2 },
  ],
  ratePlans: [
    { id: "zb-flex", roomId: "zb-standard", name: "Flexible", barCents: 13_900, refundable: true, share: 0.6 },
    { id: "zb-saver", roomId: "zb-standard", name: "Non-refundable Saver", barCents: 12_500, refundable: false, share: 0.4 },
    { id: "zb-canal-flex", roomId: "zb-canal", name: "Canal Flexible", barCents: 16_900, refundable: true, share: 1 },
    { id: "zb-suite-flex", roomId: "zb-suite", name: "Suite Flexible", barCents: 26_500, refundable: true, share: 1 },
  ],
};
```

- [ ] **Step 4: Create `lib/analytics/demo/generate.ts`**

```ts
import { expandNights } from "../metrics";
import { addDays, enumerateDates, weekdayOf } from "../period";
import type { BookingFact, Facts, InventoryFact, IsoDate } from "../types";
import { makeRng, type Rng } from "./rng";
import { ZEEBURG, type DemoHotel, type DemoRatePlan, type DemoRoomType } from "./zeeburg";

/** Arrivals are generated this far past today, so the next 90 days have bookings. */
const HORIZON_DAYS = 180;
/** Mean of STAY_WEIGHTS. Turns nightly demand into arrivals per day. */
const AVERAGE_STAY = 2.77;
const GUEST_POOL = 6000;

const WEEKEND_FACTOR: Record<number, number> = {
  1: 0.82, 2: 0.84, 3: 0.9, 4: 1.0, 5: 1.28, 6: 1.34, 7: 0.92,
};

const SEASON_FACTOR: Record<string, number> = {
  "01": 0.55, "02": 0.6, "03": 0.72, "04": 0.88, "05": 1.0, "06": 1.2,
  "07": 1.38, "08": 1.36, "09": 1.1, "10": 0.9, "11": 0.66, "12": 0.74,
};

const STAY_WEIGHTS: [number, number][] = [
  [1, 22], [2, 34], [3, 20], [4, 10], [5, 6], [6, 3], [7, 3], [9, 2],
];

/** [min days, max days, weight]. */
const LEAD_RANGES: [[number, number], number][] = [
  [[0, 0], 6], [[1, 3], 14], [[4, 7], 16], [[8, 14], 18],
  [[15, 30], 20], [[31, 60], 16], [[61, 150], 10],
];

const ADULT_WEIGHTS: [number, number][] = [[1, 18], [2, 62], [3, 8], [4, 12]];

/** The tail exists so the small-segment fold has something to fold. */
const COUNTRY_WEIGHTS: [string, number][] = [
  ["NL", 38], ["BE", 16], ["DE", 14], ["GB", 8], ["FR", 6], ["US", 4],
  ["IT", 3], ["ES", 3], ["DK", 2], ["SE", 2], ["PL", 1], ["IE", 1],
  ["JP", 1], ["CA", 1], ["AT", 1], ["PT", 1], ["NO", 1], ["CH", 1],
];

const WEEKEND_UPLIFT = 1.15;
const EARLY_BIRD = { minLeadDays: 60, rate: 0.08 };
const LAST_MINUTE = { maxLeadDays: 3, rate: 0.12 };
const WEEKLY = { minNights: 7, rate: 0.1 };

function weighted<T>(rng: Rng, options: [T, number][]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng.next() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** Friday and Saturday nights carry the weekend rate. */
const isWeekendNight = (date: IsoDate): boolean => weekdayOf(date) === 5 || weekdayOf(date) === 6;

function outOfOrder(hotel: DemoHotel, room: DemoRoomType, date: IsoDate): number {
  if (room.units <= 2) return 0;
  return makeRng(`${hotel.seed}:ooo:${room.id}:${date}`).bool(0.03) ? 1 : 0;
}

function countryOf(hotel: DemoHotel, guestIndex: number): string {
  return weighted(makeRng(`${hotel.seed}:guest:${guestIndex}`), COUNTRY_WEIGHTS);
}

/**
 * Bookings first. Each arrival date and rate plan has its own seed, and rooms
 * are allocated in arrival order from the opening day, so the bookings for a
 * given date are the same whatever `today` is: a later today only reveals
 * bookings that had not been made yet.
 */
export function buildDemoFacts(today: IsoDate, hotel: DemoHotel = ZEEBURG): Facts {
  const lastDate = addDays(today, HORIZON_DAYS);
  const dates = enumerateDates(hotel.openedOn, lastDate);
  const rooms = new Map(hotel.roomTypes.map((room) => [room.id, room]));

  const inventory: InventoryFact[] = [];
  const capacity = new Map<string, number>();
  for (const date of dates) {
    for (const room of hotel.roomTypes) {
      const unitsOutOfOrder = outOfOrder(hotel, room, date);
      inventory.push({ date, roomId: room.id, unitsTotal: room.units, unitsOutOfOrder });
      capacity.set(`${room.id}:${date}`, room.units - unitsOutOfOrder);
    }
  }

  const taken = new Map<string, number>();
  const bookings: BookingFact[] = [];

  for (const date of dates) {
    for (const plan of hotel.ratePlans) {
      const room = rooms.get(plan.roomId)!;
      const rng = makeRng(`${hotel.seed}:${plan.id}:${date}`);
      const nightlyDemand =
        room.units * plan.share * hotel.demand *
        (WEEKEND_FACTOR[weekdayOf(date)] ?? 1) * (SEASON_FACTOR[date.slice(5, 7)] ?? 1);
      const expected = nightlyDemand / AVERAGE_STAY;
      const arrivals = Math.floor(expected) + (rng.bool(expected % 1) ? 1 : 0);

      for (let index = 0; index < arrivals; index++) {
        const booking = drawBooking(hotel, plan, date, index, rng, today);
        const stayDates = enumerateDates(date, addDays(date, booking.nights - 1));
        // A stay that runs past the generated window has no capacity row.
        const fits = stayDates.every((d) => (taken.get(`${room.id}:${d}`) ?? 0) < (capacity.get(`${room.id}:${d}`) ?? 0));
        if (!fits) continue;
        for (const d of stayDates) taken.set(`${room.id}:${d}`, (taken.get(`${room.id}:${d}`) ?? 0) + 1);
        // Not made yet, as far as today is concerned. It still holds its room,
        // which is what keeps history identical when today moves.
        if (booking.createdAt.slice(0, 10) > today) continue;
        bookings.push(booking);
      }
    }
  }

  bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return {
    bookings,
    inventory,
    nights: expandNights(bookings),
    roomTypeNames: Object.fromEntries(hotel.roomTypes.map((room) => [room.id, room.name])),
    ratePlanNames: Object.fromEntries(hotel.ratePlans.map((plan) => [plan.id, plan.name])),
  };
}

/** Every random draw happens here, in a fixed order, whether or not the booking fits. */
function drawBooking(
  hotel: DemoHotel,
  plan: DemoRatePlan,
  checkIn: IsoDate,
  index: number,
  rng: Rng,
  today: IsoDate,
): BookingFact {
  const nights = weighted(rng, STAY_WEIGHTS);
  const [minLead, maxLead] = weighted(rng, LEAD_RANGES);
  const lead = rng.int(minLead, maxLead);
  const createdDate = addDays(checkIn, -lead);
  const createdAt = `${createdDate}T${pad(rng.int(8, 21))}:${pad(rng.int(0, 59))}:00.000Z`;

  const adults = weighted(rng, ADULT_WEIGHTS);
  const children = adults >= 2 && rng.bool(0.2) ? rng.int(1, 2) : 0;
  const guestIndex = rng.int(0, GUEST_POOL - 1);

  const willCancel = rng.bool(plan.refundable ? 0.12 : 0.04);
  const cancelOffset = rng.int(0, lead);
  const cancelDate = addDays(createdDate, cancelOffset);
  const cancelled = willCancel && cancelDate <= today;

  const nightlyBase = Array.from({ length: nights }, (_, i) =>
    isWeekendNight(addDays(checkIn, i)) ? Math.round(plan.barCents * WEEKEND_UPLIFT) : plan.barCents,
  );
  // A discount is earned by the booking itself: how early, how late, how long.
  const discountRate =
    (lead >= EARLY_BIRD.minLeadDays ? EARLY_BIRD.rate : 0) +
    (lead <= LAST_MINUTE.maxLeadDays && plan.refundable ? LAST_MINUTE.rate : 0) +
    (nights >= WEEKLY.minNights ? WEEKLY.rate : 0);
  const nightlyNetCents = nightlyBase.map((cents) => Math.round(cents * (1 - discountRate)));
  const basePriceCents = nightlyBase.reduce((total, cents) => total + cents, 0);
  const netRevenueCents = nightlyNetCents.reduce((total, cents) => total + cents, 0);

  // Non-refundable keeps everything; refundable keeps the first night inside
  // two days of arrival and nothing before that.
  const daysBeforeArrival = lead - cancelOffset;
  const cancellationFeeCents = !cancelled
    ? 0
    : !plan.refundable
      ? netRevenueCents
      : daysBeforeArrival <= 2
        ? nightlyNetCents[0]
        : 0;

  const checkOut = addDays(checkIn, nights);

  return {
    id: `demo-${plan.id}-${checkIn}-${index}`,
    createdAt,
    checkIn,
    checkOut,
    nights,
    status: cancelled ? "cancelled" : checkOut <= today ? "completed" : "confirmed",
    cancelledAt: cancelled ? `${cancelDate}T12:00:00.000Z` : null,
    adults,
    children,
    guestKey: `demo-guest-${guestIndex}`,
    guestCountry: countryOf(hotel, guestIndex),
    roomId: plan.roomId,
    ratePlanId: plan.id,
    nightlyNetCents,
    netRevenueCents,
    basePriceCents,
    discountCents: basePriceCents - netRevenueCents,
    cancellationFeeCents,
  };
}

let cache: { today: IsoDate; facts: Facts } | null = null;

/** One generation per day per server process. */
export function generateDemoFacts(today: IsoDate): Facts {
  if (cache?.today !== today) cache = { today, facts: buildDemoFacts(today) };
  return cache.facts;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test lib/analytics/demo && bun run typecheck`
Expected: PASS. If the volume test fails on the booking count or cancellation share, adjust `ZEEBURG.demand` only (not the test bounds) and re-run.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics/demo && git commit -m "Generate demo analytics facts bookings-first"
```

---

### Task 5: Revenue derivation

**Files:**
- Create: `lib/analytics/derive/revenue.ts`
- Test: `lib/analytics/derive/revenue.test.ts`

**Interfaces:**
- Consumes: `DeriveContext`, `RevenueView`; `metrics.ts`; `widget`, `makeDelta`, `toSeries`, `overlay`; `shiftYears`.
- Produces: `deriveRevenue(ctx: DeriveContext): RevenueView`

- [ ] **Step 1: Write the failing test**

`lib/analytics/derive/revenue.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, inventory, ok } from "../test-fixtures";
import { deriveRevenue } from "./revenue";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };

describe("deriveRevenue", () => {
  test("revenue is the net of kept bookings made in the period", () => {
    const f = facts([
      booking(),
      booking({ status: "cancelled", cancelledAt: "2026-09-03T10:00:00.000Z" }),
      booking({ createdAt: "2026-08-15T10:00:00.000Z", nights: 1 }),
    ]);
    const view = deriveRevenue(ctx(f, SEPT));
    expect(ok(view.revenue).value).toBe(20_000);
    expect(ok(view.revenue).delta).toMatchObject({ direction: "up", pct: 100 });
    expect(ok(view.commission).value).toBe(900);
    expect(ok(view.commission).delta).toBeNull();
  });

  test("no comparison means no delta anywhere", () => {
    const f = facts([booking(), booking({ createdAt: "2026-08-15T10:00:00.000Z" })]);
    const view = deriveRevenue(ctx(f, { ...SEPT, compare: "none" }));
    expect(ok(view.revenue).delta).toBeNull();
    expect(ok(view.adr).delta).toBeNull();
    expect(ok(view.yearToDate).delta).toBeNull();
    expect(ok(view.overTime).every((p) => p.compare === null)).toBe(true);
  });

  test("ADR and RevPAR are by stay date", () => {
    // Booked in August, stayed in September: no September revenue, but September nights.
    const f = facts(
      [booking({ createdAt: "2026-08-20T10:00:00.000Z", checkIn: "2026-09-10", nights: 3 })],
      inventory("2026-09-01", "2026-09-30", { standard: 1 }),
    );
    const view = deriveRevenue(ctx(f, SEPT));
    expect(ok(view.revenue).value).toBe(0);
    expect(ok(view.adr).value).toBe(10_000);
    expect(ok(view.revpar).value).toBe(1_000);
    expect(view.adr).toMatchObject({ basis: "stay", sample: 3 });
  });

  test("year to date does not move with the period", () => {
    const f = facts([
      booking({ createdAt: "2026-02-01T10:00:00.000Z" }),
      booking({ createdAt: "2026-09-05T10:00:00.000Z" }),
    ]);
    const a = deriveRevenue(ctx(f, { ...SEPT, today: "2026-09-30" }));
    const b = deriveRevenue(ctx(f, { from: "2026-09-24", to: "2026-09-30", today: "2026-09-30" }));
    expect(ok(a.yearToDate).value).toBe(40_000);
    expect(ok(b.yearToDate).value).toBe(40_000);
  });

  test("year to date only compares when last year is fully in the history", () => {
    const recent = facts([booking({ createdAt: "2026-02-01T10:00:00.000Z" })]);
    expect(ok(deriveRevenue(ctx(recent, SEPT)).yearToDate).delta).toBeNull();

    const established = facts([
      booking({ createdAt: "2024-12-01T10:00:00.000Z" }),
      booking({ createdAt: "2025-03-01T10:00:00.000Z", nights: 1 }),
      booking({ createdAt: "2026-02-01T10:00:00.000Z" }),
    ]);
    expect(ok(deriveRevenue(ctx(established, SEPT)).yearToDate).delta).toMatchObject({ direction: "up", pct: 100 });
  });

  test("the series sums to the revenue and flags the bucket still in progress", () => {
    const f = facts([
      booking({ createdAt: "2026-07-10T10:00:00.000Z" }),
      booking({ createdAt: "2026-09-29T10:00:00.000Z", nights: 1 }),
    ]);
    const view = deriveRevenue(ctx(f, { from: "2026-07-01", to: "2026-09-30", today: "2026-09-30" }));
    const points = ok(view.overTime);
    expect(points.reduce((t, p) => t + (p.value ?? 0), 0)).toBe(ok(view.revenue).value);
    expect(points.at(-1)!.incomplete).toBe(true);
    expect(points[0].incomplete).toBe(false);
  });

  test("both breakdowns sum to the revenue and carry shares", () => {
    const f = facts([
      booking({ roomId: "standard", ratePlanId: "flex" }),
      booking({ roomId: "suite", ratePlanId: "saver", nights: 1, nightlyNetCents: [60_000] }),
    ]);
    const view = deriveRevenue(ctx(f, SEPT));
    expect(ok(view.byRoomType)).toEqual([
      { key: "suite", label: "Junior Suite", value: 60_000, sharePct: 75 },
      { key: "standard", label: "Standard Double", value: 20_000, sharePct: 25 },
    ]);
    expect(ok(view.byRatePlan).reduce((t, r) => t + r.value, 0)).toBe(80_000);
  });

  test("an empty period is zero revenue with a zero sample, not an error", () => {
    const view = deriveRevenue(ctx(facts([booking()]), { from: "2026-03-01", to: "2026-03-31" }));
    expect(view.revenue).toMatchObject({ ok: true, sample: 0 });
    expect(ok(view.revenue).value).toBe(0);
    expect(ok(view.adr).value).toBeNull();
    expect(view.overTime).toMatchObject({ ok: true, sample: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/derive/revenue.test.ts`
Expected: FAIL, `Cannot find module './revenue'`.

- [ ] **Step 3: Implement `lib/analytics/derive/revenue.ts`**

```ts
import {
  adrCents, bookingDate, bookingsCreatedIn, commissionCents, earliestFactDate, groupSum,
  inventoryIn, keptBookings, nightsIn, revenueCents, revparCents, shares,
} from "../metrics";
import { shiftYears, type DateRange } from "../period";
import type { BookingFact, DeriveContext, RevenueView } from "../types";
import { overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

export function deriveRevenue(ctx: DeriveContext): RevenueView {
  const { facts, period, comparison, today, granularity } = ctx;

  // Booking-date basis: what was booked in the period.
  const keptIn = (range: DateRange): BookingFact[] =>
    keptBookings(bookingsCreatedIn(facts.bookings, range));
  const kept = keptIn(period);
  const prevKept = comparison ? keptIn(comparison) : null;
  const revenue = revenueCents(kept);

  // Stay-date basis: ADR and RevPAR need nights as their denominator.
  const nights = nightsIn(facts.nights, period);
  const inv = inventoryIn(facts.inventory, period);
  const prevNights = comparison ? nightsIn(facts.nights, comparison) : null;
  const prevInv = comparison ? inventoryIn(facts.inventory, comparison) : null;

  // Year to date ignores the period by design: it is the one figure a host
  // reads without first checking which period is on screen.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const ytdKept = keptIn({ from: yearStart, to: today });
  const lastYtd = { from: shiftYears(yearStart, -1), to: shiftYears(today, -1) };
  const earliest = earliestFactDate(facts);
  const ytdComparable = comparison !== null && earliest !== null && earliest <= lastYtd.from;

  return {
    revenue: widget("booking", kept.length, () => ({
      value: revenue,
      delta: makeDelta(revenue, prevKept ? revenueCents(prevKept) : null),
    })),
    yearToDate: widget("booking", ytdKept.length, () => {
      const value = revenueCents(ytdKept);
      return { value, delta: makeDelta(value, ytdComparable ? revenueCents(keptIn(lastYtd)) : null) };
    }),
    adr: widget("stay", nights.length, () => ({
      value: adrCents(nights),
      delta: makeDelta(adrCents(nights), prevNights ? adrCents(prevNights) : null),
    })),
    revpar: widget("stay", nights.length, () => ({
      value: revparCents(nights, inv),
      delta: makeDelta(
        revparCents(nights, inv),
        prevNights && prevInv ? revparCents(prevNights, prevInv) : null,
      ),
    })),
    commission: widget("booking", kept.length, () => ({ value: commissionCents(revenue), delta: null })),
    overTime: widget("booking", kept.length, () =>
      overlay(
        toSeries(kept, bookingDate, period, granularity, today, revenueCents),
        prevKept && comparison
          ? toSeries(prevKept, bookingDate, comparison, granularity, today, revenueCents)
          : null,
      ),
    ),
    byRoomType: widget("booking", kept.length, () =>
      shares(groupSum(kept, (b) => b.roomId, (b) => b.netRevenueCents), facts.roomTypeNames),
    ),
    byRatePlan: widget("booking", kept.length, () =>
      shares(groupSum(kept, (b) => b.ratePlanId, (b) => b.netRevenueCents), facts.ratePlanNames),
    ),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/analytics/derive/revenue.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/derive/revenue.ts lib/analytics/derive/revenue.test.ts
git commit -m "Derive the Revenue page view model"
```

---

### Task 6: Occupancy derivation

**Files:**
- Create: `lib/analytics/derive/occupancy.ts`
- Modify: `lib/analytics/format.ts` (append `WEEKDAY_NAMES`)
- Test: `lib/analytics/derive/occupancy.test.ts`

**Interfaces:**
- Produces: `deriveOccupancy(ctx: DeriveContext): OccupancyView`; `WEEKDAY_NAMES: readonly string[]` in `format.ts` (index 0 = Monday), also used by Task 8.

Pace covers 13 whole weeks (91 days) from today, so every point is a full week and comparable; the card is titled "Pace, next 13 weeks". Last year's point is the same week shifted back 364 days, which keeps the weekdays aligned.

- [ ] **Step 1: Write the failing test**

`lib/analytics/derive/occupancy.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, inventory, ok } from "../test-fixtures";
import { deriveOccupancy } from "./occupancy";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const twoRooms = () => inventory("2025-01-01", "2026-12-31", { standard: 2 });

describe("deriveOccupancy", () => {
  test("stats are by stay date, whenever the booking was made", () => {
    const f = facts([booking({ createdAt: "2026-06-01T10:00:00.000Z", checkIn: "2026-09-10", nights: 6 })], twoRooms());
    const view = deriveOccupancy(ctx(f, SEPT));
    expect(ok(view.nightsSold).value).toBe(6);
    expect(ok(view.nightsAvailable).value).toBe(60);
    expect(ok(view.occupancy).value).toBe(10);
    expect(view.occupancy).toMatchObject({ basis: "stay", sample: 6 });
  });

  test("out-of-order units leave the denominator", () => {
    const f = facts([booking({ nights: 6 })], inventory("2026-09-01", "2026-09-30", { standard: 2 }, 1));
    expect(ok(deriveOccupancy(ctx(f, SEPT)).nightsAvailable).value).toBe(30);
  });

  test("unsold nights count the next 30 days from today, not the period", () => {
    const f = facts([booking({ checkIn: "2026-09-10", nights: 4 })], twoRooms());
    const view = deriveOccupancy(ctx(f, { from: "2026-06-01", to: "2026-06-30", today: "2026-09-01" }));
    expect(ok(view.unsoldNext30).value).toBe(56);
  });

  test("a bucket with nothing available is a gap, not zero", () => {
    const f = facts([booking({ checkIn: "2026-09-21", nights: 6 })], inventory("2026-09-15", "2026-09-30", { standard: 2 }));
    const points = ok(deriveOccupancy(ctx(f, SEPT)).overTime);
    expect(points[0].value).toBeNull();
    expect(points.at(-1)!.value).not.toBeNull();
  });

  test("the line stays weekly on long periods", () => {
    const f = facts([booking({ nights: 6 })], twoRooms());
    const view = deriveOccupancy(ctx(f, { from: "2025-10-01", to: "2026-09-30" }));
    expect(view.overTimeGranularity).toBe("week");
    expect(ok(view.overTime).length).toBeGreaterThan(50);
  });

  test("weekday bars need five nights sold", () => {
    const thin = facts([booking({ nights: 4 })], twoRooms());
    expect(deriveOccupancy(ctx(thin, SEPT)).byWeekday).toEqual({
      ok: false, reason: "below-minimum", basis: "stay", needed: 5, have: 4,
    });

    // 14 to 20 September is Monday to Sunday: one room of two sold every night.
    const full = facts([booking({ checkIn: "2026-09-14", nights: 7 })], inventory("2026-09-14", "2026-09-20", { standard: 2 }));
    const bars = ok(deriveOccupancy(ctx(full, { from: "2026-09-14", to: "2026-09-20" })).byWeekday);
    expect(bars.map((b) => b.label)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(bars.every((b) => b.value === 50)).toBe(true);
  });

  test("the date strip is ninety days from today with Friday and Saturday marked", () => {
    const f = facts([booking({ checkIn: "2026-09-04", nights: 1 })], twoRooms());
    const cells = ok(deriveOccupancy(ctx(f, { ...SEPT, today: "2026-09-01" })).next90);
    expect(cells).toHaveLength(90);
    expect(cells[0]).toEqual({ date: "2026-09-01", sold: 0, available: 2, weekend: false });
    expect(cells[3]).toEqual({ date: "2026-09-04", sold: 1, available: 2, weekend: true });
  });

  test("pace is absent until a year of history exists", () => {
    const f = facts([booking()], twoRooms());
    expect(deriveOccupancy(ctx(f, SEPT)).pace).toBeNull();
  });

  test("pace compares what is on the books now with the same point last year", () => {
    const f = facts(
      [
        booking({ createdAt: "2026-08-01T10:00:00.000Z", checkIn: "2026-09-03", nights: 2 }),
        // Last year's equivalent week is 2 to 8 September 2025, as of 2 September 2025.
        booking({ createdAt: "2025-08-01T10:00:00.000Z", checkIn: "2025-09-04", nights: 3 }),
        // Booked after that point: not yet on the books then.
        booking({ createdAt: "2025-09-05T10:00:00.000Z", checkIn: "2025-09-06", nights: 1 }),
        // Cancelled before that point: already off the books.
        booking({ createdAt: "2025-08-01T10:00:00.000Z", checkIn: "2025-09-03", nights: 1, status: "cancelled", cancelledAt: "2025-08-20T12:00:00.000Z" }),
        // Cancelled after that point: still on the books then.
        booking({ createdAt: "2025-08-10T10:00:00.000Z", checkIn: "2025-09-07", nights: 1, status: "cancelled", cancelledAt: "2025-09-04T12:00:00.000Z" }),
      ],
      twoRooms(),
    );
    const pace = ok(deriveOccupancy(ctx(f, { ...SEPT, today: "2026-09-01" })).pace!);
    expect(pace).toHaveLength(13);
    expect(pace[0]).toMatchObject({ bucket: "2026-09-01", value: 2, compare: 4, incomplete: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/derive/occupancy.test.ts`
Expected: FAIL, `Cannot find module './occupancy'`.

- [ ] **Step 3: Implement**

Append to `lib/analytics/format.ts`:

```ts
/** Index 0 is Monday, matching `weekdayOf(date) - 1`. */
export const WEEKDAY_NAMES = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;
```

`lib/analytics/derive/occupancy.ts`:

```ts
import { formatDayMonth, WEEKDAY_NAMES } from "../format";
import {
  bookingDate, earliestFactDate, inventoryIn, MIN_SAMPLE, nightsAvailable, nightsIn,
  occupancyPct, pct,
} from "../metrics";
import { addDays, daysBetween, enumerateDates, weekdayOf, type DateRange } from "../period";
import type {
  BookingFact, DeriveContext, Granularity, InventoryFact, IsoDate, OccupancyView, Point, SoldNight,
} from "../types";
import { bucketKey, overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

const PACE_WEEKS = 13;
/** 52 whole weeks, so last year's week starts on the same weekday. */
const YEAR_OF_WEEKS = 364;

const unitsInService = (i: InventoryFact): number => Math.max(0, i.unitsTotal - i.unitsOutOfOrder);

/** Sold over available per bucket. Null where nothing was available. */
function occupancySeries(
  nights: SoldNight[],
  inventory: InventoryFact[],
  range: DateRange,
  granularity: Granularity,
  today: IsoDate,
): Point[] {
  const available = new Map<IsoDate, number>();
  for (const i of inventory) {
    const key = bucketKey(i.date, granularity);
    available.set(key, (available.get(key) ?? 0) + unitsInService(i));
  }
  return toSeries(nights, (n) => n.date, range, granularity, today, (rows, bucket) =>
    pct(rows.length, available.get(bucket.key) ?? 0),
  );
}

/** Nights in `range` held by bookings that existed, uncancelled, on `asOf`. */
function onTheBooks(bookings: BookingFact[], asOf: IsoDate, range: DateRange): number {
  let count = 0;
  for (const b of bookings) {
    if (bookingDate(b) > asOf) continue;
    if (b.cancelledAt !== null && b.cancelledAt.slice(0, 10) <= asOf) continue;
    const lastNight = addDays(b.checkOut, -1);
    const from = b.checkIn > range.from ? b.checkIn : range.from;
    const to = lastNight < range.to ? lastNight : range.to;
    if (from <= to) count += daysBetween(from, to);
  }
  return count;
}

export function deriveOccupancy(ctx: DeriveContext): OccupancyView {
  const { facts, period, comparison, today, granularity } = ctx;

  const nights = nightsIn(facts.nights, period);
  const inv = inventoryIn(facts.inventory, period);
  const prevNights = comparison ? nightsIn(facts.nights, comparison) : null;
  const prevInv = comparison ? inventoryIn(facts.inventory, comparison) : null;

  // Weekly at most: a monthly occupancy line hides the weekends it is for.
  const lineGranularity: Granularity = granularity === "month" ? "week" : granularity;

  const next30: DateRange = { from: today, to: addDays(today, 29) };
  const next90: DateRange = { from: today, to: addDays(today, 89) };
  const next90Inventory = inventoryIn(facts.inventory, next90);

  const earliest = earliestFactDate(facts);
  const hasYearOfHistory = earliest !== null && earliest <= addDays(today, -YEAR_OF_WEEKS);
  const paceRange: DateRange = { from: today, to: addDays(today, PACE_WEEKS * 7 - 1) };

  return {
    occupancy: widget("stay", nights.length, () => ({
      value: occupancyPct(nights, inv),
      delta: makeDelta(
        occupancyPct(nights, inv),
        prevNights && prevInv ? occupancyPct(prevNights, prevInv) : null,
      ),
    })),
    nightsSold: widget("stay", nights.length, () => ({
      value: nights.length,
      delta: makeDelta(nights.length, prevNights ? prevNights.length : null),
    })),
    nightsAvailable: widget("stay", nights.length, () => ({ value: nightsAvailable(inv), delta: null })),
    // Always from today: "what is still unsold" is not a question about the period.
    unsoldNext30: widget("stay", nights.length, () => ({
      value: nightsAvailable(inventoryIn(facts.inventory, next30)) - nightsIn(facts.nights, next30).length,
      delta: null,
    })),
    overTime: widget("stay", nights.length, () =>
      overlay(
        occupancySeries(nights, inv, period, lineGranularity, today),
        prevNights && prevInv && comparison
          ? occupancySeries(prevNights, prevInv, comparison, lineGranularity, today)
          : null,
      ),
    ),
    overTimeGranularity: lineGranularity,
    next90: widget("stay", nightsAvailable(next90Inventory), () => {
      const sold = new Map<IsoDate, number>();
      for (const n of nightsIn(facts.nights, next90)) sold.set(n.date, (sold.get(n.date) ?? 0) + 1);
      const available = new Map<IsoDate, number>();
      for (const i of next90Inventory) available.set(i.date, (available.get(i.date) ?? 0) + unitsInService(i));
      return enumerateDates(next90.from, next90.to).map((date) => ({
        date,
        sold: sold.get(date) ?? 0,
        available: available.get(date) ?? 0,
        weekend: weekdayOf(date) === 5 || weekdayOf(date) === 6,
      }));
    }),
    pace: hasYearOfHistory
      ? widget("stay", onTheBooks(facts.bookings, today, paceRange), () =>
          Array.from({ length: PACE_WEEKS }, (_, week) => {
            const from = addDays(today, week * 7);
            const range = { from, to: addDays(from, 6) };
            const lastYear = { from: addDays(range.from, -YEAR_OF_WEEKS), to: addDays(range.to, -YEAR_OF_WEEKS) };
            return {
              bucket: from,
              label: formatDayMonth(from),
              value: onTheBooks(facts.bookings, today, range),
              compare: onTheBooks(facts.bookings, addDays(today, -YEAR_OF_WEEKS), lastYear),
              incomplete: false,
            };
          }),
        )
      : null,
    byWeekday: widget(
      "stay",
      nights.length,
      () =>
        WEEKDAY_NAMES.map((label, index) => {
          const weekday = index + 1;
          const sold = nights.filter((n) => weekdayOf(n.date) === weekday).length;
          const available = nightsAvailable(inv.filter((i) => weekdayOf(i.date) === weekday));
          return { key: String(weekday), label, value: pct(sold, available) ?? 0 };
        }),
      MIN_SAMPLE,
    ),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/analytics/derive/occupancy.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/derive/occupancy.ts lib/analytics/derive/occupancy.test.ts lib/analytics/format.ts
git commit -m "Derive the Occupancy page view model"
```

---

### Task 7: Booking patterns derivation

**Files:**
- Create: `lib/analytics/derive/booking-patterns.ts`
- Test: `lib/analytics/derive/booking-patterns.test.ts`

**Interfaces:**
- Produces: `deriveBookingPatterns(ctx: DeriveContext): BookingPatternsView`, `LEAD_BUCKETS`, `STAY_BUCKETS`

- [ ] **Step 1: Write the failing test**

`lib/analytics/derive/booking-patterns.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, ok } from "../test-fixtures";
import { deriveBookingPatterns } from "./booking-patterns";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const made = (day: string) => `2026-09-${day}T10:00:00.000Z`;

/** Six September bookings: leads 0, 2, 9, 9, 40, 70 days; one of them cancelled. */
const six = () => [
  booking({ createdAt: made("10"), checkIn: "2026-09-10", nights: 1 }),
  booking({ createdAt: made("08"), checkIn: "2026-09-10", nights: 2 }),
  booking({ createdAt: made("01"), checkIn: "2026-09-10", nights: 2 }),
  booking({ createdAt: made("01"), checkIn: "2026-09-10", nights: 3, ratePlanId: "saver" }),
  booking({ createdAt: made("01"), checkIn: "2026-10-11", nights: 5, ratePlanId: "saver" }),
  booking({
    createdAt: made("01"), checkIn: "2026-11-10", nights: 8, ratePlanId: "saver",
    status: "cancelled", cancelledAt: "2026-09-20T12:00:00.000Z", cancellationFeeCents: 12_345,
  }),
];

describe("deriveBookingPatterns", () => {
  test("stats: count, medians and cancellation rate", () => {
    const view = deriveBookingPatterns(ctx(facts(six()), SEPT));
    expect(ok(view.bookings).value).toBe(6);
    expect(ok(view.medianLeadDays).value).toBe(9);
    // Cancelled stays never happened, so they do not lengthen the median: 1, 2, 2, 3, 5.
    expect(ok(view.medianStayNights).value).toBe(2);
    expect(ok(view.cancellationRate).value).toBeCloseTo(16.67, 1);
  });

  test("a rising cancellation rate is neutral, not green", () => {
    const f = facts([
      ...six(),
      booking({ createdAt: "2026-08-10T10:00:00.000Z" }),
      booking({ createdAt: "2026-08-11T10:00:00.000Z" }),
      booking({ createdAt: "2026-08-12T10:00:00.000Z", status: "cancelled", cancelledAt: "2026-08-13T10:00:00.000Z" }),
      ...Array.from({ length: 9 }, () => booking({ createdAt: "2026-08-14T10:00:00.000Z" })),
    ]);
    expect(ok(deriveBookingPatterns(ctx(f, SEPT)).cancellationRate).delta).toMatchObject({
      direction: "up", tone: "neutral",
    });
  });

  test("lead time uses the spec's seven buckets and counts every booking", () => {
    const bars = ok(deriveBookingPatterns(ctx(facts(six()), SEPT)).leadTime);
    expect(bars.map((b) => b.label)).toEqual([
      "Same day", "1–3 days", "4–7 days", "8–14 days", "15–30 days", "31–60 days", "61+ days",
    ]);
    expect(bars.map((b) => b.value)).toEqual([1, 1, 0, 2, 0, 1, 1]);
  });

  test("stay length uses five buckets and counts kept bookings", () => {
    const bars = ok(deriveBookingPatterns(ctx(facts(six()), SEPT)).stayLength);
    expect(bars.map((b) => b.label)).toEqual(["1 night", "2 nights", "3 nights", "4–6 nights", "7+ nights"]);
    expect(bars.map((b) => b.value)).toEqual([1, 2, 1, 1, 0]);
  });

  test("distributions decline below five bookings", () => {
    const view = deriveBookingPatterns(ctx(facts(six().slice(0, 3)), SEPT));
    expect(view.leadTime).toEqual({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 3 });
    expect(view.byRatePlan).toMatchObject({ ok: false, reason: "below-minimum" });
    expect(ok(view.bookings).value).toBe(3);
  });

  test("cancellations are bucketed by days before check-in, on the lead-time buckets", () => {
    const cancelledOn = (date: string, checkIn: string) =>
      booking({ createdAt: made("01"), checkIn, status: "cancelled", cancelledAt: `${date}T12:00:00.000Z` });
    const f = facts([
      cancelledOn("2026-09-10", "2026-09-10"),
      cancelledOn("2026-09-08", "2026-09-10"),
      cancelledOn("2026-09-05", "2026-09-25"),
      cancelledOn("2026-09-05", "2026-09-25"),
      cancelledOn("2026-09-02", "2026-12-01"),
    ]);
    const bars = ok(deriveBookingPatterns(ctx(f, SEPT)).cancellationsByDaysBefore);
    expect(bars.map((b) => b.value)).toEqual([1, 1, 0, 0, 2, 0, 1]);
  });

  test("the rate plan table carries the rate and the fees retained", () => {
    const rows = ok(deriveBookingPatterns(ctx(facts(six()), SEPT)).byRatePlan);
    expect(rows).toEqual([
      { key: "flex", label: "Flexible", bookings: 3, cancelled: 0, ratePct: 0, feesRetainedCents: 0 },
      { key: "saver", label: "Saver", bookings: 3, cancelled: 1, ratePct: (1 / 3) * 100, feesRetainedCents: 12_345 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/derive/booking-patterns.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/analytics/derive/booking-patterns.ts`**

```ts
import {
  bookingsCreatedIn, isCancelled, keptBookings, leadDays, median, MIN_SAMPLE, pct, sum,
} from "../metrics";
import { daysBetween } from "../period";
import type { Bar, BookingFact, BookingPatternsView, CancellationRow, DeriveContext } from "../types";
import { makeDelta } from "./delta";
import { widget } from "./widget";

interface BucketDef {
  key: string;
  label: string;
  /** Inclusive upper bound. */
  max: number;
}

export const LEAD_BUCKETS: readonly BucketDef[] = [
  { key: "same-day", label: "Same day", max: 0 },
  { key: "1-3", label: "1–3 days", max: 3 },
  { key: "4-7", label: "4–7 days", max: 7 },
  { key: "8-14", label: "8–14 days", max: 14 },
  { key: "15-30", label: "15–30 days", max: 30 },
  { key: "31-60", label: "31–60 days", max: 60 },
  { key: "61+", label: "61+ days", max: Number.POSITIVE_INFINITY },
];

export const STAY_BUCKETS: readonly BucketDef[] = [
  { key: "1", label: "1 night", max: 1 },
  { key: "2", label: "2 nights", max: 2 },
  { key: "3", label: "3 nights", max: 3 },
  { key: "4-6", label: "4–6 nights", max: 6 },
  { key: "7+", label: "7+ nights", max: Number.POSITIVE_INFINITY },
];

function histogram(values: number[], defs: readonly BucketDef[]): Bar[] {
  const bars = defs.map((def) => ({ key: def.key, label: def.label, value: 0 }));
  for (const value of values) bars[defs.findIndex((def) => value <= def.max)].value += 1;
  return bars;
}

/** Whole days between the cancellation and check-in. A late cancellation is same-day. */
const daysBeforeCheckIn = (b: BookingFact): number =>
  Math.max(0, daysBetween(b.cancelledAt!.slice(0, 10), b.checkIn) - 1);

const cancellationRate = (bookings: BookingFact[]): number | null =>
  pct(bookings.filter(isCancelled).length, bookings.length);

export function deriveBookingPatterns(ctx: DeriveContext): BookingPatternsView {
  const { facts, period, comparison } = ctx;

  const created = bookingsCreatedIn(facts.bookings, period);
  const kept = keptBookings(created);
  const cancelled = created.filter(isCancelled);
  const prev = comparison ? bookingsCreatedIn(facts.bookings, comparison) : null;

  const medianLead = (rows: BookingFact[]) => median(rows.map(leadDays));
  const medianStay = (rows: BookingFact[]) => median(keptBookings(rows).map((b) => b.nights));

  return {
    bookings: widget("booking", created.length, () => ({
      value: created.length,
      delta: makeDelta(created.length, prev ? prev.length : null),
    })),
    medianLeadDays: widget("booking", created.length, () => ({
      value: medianLead(created),
      delta: makeDelta(medianLead(created), prev ? medianLead(prev) : null, "neutral"),
    })),
    medianStayNights: widget("booking", kept.length, () => ({
      value: medianStay(created),
      delta: makeDelta(medianStay(created), prev ? medianStay(prev) : null, "neutral"),
    })),
    cancellationRate: widget("booking", created.length, () => ({
      value: cancellationRate(created),
      delta: makeDelta(cancellationRate(created), prev ? cancellationRate(prev) : null, "neutral"),
    })),
    leadTime: widget("booking", created.length, () => histogram(created.map(leadDays), LEAD_BUCKETS), MIN_SAMPLE),
    stayLength: widget("booking", kept.length, () => histogram(kept.map((b) => b.nights), STAY_BUCKETS), MIN_SAMPLE),
    cancellationsByDaysBefore: widget(
      "booking",
      cancelled.length,
      () => histogram(cancelled.map(daysBeforeCheckIn), LEAD_BUCKETS),
      MIN_SAMPLE,
    ),
    byRatePlan: widget(
      "booking",
      created.length,
      () => {
        const plans = new Map<string, BookingFact[]>();
        for (const b of created) {
          const rows = plans.get(b.ratePlanId);
          if (rows) rows.push(b);
          else plans.set(b.ratePlanId, [b]);
        }
        return [...plans.entries()]
          .map(([key, rows]): CancellationRow => {
            const lost = rows.filter(isCancelled);
            return {
              key,
              label: facts.ratePlanNames[key] ?? key,
              bookings: rows.length,
              cancelled: lost.length,
              ratePct: pct(lost.length, rows.length),
              feesRetainedCents: sum(lost, (b) => b.cancellationFeeCents),
            };
          })
          .sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label));
      },
      MIN_SAMPLE,
    ),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/analytics/derive/booking-patterns.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/derive/booking-patterns.ts lib/analytics/derive/booking-patterns.test.ts
git commit -m "Derive the Booking patterns page view model"
```

---

### Task 8: Pricing derivation

**Files:**
- Create: `lib/analytics/derive/pricing.ts`
- Test: `lib/analytics/derive/pricing.test.ts`

**Interfaces:**
- Consumes: `WEEKDAY_NAMES` from Task 6.
- Produces: `derivePricing(ctx: DeriveContext): PricingView`, `HINT_OCCUPANCY_PCT = 85`

- [ ] **Step 1: Write the failing test**

`lib/analytics/derive/pricing.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, inventory, ok } from "../test-fixtures";
import { derivePricing } from "./pricing";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };

describe("derivePricing", () => {
  test("discounts: euros given, share of bookings, and depth among discounted bookings", () => {
    const f = facts([
      booking({ nights: 1, nightlyNetCents: [9_000], discountCents: 1_000 }),
      booking({ nights: 1, nightlyNetCents: [10_000] }),
      booking({ nights: 1, nightlyNetCents: [16_000], discountCents: 4_000 }),
      booking({ nights: 1, nightlyNetCents: [10_000], discountCents: 9_999, status: "cancelled", cancelledAt: "2026-09-02T10:00:00.000Z" }),
    ]);
    const view = derivePricing(ctx(f, SEPT));
    expect(ok(view.discounts).value).toBe(5_000);
    expect(ok(view.discounts).shareOfBookingsPct).toBeCloseTo(66.67, 1);
    // 5,000 given on 30,000 of rack rate.
    expect(ok(view.discountDepth).value).toBeCloseTo(16.67, 1);
  });

  test("no discounted bookings: zero given and no depth to report", () => {
    const view = derivePricing(ctx(facts([booking()]), SEPT));
    expect(ok(view.discounts).value).toBe(0);
    expect(ok(view.discounts).shareOfBookingsPct).toBe(0);
    expect(ok(view.discountDepth).value).toBeNull();
  });

  test("ADR and its trend are by stay date, and an empty bucket is a gap", () => {
    const f = facts([
      booking({ createdAt: "2026-08-01T10:00:00.000Z", checkIn: "2026-09-02", nights: 2, nightlyNetCents: [10_000, 14_000] }),
    ]);
    const view = derivePricing(ctx(f, { from: "2026-09-01", to: "2026-09-04" }));
    expect(ok(view.adr).value).toBe(12_000);
    expect(view.adr).toMatchObject({ basis: "stay", sample: 2 });
    expect(ok(view.adrOverTime).map((p) => p.value)).toEqual([null, 10_000, 14_000, null]);
  });

  test("the rate plan table is by booking date and sums to the revenue", () => {
    const f = facts([
      booking({ ratePlanId: "flex", nights: 2 }),
      booking({ ratePlanId: "flex", nights: 1, nightlyNetCents: [13_000] }),
      booking({ ratePlanId: "saver", nights: 4, nightlyNetCents: [8_000, 8_000, 8_000, 8_000] }),
      booking({ ratePlanId: "saver", status: "cancelled", cancelledAt: "2026-09-02T10:00:00.000Z" }),
    ]);
    expect(ok(derivePricing(ctx(f, SEPT)).byRatePlan)).toEqual([
      { key: "flex", label: "Flexible", bookings: 2, nights: 3, adrCents: 11_000, revenueCents: 33_000 },
      { key: "saver", label: "Saver", bookings: 1, nights: 4, adrCents: 8_000, revenueCents: 32_000 },
    ]);
  });

  test("a weekday that sells out below the average rate gets the hint", () => {
    const night = (checkIn: string, cents: number) => booking({ checkIn, nights: 1, nightlyNetCents: [cents] });
    const f = facts(
      [
        // Every Friday in September 2026, cheaply.
        night("2026-09-04", 8_000), night("2026-09-11", 8_000), night("2026-09-18", 8_000), night("2026-09-25", 8_000),
        // Two of four Mondays, at a high rate.
        night("2026-09-07", 15_000), night("2026-09-14", 15_000),
      ],
      inventory("2026-09-01", "2026-09-30", { standard: 1 }),
    );
    const rows = ok(derivePricing(ctx(f, SEPT)).byWeekday);
    expect(rows.find((r) => r.label === "Friday")).toEqual({
      weekday: 5, label: "Friday", occupancyPct: 100, adrCents: 8_000, hint: true,
    });
    expect(rows.find((r) => r.label === "Monday")).toMatchObject({ occupancyPct: 50, adrCents: 15_000, hint: false });
    expect(rows.find((r) => r.label === "Tuesday")).toMatchObject({ occupancyPct: 0, adrCents: null, hint: false });
  });

  test("the weekday table needs five nights sold", () => {
    const view = derivePricing(ctx(facts([booking({ nights: 2 })]), SEPT));
    expect(view.byWeekday).toEqual({ ok: false, reason: "below-minimum", basis: "stay", needed: 5, have: 2 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/derive/pricing.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/analytics/derive/pricing.ts`**

```ts
import { WEEKDAY_NAMES } from "../format";
import {
  adrCents, bookingsCreatedIn, inventoryIn, keptBookings, MIN_SAMPLE, nightsIn, occupancyPct,
  pct, ratio, revenueCents, stayRevenueCents, sum,
} from "../metrics";
import { weekdayOf } from "../period";
import type { BookingFact, DeriveContext, PricingView, RatePlanRow, SoldNight } from "../types";
import { overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

/** Above this occupancy, a weekday priced below average is leaving money on the table. */
export const HINT_OCCUPANCY_PCT = 85;

const discountedOnly = (rows: BookingFact[]) => rows.filter((b) => b.discountCents > 0);
const discountsGiven = (rows: BookingFact[]) => sum(rows, (b) => b.discountCents);

/** Discount as a share of the rack rate, among the bookings that got one. */
function discountDepth(rows: BookingFact[]): number | null {
  const discounted = discountedOnly(rows);
  return pct(discountsGiven(discounted), sum(discounted, (b) => b.basePriceCents));
}

const bucketAdr = (rows: SoldNight[]): number | null => ratio(stayRevenueCents(rows), rows.length);

export function derivePricing(ctx: DeriveContext): PricingView {
  const { facts, period, comparison, today, granularity } = ctx;

  // Stay-date basis: the ADR stat, its trend and the weekday table.
  const nights = nightsIn(facts.nights, period);
  const inv = inventoryIn(facts.inventory, period);
  const prevNights = comparison ? nightsIn(facts.nights, comparison) : null;
  const periodAdr = adrCents(nights);

  // Booking-date basis: discounts and the rate plan table.
  const kept = keptBookings(bookingsCreatedIn(facts.bookings, period));
  const prevKept = comparison ? keptBookings(bookingsCreatedIn(facts.bookings, comparison)) : null;

  return {
    adr: widget("stay", nights.length, () => ({
      value: periodAdr,
      delta: makeDelta(periodAdr, prevNights ? adrCents(prevNights) : null),
    })),
    discounts: widget("booking", kept.length, () => ({
      value: discountsGiven(kept),
      shareOfBookingsPct: pct(discountedOnly(kept).length, kept.length),
      delta: makeDelta(discountsGiven(kept), prevKept ? discountsGiven(prevKept) : null, "neutral"),
    })),
    discountDepth: widget("booking", kept.length, () => ({
      value: discountDepth(kept),
      delta: makeDelta(discountDepth(kept), prevKept ? discountDepth(prevKept) : null, "neutral"),
    })),
    adrOverTime: widget("stay", nights.length, () =>
      overlay(
        toSeries(nights, (n) => n.date, period, granularity, today, bucketAdr),
        prevNights && comparison
          ? toSeries(prevNights, (n) => n.date, comparison, granularity, today, bucketAdr)
          : null,
      ),
    ),
    byRatePlan: widget(
      "booking",
      kept.length,
      () => {
        const plans = new Map<string, BookingFact[]>();
        for (const b of kept) {
          const rows = plans.get(b.ratePlanId);
          if (rows) rows.push(b);
          else plans.set(b.ratePlanId, [b]);
        }
        return [...plans.entries()]
          .map(([key, rows]): RatePlanRow => {
            const planNights = sum(rows, (b) => b.nights);
            return {
              key,
              label: facts.ratePlanNames[key] ?? key,
              bookings: rows.length,
              nights: planNights,
              adrCents: ratio(revenueCents(rows), planNights),
              revenueCents: revenueCents(rows),
            };
          })
          .sort((a, b) => b.revenueCents - a.revenueCents || a.label.localeCompare(b.label));
      },
    ),
    byWeekday: widget(
      "stay",
      nights.length,
      () =>
        WEEKDAY_NAMES.map((label, index) => {
          const weekday = index + 1;
          const dayNights = nights.filter((n) => weekdayOf(n.date) === weekday);
          const occupancy = occupancyPct(dayNights, inv.filter((i) => weekdayOf(i.date) === weekday));
          const adr = adrCents(dayNights);
          return {
            weekday,
            label,
            occupancyPct: occupancy,
            adrCents: adr,
            hint:
              occupancy !== null && occupancy > HINT_OCCUPANCY_PCT &&
              adr !== null && periodAdr !== null && adr < periodAdr,
          };
        }),
      MIN_SAMPLE,
    ),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/analytics/derive/pricing.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/derive/pricing.ts lib/analytics/derive/pricing.test.ts
git commit -m "Derive the Pricing page view model"
```

---

### Task 9: Guests derivation with suppression

**Files:**
- Create: `lib/analytics/derive/guests.ts`
- Test: `lib/analytics/derive/guests.test.ts`

**Interfaces:**
- Produces: `deriveGuests(ctx: DeriveContext): GuestsView`, `countryName(code: string): string`

- [ ] **Step 1: Write the failing test**

`lib/analytics/derive/guests.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, ok } from "../test-fixtures";
import { deriveGuests } from "./guests";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const from = (country: string, count: number, over = {}) =>
  Array.from({ length: count }, () => booking({ guestCountry: country, ...over }));

describe("deriveGuests", () => {
  test("a country is named only with five distinct guests behind it", () => {
    const f = facts([
      ...from("NL", 6),
      // Five bookings, one guest: naming Japan would name the guest.
      ...from("JP", 5, { guestKey: "one-regular" }),
      ...from("DE", 4),
    ]);
    expect(ok(deriveGuests(ctx(f, SEPT)).countries)).toEqual([
      { key: "NL", label: "Netherlands", value: 6, sharePct: 40 },
      { key: "OTHER", label: "Other", value: 9, sharePct: 60 },
    ]);
  });

  test("at most five countries are named; the rest join Other", () => {
    const f = facts(["NL", "BE", "DE", "GB", "FR", "US", "IT"].flatMap((c, i) => from(c, 12 - i)));
    const rows = ok(deriveGuests(ctx(f, SEPT)).countries);
    expect(rows.map((r) => r.key)).toEqual(["NL", "BE", "DE", "GB", "FR", "OTHER"]);
    expect(rows.at(-1)!.value).toBe(7 + 6);
    expect(rows.reduce((t, r) => t + r.value, 0)).toBe(63);
  });

  test("the page declines entirely below five distinct guests", () => {
    const f = facts(from("NL", 8, { guestKey: "one-regular" }));
    const view = deriveGuests(ctx(f, SEPT));
    expect(view.countries).toEqual({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 1 });
    expect(view.groupTypes).toMatchObject({ ok: false, reason: "below-minimum" });
  });

  test("group types are suppressed by the same rule", () => {
    const f = facts([
      ...from("NL", 6, { adults: 2 }),
      ...from("NL", 5, { adults: 1 }),
      ...from("NL", 2, { adults: 2, children: 1 }),
    ]);
    expect(ok(deriveGuests(ctx(f, SEPT)).groupTypes).map((r) => [r.key, r.value])).toEqual([
      ["couple", 6], ["solo", 5], ["OTHER", 2],
    ]);
  });

  test("cancelled bookings brought nobody and are counted nowhere", () => {
    const f = facts([
      ...from("NL", 6, { adults: 2 }),
      ...from("NL", 6, { adults: 4, status: "cancelled", cancelledAt: "2026-09-02T10:00:00.000Z" }),
    ]);
    const view = deriveGuests(ctx(f, SEPT));
    expect(ok(view.countries)[0].value).toBe(6);
    expect(ok(view.medianPartySize).value).toBe(2);
    expect(view.medianPartySize).toMatchObject({ sample: 6 });
  });

  test("returning is judged against all history, not the period", () => {
    const f = facts([
      booking({ guestKey: "regular", createdAt: "2025-05-01T10:00:00.000Z", checkIn: "2025-06-01" }),
      booking({ guestKey: "regular" }),
      booking(), booking(), booking(),
    ]);
    expect(ok(deriveGuests(ctx(f, SEPT)).returning).value).toBe(25);
  });

  test("an empty period has no answer, not zero guests of size NaN", () => {
    const view = deriveGuests(ctx(facts([]), SEPT));
    expect(ok(view.returning).value).toBeNull();
    expect(ok(view.medianPartySize).value).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/derive/guests.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/analytics/derive/guests.ts`**

```ts
import {
  bookingsCreatedIn, groupTypeOf, keptBookings, median, MIN_SAMPLE, OTHER_KEY, pct, sum, TOP_N,
} from "../metrics";
import type { BookingFact, DeriveContext, GroupType, GuestsView, IsoDate, Share } from "../types";
import { makeDelta } from "./delta";
import { widget } from "./widget";

const GROUP_LABELS: Record<GroupType, string> = {
  solo: "Solo",
  couple: "Couple",
  family: "Family",
  group: "Group",
};

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Bookings per segment, with any segment backed by fewer than five distinct
 * guests folded into Other. The threshold is on guests, not bookings: five
 * bookings from one regular would otherwise put that guest's country on screen
 * and in the CSV. The fold lives here, in the view model, so no consumer can
 * skip it.
 */
function suppressedShares(
  rows: BookingFact[],
  key: (b: BookingFact) => string,
  label: (key: string) => string,
  top: number,
): Share[] {
  const segments = new Map<string, { bookings: number; guests: Set<string> }>();
  for (const b of rows) {
    const segment = segments.get(key(b)) ?? { bookings: 0, guests: new Set<string>() };
    segment.bookings += 1;
    segment.guests.add(b.guestKey);
    segments.set(key(b), segment);
  }

  let folded = 0;
  const named: { key: string; label: string; value: number }[] = [];
  for (const [segmentKey, segment] of segments) {
    if (segment.guests.size < MIN_SAMPLE) folded += segment.bookings;
    else named.push({ key: segmentKey, label: label(segmentKey), value: segment.bookings });
  }
  named.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const head = named.slice(0, top);
  const other = folded + sum(named.slice(top), (row) => row.value);
  const all = other > 0 ? [...head, { key: OTHER_KEY, label: "Other", value: other }] : head;
  const total = sum(all, (row) => row.value);
  return all.map((row) => ({ ...row, sharePct: pct(row.value, total) ?? 0 }));
}

export function deriveGuests(ctx: DeriveContext): GuestsView {
  const { facts, period, comparison } = ctx;

  // One population for every figure on the page: kept bookings made in the period.
  const kept = keptBookings(bookingsCreatedIn(facts.bookings, period));
  const prevKept = comparison ? keptBookings(bookingsCreatedIn(facts.bookings, comparison)) : null;
  const distinctGuests = new Set(kept.map((b) => b.guestKey)).size;

  // A guest's first stay, across all history: a second stay is a second stay
  // whichever window the host is looking at.
  const firstStay = new Map<string, IsoDate>();
  for (const b of keptBookings(facts.bookings)) {
    const seen = firstStay.get(b.guestKey);
    if (seen === undefined || b.checkIn < seen) firstStay.set(b.guestKey, b.checkIn);
  }
  const returningPct = (rows: BookingFact[]): number | null =>
    pct(rows.filter((b) => (firstStay.get(b.guestKey) ?? b.checkIn) < b.checkIn).length, rows.length);
  const partySize = (rows: BookingFact[]): number | null =>
    median(rows.map((b) => b.adults + b.children));

  return {
    returning: widget("booking", kept.length, () => ({
      value: returningPct(kept),
      delta: makeDelta(returningPct(kept), prevKept ? returningPct(prevKept) : null),
    })),
    medianPartySize: widget("booking", kept.length, () => ({
      value: partySize(kept),
      delta: makeDelta(partySize(kept), prevKept ? partySize(prevKept) : null, "neutral"),
    })),
    countries: widget(
      "booking",
      distinctGuests,
      () => suppressedShares(kept, (b) => b.guestCountry, countryName, TOP_N),
      MIN_SAMPLE,
    ),
    groupTypes: widget(
      "booking",
      distinctGuests,
      () => suppressedShares(kept, groupTypeOf, (key) => GROUP_LABELS[key as GroupType], 4),
      MIN_SAMPLE,
    ),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test lib/analytics/derive/guests.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/derive/guests.ts lib/analytics/derive/guests.test.ts
git commit -m "Derive the Guests page view model with distinct-guest suppression"
```

---

### Task 10: Page data entry point, CSV, reconciliation and guards

**Files:**
- Create: `lib/analytics/get-analytics.ts`, `lib/analytics/get-analytics.test.ts`, `lib/analytics/csv.ts`, `lib/analytics/csv.test.ts`, `lib/analytics/reconciliation.test.ts`, `lib/analytics/guards.test.ts`

**Interfaces:**
- Consumes: the five `derive*` functions, `generateDemoFacts`, `earliestFactDate`, Task 2 period functions.
- Produces:
  - `interface PageQuery { period: Period; compare: CompareMode; today: IsoDate; demo: boolean }`
  - `getPageData<P extends PageId>(page: P, query: PageQuery): Promise<PageData<P>>`
  - `isDemoParam(value: string | string[] | undefined): boolean`
  - `pageCsv(data: AnyPageData): string`, `csvFilename(data: AnyPageData): string`

- [ ] **Step 1: Write the failing tests**

`lib/analytics/get-analytics.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { getPageData, isDemoParam } from "./get-analytics";
import { PAGE_IDS } from "./pages";
import { resolvePeriod } from "./period";
import type { Widget } from "./types";

const TODAY = "2026-10-01";
const query = (over = {}) => ({
  period: resolvePeriod("last-3-months", TODAY),
  compare: "previous" as const,
  today: TODAY,
  demo: true,
  ...over,
});
const custom = (from: string, to: string) => resolvePeriod("custom", TODAY, { from, to });

/** Every number anywhere in a payload. */
function numbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => numbers(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbers(v, out));
  return out;
}

const value = <T,>(w: Widget<T>): T => {
  if (!w.ok) throw new Error("widget did not render");
  return w.value;
};

describe("isDemoParam", () => {
  test("only the literal 1 is demo", () => {
    expect(isDemoParam("1")).toBe(true);
    expect(isDemoParam(["1", "0"])).toBe(true);
    expect(isDemoParam("true")).toBe(false);
    expect(isDemoParam(undefined)).toBe(false);
  });
});

describe("getPageData", () => {
  test("outside demo there are no facts and no bookings, on every page", async () => {
    for (const page of PAGE_IDS) {
      const data = await getPageData(page, query({ demo: false }));
      expect(data).toMatchObject({ page, isDemo: false, hasAnyBookings: false, comparison: null });
      expect(numbers(data).every(Number.isFinite)).toBe(true);
    }
  });

  test("demo fills every page", async () => {
    for (const page of PAGE_IDS) {
      const data = await getPageData(page, query());
      expect(data).toMatchObject({ page, isDemo: true, hasAnyBookings: true, compare: "previous" });
      expect(data.comparison).not.toBeNull();
    }
  });

  test("last-year is honoured with a year of history and falls back without", async () => {
    const recent = await getPageData("revenue", query({ compare: "last-year" }));
    expect(recent).toMatchObject({ compare: "last-year", canCompareLastYear: true });
    expect(recent.comparison).toEqual({ from: "2025-07-02", to: "2025-10-01" });

    const early = await getPageData("revenue", query({ compare: "last-year", period: custom("2024-07-01", "2024-07-31") }));
    expect(early).toMatchObject({ compare: "previous", canCompareLastYear: false });
  });

  test("a range older than all history renders zeros with no comparison, not the never-booked state", async () => {
    const data = await getPageData("revenue", query({ period: custom("2022-01-01", "2022-01-31") }));
    expect(data.hasAnyBookings).toBe(true);
    expect(data.comparison).toBeNull();
    expect(value(data.view.revenue)).toEqual({ value: 0, delta: null });
    expect(data.view.overTime).toMatchObject({ ok: true, sample: 0 });
  });

  test("a range entirely in the future: nothing booked in it yet, but nights already sold", async () => {
    const future = custom("2026-11-01", "2026-11-30");
    const revenue = await getPageData("revenue", query({ period: future }));
    expect(value(revenue.view.revenue).value).toBe(0);
    expect(revenue.view.revenue).toMatchObject({ sample: 0 });

    const occupancy = await getPageData("occupancy", query({ period: future }));
    expect(value(occupancy.view.nightsSold).value).toBeGreaterThan(0);

    for (const page of PAGE_IDS) {
      const data = await getPageData(page, query({ period: future }));
      expect(numbers(data).every(Number.isFinite)).toBe(true);
    }
  });

  test("compare none removes the comparison everywhere", async () => {
    const data = await getPageData("revenue", query({ compare: "none" }));
    expect(data.comparison).toBeNull();
    expect(value(data.view.revenue).delta).toBeNull();
  });
});
```

`lib/analytics/reconciliation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { getPageData } from "./get-analytics";
import { COMMISSION_RATE } from "./metrics";
import { resolvePeriod, type PeriodPreset } from "./period";
import type { Widget } from "./types";

const TODAY = "2026-10-01";
const PRESETS: PeriodPreset[] = ["last-7-days", "last-30-days", "last-3-months", "last-12-months", "ytd"];

const value = <T,>(w: Widget<T>): T => {
  if (!w.ok) throw new Error("widget did not render");
  return w.value;
};
const total = (rows: { value: number | null }[]) => rows.reduce((t, r) => t + (r.value ?? 0), 0);

/**
 * Identities that hold because every figure is derived from one set of
 * bookings. If one fails, a derivation has started counting something else.
 */
describe.each(PRESETS)("reconciliation over %s", (preset) => {
  const q = { period: resolvePeriod(preset, TODAY), compare: "previous" as const, today: TODAY, demo: true };

  test("revenue: commission, breakdowns and the series all agree with the total", async () => {
    const { view } = await getPageData("revenue", q);
    const revenue = value(view.revenue).value!;
    expect(value(view.commission).value).toBe(Math.round(revenue * COMMISSION_RATE));
    expect(total(value(view.byRoomType))).toBe(revenue);
    expect(total(value(view.byRatePlan))).toBe(revenue);
    expect(total(value(view.overTime))).toBe(revenue);
  });

  test("RevPAR equals ADR times occupancy", async () => {
    const revenue = (await getPageData("revenue", q)).view;
    const occupancy = (await getPageData("occupancy", q)).view;
    const adr = value(revenue.adr).value!;
    const occ = value(occupancy.occupancy).value!;
    expect(value(revenue.revpar).value!).toBeCloseTo((adr * occ) / 100, 6);
    expect(value(occupancy.nightsSold).value!).toBeLessThanOrEqual(value(occupancy.nightsAvailable).value!);
  });

  test("the same ADR on Revenue and Pricing", async () => {
    const revenue = (await getPageData("revenue", q)).view;
    const pricing = (await getPageData("pricing", q)).view;
    expect(value(pricing.adr).value).toBe(value(revenue.adr).value);
  });

  test("bookings, cancellations, stays and guests count the same bookings", async () => {
    const patterns = (await getPageData("booking-patterns", q)).view;
    const pricing = (await getPageData("pricing", q)).view;
    const guests = (await getPageData("guests", q)).view;
    const revenue = (await getPageData("revenue", q)).view;

    const bookings = value(patterns.bookings).value!;
    const table = value(patterns.byRatePlan);
    const cancelled = table.reduce((t, r) => t + r.cancelled, 0);
    expect(total(value(patterns.leadTime))).toBe(bookings);
    expect(table.reduce((t, r) => t + r.bookings, 0)).toBe(bookings);
    expect(total(value(patterns.stayLength))).toBe(bookings - cancelled);

    const plans = value(pricing.byRatePlan);
    expect(plans.reduce((t, r) => t + r.bookings, 0)).toBe(bookings - cancelled);
    expect(plans.reduce((t, r) => t + r.revenueCents, 0)).toBe(value(revenue.revenue).value!);
    expect(total(value(guests.countries))).toBe(bookings - cancelled);
    expect(total(value(guests.groupTypes))).toBe(bookings - cancelled);
  });
});

test("year to date is the same figure whatever the period", async () => {
  const figures = await Promise.all(
    PRESETS.map(async (preset) => {
      const { view } = await getPageData("revenue", {
        period: resolvePeriod(preset, TODAY), compare: "previous", today: TODAY, demo: true,
      });
      return value(view.yearToDate).value;
    }),
  );
  expect(new Set(figures).size).toBe(1);
  expect(figures[0]).toBeGreaterThan(0);
});
```

`lib/analytics/csv.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { csvFilename, pageCsv } from "./csv";
import { getPageData } from "./get-analytics";
import { PAGE_IDS } from "./pages";
import { resolvePeriod } from "./period";
import type { AnyPageData } from "./types";

const TODAY = "2026-10-01";
const q = { period: resolvePeriod("last-3-months", TODAY), compare: "previous" as const, today: TODAY, demo: true };

describe("pageCsv", () => {
  test("every page exports a header and rows, with no stray undefined or NaN", async () => {
    for (const page of PAGE_IDS) {
      // A loop variable is the whole union, which TypeScript cannot narrow per iteration.
      const csv = pageCsv((await getPageData(page, q)) as AnyPageData);
      expect(csv.startsWith("Page,")).toBe(true);
      expect(csv).toContain("From,2026-07-02");
      expect(csv).toContain("Metric,Key,Value,Note");
      expect(csv).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  test("money is in euros with cents", async () => {
    const csv = pageCsv(await getPageData("revenue", q));
    expect(csv).toMatch(/^Revenue \(EUR\),,\d+\.\d{2},/m);
  });

  test("the guests export names exactly the countries the page names", async () => {
    const data = await getPageData("guests", q);
    if (!data.view.countries.ok) throw new Error("countries did not render");
    const exported = pageCsv(data).split("\n").filter((line) => line.startsWith("Booker country,")).map((line) => line.split(",")[1]);
    expect(exported).toEqual(data.view.countries.value.map((row) => row.label));
  });

  test("a widget below its minimum says so, without figures", async () => {
    const thin = await getPageData("guests", { ...q, period: resolvePeriod("custom", TODAY, { from: "2022-01-01", to: "2022-01-02" }) });
    expect(pageCsv(thin)).toContain("Booker country,,not enough data,");
  });

  test("the filename carries the page and range and no property", async () => {
    expect(csvFilename(await getPageData("booking-patterns", q))).toBe("analytics-booking-patterns-2026-07-02-to-2026-10-01.csv");
  });
});
```

`lib/analytics/guards.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
    }),
  );
  return files.flat().filter((file) => /\.tsx?$/.test(file));
}

const ROOTS = ["lib/analytics", "app/(dashboard)/dashboard/analytics"];
/** This file has to name what it forbids. */
const SELF = "guards.test.ts";

async function offenders(pattern: RegExp, allow: string[] = []): Promise<string[]> {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of await walk(root)) {
      if (file.endsWith(SELF) || allow.some((name) => file.endsWith(name))) continue;
      (await readFile(file, "utf8")).split("\n").forEach((line, index) => {
        if (pattern.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
  }
  return found;
}

describe("analytics guards", () => {
  /**
   * The host's property comes from the session, on the server, in one file.
   * Anything else that names a property identifier is a way to ask for
   * someone else's numbers.
   */
  test("no property identifier outside the readiness query", async () => {
    expect(
      await offenders(/propertyId|property_id|params\.property\b|["']property["']/, ["readiness-query.ts"]),
    ).toEqual([]);
  });

  test("hosts read occupancy, never the old term", async () => {
    expect(await offenders(/sell[- ]?through/i, ["routes.test.ts"])).toEqual([]);
  });

  test("no pie, donut or radial chart", async () => {
    expect(await offenders(/PieChart|RadialBar|<Pie\b/)).toEqual([]);
  });

  test("no smoothed lines", async () => {
    expect(await offenders(/type=["']monotone["']|type=["']natural["']|type=["']basis["']/)).toEqual([]);
  });

  test("no demo-only failure switch", async () => {
    expect(await offenders(/params\.fail\b|\bfail\?:/)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/get-analytics.test.ts lib/analytics/csv.test.ts lib/analytics/reconciliation.test.ts lib/analytics/guards.test.ts`
Expected: FAIL, `get-analytics` and `csv` not found. `guards.test.ts` passes already; it is here to stay green as the UI lands.

- [ ] **Step 3: Implement `lib/analytics/get-analytics.ts`**

```ts
import { generateDemoFacts } from "./demo/generate";
import { deriveBookingPatterns } from "./derive/booking-patterns";
import { deriveGuests } from "./derive/guests";
import { deriveOccupancy } from "./derive/occupancy";
import { derivePricing } from "./derive/pricing";
import { deriveRevenue } from "./derive/revenue";
import { earliestFactDate } from "./metrics";
import type { PageId } from "./pages";
import { comparisonRange, granularityFor, shiftYears, type CompareMode, type Period } from "./period";
import type { DeriveContext, Facts, IsoDate, PageData, PageViews } from "./types";

/** Everything a page asks for. There is no way to name a property. */
export interface PageQuery {
  period: Period;
  compare: CompareMode;
  today: IsoDate;
  /** Opt-in. Never inferred from the absence of real data. */
  demo: boolean;
}

const EMPTY_FACTS: Facts = {
  bookings: [], inventory: [], nights: [], roomTypeNames: {}, ratePlanNames: {},
};

const DERIVE: { [P in PageId]: (ctx: DeriveContext) => PageViews[P] } = {
  revenue: deriveRevenue,
  occupancy: deriveOccupancy,
  "booking-patterns": deriveBookingPatterns,
  pricing: derivePricing,
  guests: deriveGuests,
};

/** Only the literal `1`. `demo=true` is a typo, not a request for invented revenue. */
export function isDemoParam(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === "1";
}

/**
 * The single entry point. When real queries land, the one line that picks the
 * facts changes; the returned type, every derivation and every component stay.
 */
export async function getPageData<P extends PageId>(page: P, query: PageQuery): Promise<PageData<P>> {
  const { period, today, demo } = query;
  const facts = demo ? generateDemoFacts(today) : EMPTY_FACTS;

  const earliest = earliestFactDate(facts);
  const canCompareLastYear = earliest !== null && earliest <= shiftYears(period.from, -1);
  const compare: CompareMode =
    query.compare === "last-year" && !canCompareLastYear ? "previous" : query.compare;

  // A comparison range that ends before any fact exists compares against nothing.
  const candidate = comparisonRange(period, compare);
  const comparison = candidate && earliest !== null && candidate.to >= earliest ? candidate : null;

  const granularity = granularityFor(period);

  return {
    page,
    isDemo: demo,
    hasAnyBookings: facts.bookings.length > 0,
    range: { from: period.from, to: period.to },
    comparison,
    compare,
    canCompareLastYear,
    granularity,
    view: DERIVE[page]({ facts, period, comparison, today, granularity }),
  };
}
```

- [ ] **Step 4: Implement `lib/analytics/csv.ts`**

```ts
import { PAGES } from "./pages";
import type { AnyPageData, Bar, Point, Share, StatValue, Widget } from "./types";

type Cell = string | number | null;
type Row = Cell[];

function escape(field: Cell): string {
  if (field === null) return "";
  const text = String(field);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const toCsv = (rows: Row[]): string => rows.map((row) => row.map(escape).join(",")).join("\n");

/** Cents are an internal unit. A host opening this in a spreadsheet wants euros. */
const euros = (cents: number | null): string | null => (cents === null ? null : (cents / 100).toFixed(2));
const decimal = (value: number | null): string | null => (value === null ? null : value.toFixed(1));
const whole = (value: number | null): string | null => (value === null ? null : String(value));

/**
 * A widget that declined leaves a visible note. A blank block would read as
 * "nothing happened", which is a different and wrong claim. This is also what
 * keeps the file under the same suppression as the screen: it can only print
 * what the view model holds.
 */
function rowsFor<T>(label: string, w: Widget<T>, build: (value: T) => Row[]): Row[] {
  if (w.ok) return build(w.value);
  return [[label, "", w.reason === "below-minimum" ? "not enough data" : "unavailable", ""]];
}

const stat = (label: string, w: Widget<StatValue>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (v) => [[label, "", format(v.value), v.delta?.label ?? ""]]);

const points = (label: string, w: Widget<Point[]>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (rows) => rows.map((p) => [label, p.bucket, format(p.value), p.incomplete ? "incomplete" : ""]));

const shares = (label: string, w: Widget<Share[]>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (rows) => rows.map((r) => [label, r.label, format(r.value), `${r.sharePct.toFixed(1)}%`]));

const bars = (label: string, w: Widget<Bar[]>, format: (v: number | null) => string | null): Row[] =>
  rowsFor(label, w, (rows) => rows.map((r) => [label, r.label, format(r.value), ""]));

function body(data: AnyPageData): Row[] {
  switch (data.page) {
    case "revenue": {
      const v = data.view;
      return [
        ...stat("Revenue (EUR)", v.revenue, euros),
        ...stat("Year to date (EUR)", v.yearToDate, euros),
        ...stat("ADR (EUR)", v.adr, euros),
        ...stat("RevPAR (EUR)", v.revpar, euros),
        ...stat("Commission 4.5% (EUR)", v.commission, euros),
        ...points("Revenue over time (EUR)", v.overTime, euros),
        ...shares("Revenue by room type (EUR)", v.byRoomType, euros),
        ...shares("Revenue by rate plan (EUR)", v.byRatePlan, euros),
      ];
    }
    case "occupancy": {
      const v = data.view;
      return [
        ...stat("Occupancy (%)", v.occupancy, decimal),
        ...stat("Nights sold", v.nightsSold, whole),
        ...stat("Nights available", v.nightsAvailable, whole),
        ...stat("Unsold nights, next 30 days", v.unsoldNext30, whole),
        ...points("Occupancy over time (%)", v.overTime, decimal),
        ...rowsFor("Next 90 days", v.next90, (cells) =>
          cells.map((c) => ["Next 90 days", c.date, c.sold, `of ${c.available} available`]),
        ),
        ...(v.pace ? points("Pace, nights on the books", v.pace, whole) : []),
        ...bars("Occupancy by weekday (%)", v.byWeekday, decimal),
      ];
    }
    case "booking-patterns": {
      const v = data.view;
      return [
        ...stat("Bookings", v.bookings, whole),
        ...stat("Median lead time (days)", v.medianLeadDays, decimal),
        ...stat("Median stay length (nights)", v.medianStayNights, decimal),
        ...stat("Cancellation rate (%)", v.cancellationRate, decimal),
        ...bars("Lead time (bookings)", v.leadTime, whole),
        ...bars("Stay length (bookings)", v.stayLength, whole),
        ...bars("Cancellations by days before check-in", v.cancellationsByDaysBefore, whole),
        ...rowsFor("Cancellations by rate plan", v.byRatePlan, (rows) =>
          rows.flatMap((r): Row[] => [
            ["Cancellation rate by rate plan (%)", r.label, decimal(r.ratePct), `${r.cancelled} of ${r.bookings}`],
            ["Cancellation fees retained (EUR)", r.label, euros(r.feesRetainedCents), ""],
          ]),
        ),
      ];
    }
    case "pricing": {
      const v = data.view;
      return [
        ...stat("ADR (EUR)", v.adr, euros),
        ...rowsFor("Discounts given (EUR)", v.discounts, (d) => [
          ["Discounts given (EUR)", "", euros(d.value), d.delta?.label ?? ""],
          ["Bookings with a discount (%)", "", decimal(d.shareOfBookingsPct), ""],
        ]),
        ...stat("Average discount depth (%)", v.discountDepth, decimal),
        ...points("ADR over time (EUR)", v.adrOverTime, euros),
        ...rowsFor("By rate plan", v.byRatePlan, (rows) =>
          rows.flatMap((r): Row[] => [
            ["Bookings by rate plan", r.label, r.bookings, ""],
            ["Nights by rate plan", r.label, r.nights, ""],
            ["ADR by rate plan (EUR)", r.label, euros(r.adrCents), ""],
            ["Revenue by rate plan (EUR)", r.label, euros(r.revenueCents), ""],
          ]),
        ),
        ...rowsFor("By weekday", v.byWeekday, (rows) =>
          rows.flatMap((r): Row[] => [
            ["Occupancy by weekday (%)", r.label, decimal(r.occupancyPct), ""],
            ["ADR by weekday (EUR)", r.label, euros(r.adrCents), r.hint ? "sells out below average rate" : ""],
          ]),
        ),
      ];
    }
    case "guests": {
      const v = data.view;
      return [
        ...stat("Returning guests (%)", v.returning, decimal),
        ...stat("Median party size", v.medianPartySize, decimal),
        ...shares("Booker country", v.countries, whole),
        ...shares("Group type", v.groupTypes, whole),
      ];
    }
  }
}

export function pageCsv(data: AnyPageData): string {
  const header: Row[] = [
    ["Page", PAGES[data.page].title],
    ["From", data.range.from],
    ["To", data.range.to],
  ];
  return `${toCsv(header)}\n\n${toCsv([["Metric", "Key", "Value", "Note"], ...body(data)])}\n`;
}

export function csvFilename(data: AnyPageData): string {
  return `analytics-${data.page}-${data.range.from}-to-${data.range.to}.csv`;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test lib/analytics && bun run typecheck`
Expected: PASS, rc=0.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics && git commit -m "Add analytics page data entry point, CSV export, reconciliation and guards"
```

---

### Task 11: Readiness checklist

The only real-data read in this build. The pure evaluation and the query live in separate files so the tests never open a database or call Stripe, and so the property lookup has exactly one home.

**Files:**
- Create: `lib/analytics/readiness.ts`, `lib/analytics/readiness-query.ts`
- Test: `lib/analytics/readiness.test.ts`

**Interfaces:**
- Produces:
  - `type ReadinessState = "done" | "todo" | "unknown"`
  - `interface ReadinessItem { key: string; label: string; state: ReadinessState; href: string; action: string }`
  - `interface ReadinessFacts { listingLive: boolean; availabilityOpen: boolean; hasActiveRatePlan: boolean; paymentsConnected: boolean | null }`
  - `NOT_STARTED: ReadinessFacts`, `evaluateReadiness(facts): ReadinessItem[]`, `isReady(items): boolean`
  - `getReadiness(userId: string, today: IsoDate): Promise<ReadinessItem[]>` in `readiness-query.ts`

- [ ] **Step 1: Write the failing test**

`lib/analytics/readiness.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { evaluateReadiness, isReady, NOT_STARTED } from "./readiness";

const READY = { listingLive: true, availabilityOpen: true, hasActiveRatePlan: true, paymentsConnected: true };

describe("evaluateReadiness", () => {
  test("four items, in the order a host fixes them, each with somewhere to go", () => {
    const items = evaluateReadiness(NOT_STARTED);
    expect(items.map((i) => i.label)).toEqual([
      "Listing is live",
      "Availability is open for the next 90 days",
      "At least one active rate plan",
      "Payments connected",
    ]);
    expect(items.every((i) => i.state === "todo" && i.href.startsWith("/"))).toBe(true);
    expect(isReady(items)).toBe(false);
  });

  test("all four done means ready", () => {
    expect(isReady(evaluateReadiness(READY))).toBe(true);
  });

  test("one open item is enough to not be ready", () => {
    const items = evaluateReadiness({ ...READY, hasActiveRatePlan: false });
    expect(items.map((i) => i.state)).toEqual(["done", "done", "todo", "done"]);
    expect(isReady(items)).toBe(false);
  });

  test("a Stripe lookup that failed is unknown, not a false accusation", () => {
    const items = evaluateReadiness({ ...READY, paymentsConnected: null });
    expect(items[3].state).toBe("unknown");
    expect(isReady(items)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/readiness.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/analytics/readiness.ts`**

```ts
export type ReadinessState = "done" | "todo" | "unknown";

export interface ReadinessItem {
  key: string;
  label: string;
  state: ReadinessState;
  /** Where the host fixes it. */
  href: string;
  /** The link's text. */
  action: string;
}

export interface ReadinessFacts {
  listingLive: boolean;
  availabilityOpen: boolean;
  hasActiveRatePlan: boolean;
  /** Null when the payment provider could not be asked. */
  paymentsConnected: boolean | null;
}

export const NOT_STARTED: ReadinessFacts = {
  listingLive: false,
  availabilityOpen: false,
  hasActiveRatePlan: false,
  paymentsConnected: false,
};

const state = (done: boolean | null): ReadinessState =>
  done === null ? "unknown" : done ? "done" : "todo";

/** Everything a host with no bookings can fix today, in the order they would. */
export function evaluateReadiness(facts: ReadinessFacts): ReadinessItem[] {
  return [
    {
      key: "listing",
      label: "Listing is live",
      state: state(facts.listingLive),
      href: "/dashboard/listings/property",
      action: "Publish listing",
    },
    {
      key: "availability",
      label: "Availability is open for the next 90 days",
      state: state(facts.availabilityOpen),
      href: "/dashboard/listings/rates-availability",
      action: "Open dates",
    },
    {
      key: "rate-plan",
      label: "At least one active rate plan",
      state: state(facts.hasActiveRatePlan),
      href: "/dashboard/listings/rates-availability",
      action: "Add a rate plan",
    },
    {
      key: "payments",
      label: "Payments connected",
      state: state(facts.paymentsConnected),
      href: "/onboarding/stripe",
      action: "Connect payments",
    },
  ];
}

export const isReady = (items: ReadinessItem[]): boolean => items.every((item) => item.state === "done");
```

- [ ] **Step 4: Implement `lib/analytics/readiness-query.ts`**

Before writing, confirm the column names against `packages/db/src/schema.ts` (`properties`, `rooms`, `rate_plans`, `room_inventory`, `room_closures`, `host_onboarding`) and confirm the three `href` targets above exist under `app/`. If a name differs, use the schema's.

```ts
import { queryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";
import { addDays } from "./period";
import { evaluateReadiness, NOT_STARTED, type ReadinessItem } from "./readiness";
import type { IsoDate } from "./types";

interface HostRow {
  id: string;
  is_active: boolean;
  stripe_account_id: string | null;
}

/**
 * The one place analytics reads real data, and the one place a property is
 * looked up. It is found from the signed-in user and never from the request.
 */
export async function getReadiness(userId: string, today: IsoDate): Promise<ReadinessItem[]> {
  const host = await queryOne<HostRow>(
    `SELECT p.id,
            p.is_active,
            COALESCE(p.stripe_account_id, o.step_data->>'stripe_account_id') AS stripe_account_id
       FROM properties p
       LEFT JOIN host_onboarding o ON o.user_id = p.owner_user_id
      WHERE p.owner_user_id = $1
      ORDER BY p.created_at
      LIMIT 1`,
    [userId],
  );
  if (!host) return evaluateReadiness(NOT_STARTED);

  const [ratePlan, availability, paymentsConnected] = await Promise.all([
    queryOne<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM rate_plans rp
           JOIN rooms r ON r.id = rp.room_id
          WHERE r.property_id = $1 AND r.is_active AND rp.is_active
       ) AS found`,
      [host.id],
    ),
    // Open means at least one active room has a unit to sell on at least one
    // of the next ninety days: an override wins outright, otherwise capacity
    // less blocked units, and a closure covering the date rules it out.
    queryOne<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM rooms r
          CROSS JOIN generate_series($2::date, $3::date, interval '1 day') AS d(day)
           LEFT JOIN room_inventory ri ON ri.room_id = r.id AND ri.date = d.day::date
          WHERE r.property_id = $1
            AND r.is_active
            AND COALESCE(
                  ri.available_override,
                  COALESCE(ri.total_rooms, r.total_units) - COALESCE(ri.blocked_rooms, 0)
                ) > 0
            AND NOT EXISTS (
                  SELECT 1
                    FROM room_closures c
                   WHERE c.room_id = r.id
                     AND c.is_active
                     AND d.day::date BETWEEN c.start_date AND c.end_date
                )
       ) AS found`,
      [host.id, today, addDays(today, 89)],
    ),
    chargesEnabled(host.stripe_account_id),
  ]);

  return evaluateReadiness({
    listingLive: host.is_active,
    availabilityOpen: availability?.found ?? false,
    hasActiveRatePlan: ratePlan?.found ?? false,
    paymentsConnected,
  });
}

/** Null when Stripe could not be asked: the checklist says "Check", not "not connected". */
async function chargesEnabled(accountId: string | null): Promise<boolean | null> {
  if (!accountId) return false;
  try {
    const account = await retrieveConnectAccount(accountId);
    return account.charges_enabled ?? false;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test lib/analytics && bun run typecheck`
Expected: PASS. The guards test still passes: `readiness-query.ts` is its one allowed file.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics/readiness.ts lib/analytics/readiness-query.ts lib/analytics/readiness.test.ts
git commit -m "Add the analytics readiness checklist"
```

---

### Task 12: Widget primitives

**Files:**
- Create: `_components/stat-row.tsx`, `_components/chart-card.tsx`, `_components/date-strip.tsx`, `_components/charts/time-line.tsx`, `_components/charts/bars.tsx`, `_components/charts/ranked-bars.tsx`, `_components/charts/stacked-bar.tsx` (all under `app/(dashboard)/dashboard/analytics/`)
- Modify: `lib/analytics/chart-data.ts` (append `declinedMessage`), `lib/analytics/chart-data.test.ts` (append)

**Interfaces:**
- Consumes: `lineRows`, `MIN_CHART_POINTS`; formatters; view-model types; `components/ui/{card,chart,table,tooltip}`.
- Produces:
  - `declinedMessage(widget, unit?) → string` in `chart-data.ts`
  - `StatRow`, `Stat({ label, widget, format, info?, note?, href?, hrefLabel? })`, `DeltaChip({ delta })`
  - `WidgetGrid`, `ChartCard<T>({ title, unit, basis, periodLabel, widget, emptyMessage?, sampleUnit?, action?, className?, children })`
  - `TimeLine({ points, label, compareLabel, format })`, `Bars({ rows, label, format, summary })`, `RankedBars({ rows, format })`, `StackedBar({ rows, format, summary })`, `DateStrip({ cells })`

Before writing chart code, open `components/ui/chart.tsx`, `components/ui/card.tsx` and `components/ui/table.tsx` and confirm the exports used below exist under those names. If one differs, use the file's name.

- [ ] **Step 1: Write the failing test**

Append to `lib/analytics/chart-data.test.ts` (add `declinedMessage` to the import):

```ts
describe("declinedMessage", () => {
  test("says how many are needed and how many there are, in the widget's own unit", () => {
    expect(declinedMessage({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 3 }))
      .toBe("Needs at least 5 bookings (3 so far)");
    expect(declinedMessage({ ok: false, reason: "below-minimum", basis: "stay", needed: 5, have: 0 }))
      .toBe("Needs at least 5 nights sold (0 so far)");
  });

  test("a caller can name a more precise unit", () => {
    expect(declinedMessage({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 1 }, "guests"))
      .toBe("Needs at least 5 guests (1 so far)");
  });

  test("an error shows its fixed message", () => {
    expect(declinedMessage({ ok: false, reason: "error", message: "We could not work this one out." }))
      .toBe("We could not work this one out.");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test lib/analytics/chart-data.test.ts`
Expected: FAIL, `declinedMessage` is not exported.

- [ ] **Step 3: Append `declinedMessage` to `lib/analytics/chart-data.ts`**

Change the type import to `import type { Point, Widget } from "./types";` and append:

```ts
/** What a widget says in place of itself when it declines to render. */
export function declinedMessage(
  widget: Exclude<Widget<unknown>, { ok: true }>,
  unit?: string,
): string {
  if (widget.reason === "error") return widget.message;
  const counted = unit ?? (widget.basis === "booking" ? "bookings" : "nights sold");
  return `Needs at least ${widget.needed} ${counted} (${widget.have} so far)`;
}
```

- [ ] **Step 4: Create `_components/stat-row.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EM_DASH } from "@/lib/analytics/format";
import type { Delta, StatValue, Widget } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

/**
 * Colour says which way the figure moved, not whether that is good. Metrics
 * where a rise is not good news arrive with a neutral tone and stay grey. The
 * label is always text, so the direction survives a greyscale print.
 */
export function DeltaChip({ delta }: { delta: Delta }) {
  const Icon = delta.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs tabular-nums",
        delta.tone === "neutral" && "text-muted-foreground",
        delta.tone === "directional" && delta.direction === "up" && "text-(--green-11)",
        delta.tone === "directional" && delta.direction === "down" && "text-destructive",
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {delta.label}
    </span>
  );
}

interface StatProps {
  label: string;
  widget: Widget<StatValue>;
  format: (value: number | null) => string;
  /** The definition, behind the info icon. */
  info?: string;
  /** A second line under the figure, e.g. "38% of bookings". */
  note?: ReactNode;
  href?: string;
  hrefLabel?: string;
}

/** One number: a large figure, a small label, a delta when there is one. No box. */
export function Stat({ label, widget, format, info, note, href, hrefLabel }: StatProps) {
  const stat = widget.ok ? widget.value : null;
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-muted-foreground text-xs">
        {label}
        {info ? (
          <Tooltip>
            <TooltipTrigger
              className="transition-colors hover:text-foreground focus-visible:text-foreground"
              aria-label={`What ${label} means`}
            >
              <Info className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{info}</TooltipContent>
          </Tooltip>
        ) : null}
      </dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-2xl tabular-nums tracking-tight">
          {stat ? format(stat.value) : EM_DASH}
        </span>
        {stat?.delta ? <DeltaChip delta={stat.delta} /> : null}
      </dd>
      {note ? <p className="mt-0.5 text-muted-foreground text-xs">{note}</p> : null}
      {href && hrefLabel ? (
        <Link href={href} className="mt-0.5 inline-block text-xs underline underline-offset-4">
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <dl className="flex flex-wrap gap-x-10 gap-y-5 border-b px-4 pb-5 lg:px-6">{children}</dl>;
}
```

- [ ] **Step 5: Create `_components/chart-card.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { declinedMessage } from "@/lib/analytics/chart-data";
import type { Basis, Widget } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const BASIS_LABELS: Record<Basis, string> = {
  booking: "By booking date",
  stay: "By stay date",
};

interface ChartCardProps<T> {
  title: string;
  /** What the figures are counted in: "EUR", "%", "Bookings". */
  unit: string;
  basis: Basis;
  periodLabel: string;
  widget: Widget<T>;
  /** Shown when the widget rendered over an empty sample. */
  emptyMessage?: string;
  /** Overrides the unit in the "needs at least" message. */
  sampleUnit?: string;
  /** A control in the header, e.g. a dimension toggle. */
  action?: ReactNode;
  className?: string;
  children: (value: T) => ReactNode;
}

/**
 * One chart or table, with its title, unit, date basis and period in the
 * header, and the three ways a widget declines to draw itself.
 */
export function ChartCard<T>({
  title,
  unit,
  basis,
  periodLabel,
  widget,
  emptyMessage = "No bookings in this period. Try a longer period.",
  sampleUnit,
  action,
  className,
  children,
}: ChartCardProps<T>) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <CardTitle className="font-medium text-sm">{title}</CardTitle>
          <CardDescription className="text-xs">
            {[unit, BASIS_LABELS[basis], periodLabel].filter(Boolean).join(" · ")}
          </CardDescription>
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {!widget.ok ? (
          <p className="text-muted-foreground text-sm">{declinedMessage(widget, sampleUnit)}</p>
        ) : widget.sample === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : (
          children(widget.value)
        )}
      </CardContent>
    </Card>
  );
}

/** One or two columns of content-driven rows. Add `WIDE` to span both. */
export function WidgetGrid({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-4 px-4 lg:px-6 @4xl/main:grid-cols-2">{children}</div>;
}

export const WIDE = "@4xl/main:col-span-2";
```

- [ ] **Step 6: Create `_components/charts/time-line.tsx`**

```tsx
"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lineRows, MIN_CHART_POINTS } from "@/lib/analytics/chart-data";
import { EM_DASH, trendSentence } from "@/lib/analytics/format";
import type { Point } from "@/lib/analytics/types";

interface TimeLineProps {
  points: Point[];
  /** Names the measure in the tooltip and the accessible summary. */
  label: string;
  /** Names the comparison line, e.g. "Previous period". */
  compareLabel: string;
  format: (value: number) => string;
}

/**
 * Straight segments, a whole-unit axis, an optional comparison line, and a
 * dashed tail over any bucket that is not finished. Under seven points it is
 * a table: a line through three points claims a trend that is not there.
 */
export function TimeLine({ points, label, compareLabel, format }: TimeLineProps) {
  const hasCompare = points.some((p) => p.compare !== null);
  const show = (value: number | null) => (value === null ? EM_DASH : format(value));

  if (points.length < MIN_CHART_POINTS) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">{label}</TableHead>
            {hasCompare ? <TableHead className="text-right">{compareLabel}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((p) => (
            <TableRow key={p.bucket}>
              <TableCell>
                {p.label}
                {p.incomplete ? <span className="text-muted-foreground"> (in progress)</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{show(p.value)}</TableCell>
              {hasCompare ? <TableCell className="text-right tabular-nums">{show(p.compare)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  const hasIncomplete = points.some((p) => p.incomplete);

  return (
    <div>
      <ChartContainer
        config={{
          solid: { label, color: "var(--chart-1)" },
          dashed: { label: `${label}, in progress`, color: "var(--chart-1)" },
          compare: { label: compareLabel, color: "var(--muted-foreground)" },
        }}
        className="h-64 w-full"
        role="img"
        // Built from this chart's own numbers, so it cannot go stale when the period changes.
        aria-label={trendSentence(label, points, format)}
      >
        <LineChart data={lineRows(points)} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={72}
            tickFormatter={(value: number) => format(value)}
          />
          <ChartTooltip
            content={<ChartTooltipContent labelKey="label" formatter={(value) => format(Number(value))} />}
          />
          {hasCompare ? (
            <Line
              dataKey="compare"
              type="linear"
              stroke="var(--color-compare)"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          <Line dataKey="solid" type="linear" stroke="var(--color-solid)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line
            dataKey="dashed"
            type="linear"
            stroke="var(--color-dashed)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      {hasIncomplete || hasCompare ? (
        <p className="mt-2 text-muted-foreground text-xs">
          {[
            hasCompare ? `Grey line: ${compareLabel.toLowerCase()}.` : null,
            hasIncomplete ? "Dashed: not finished yet." : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Create `_components/charts/bars.tsx`**

```tsx
"use client";

import { Bar as BarMark, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { Bar } from "@/lib/analytics/types";

interface BarsProps {
  rows: Bar[];
  label: string;
  format: (value: number) => string;
  /** The accessible summary. Built by the caller, which knows what the bars mean. */
  summary: string;
}

/** Vertical bars over ordered buckets, in the order given. Never sorted. */
export function Bars({ rows, label, format, summary }: BarsProps) {
  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className="h-56 w-full"
      role="img"
      aria-label={summary}
    >
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={48}
          allowDecimals={false}
          tickFormatter={(value: number) => format(value)}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelKey="label" formatter={(value) => format(Number(value))} />}
        />
        <BarMark dataKey="value" fill="var(--color-value)" radius={2} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 8: Create `_components/charts/ranked-bars.tsx` and `stacked-bar.tsx`**

`ranked-bars.tsx`:

```tsx
import { formatPercent } from "@/lib/analytics/format";
import type { Share } from "@/lib/analytics/types";

/**
 * Ranked categories with value and share. With one or two rows there is
 * nothing to rank, so it is two lines of text and no bars.
 */
export function RankedBars({ rows, format }: { rows: Share[]; format: (value: number) => string }) {
  const figure = (row: Share) => (
    <span className="shrink-0 tabular-nums">
      {format(row.value)}
      <span className="ml-2 text-muted-foreground">{formatPercent(row.sharePct, 0)}</span>
    </span>
  );

  if (rows.length <= 2) {
    return (
      <ul className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-4">
            <span className="truncate">{row.label}</span>
            {figure(row)}
          </li>
        ))}
      </ul>
    );
  }

  const peak = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="truncate">{row.label}</span>
            {figure(row)}
          </div>
          {/* The figure beside it is the accessible value; the bar is shape. */}
          <div className="mt-1 h-1.5 rounded-sm bg-muted" aria-hidden>
            <div
              className="h-full rounded-sm bg-(--chart-1)"
              style={{ width: `${(row.value / peak) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
```

`stacked-bar.tsx`:

```tsx
import { formatPercent } from "@/lib/analytics/format";
import type { Share } from "@/lib/analytics/types";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

interface StackedBarProps {
  rows: Share[];
  format: (value: number) => string;
  summary: string;
}

/** Parts of a whole as one horizontal bar. The legend carries the numbers. */
export function StackedBar({ rows, format, summary }: StackedBarProps) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-sm" role="img" aria-label={summary}>
        {rows.map((row, index) => (
          <div
            key={row.key}
            style={{ width: `${row.sharePct}%`, backgroundColor: COLORS[index % COLORS.length] }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
              aria-hidden
            />
            {row.label}
            <span className="tabular-nums">{format(row.value)}</span>
            <span className="text-muted-foreground tabular-nums">{formatPercent(row.sharePct, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 9: Create `_components/date-strip.tsx`**

```tsx
import { formatDate, formatDayMonth } from "@/lib/analytics/format";
import type { DayCell } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

/**
 * The next ninety days, one cell per day: filled from the bottom by the share
 * sold. Friday and Saturday nights carry a dot, so an empty weekend is the
 * first thing the eye lands on. Thirty to a row on narrow screens, ninety on
 * wide ones. Each cell's detail is its native title: one tooltip, not ninety.
 */
export function DateStrip({ cells }: { cells: DayCell[] }) {
  const unsoldWeekendNights = cells
    .filter((cell) => cell.weekend)
    .reduce((total, cell) => total + Math.max(0, cell.available - cell.sold), 0);

  return (
    <div>
      <ol className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-x-px gap-y-2 @4xl/main:grid-cols-[repeat(90,minmax(0,1fr))]">
        {cells.map((cell) => {
          const share = cell.available === 0 ? 0 : Math.min(1, cell.sold / cell.available);
          return (
            <li
              key={cell.date}
              title={`${formatDate(cell.date)}: ${cell.sold} of ${cell.available} sold`}
              className="flex flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "relative block h-10 w-full overflow-hidden rounded-[1px] bg-muted",
                  cell.available === 0 && "opacity-40",
                )}
              >
                <span
                  className="absolute inset-x-0 bottom-0 bg-(--chart-1)"
                  style={{ height: `${share * 100}%` }}
                />
              </span>
              <span
                className={cn("size-1 rounded-full", cell.weekend ? "bg-foreground" : "bg-transparent")}
                aria-hidden
              />
            </li>
          );
        })}
      </ol>
      <div className="mt-1 flex justify-between text-muted-foreground text-xs">
        <span>{formatDayMonth(cells[0].date)}</span>
        <span>{formatDayMonth(cells[cells.length - 1].date)}</span>
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        Filled is sold, empty is still available. Dots mark Friday and Saturday nights:{" "}
        {unsoldWeekendNights} of those are still unsold.
      </p>
    </div>
  );
}
```

- [ ] **Step 10: Verify and commit**

Run: `bun test lib/analytics && bun run typecheck && bun run lint`
Expected: PASS, rc=0, no new lint warnings in the new files.

```bash
git add lib/analytics "app/(dashboard)/dashboard/analytics/_components"
git commit -m "Add analytics widget primitives"
```

---

### Task 13: Page frame, header, period control, empty and demo states

**Files:**
- Create (under `app/(dashboard)/dashboard/analytics/_components/`): `analytics-page.tsx`, `page-header.tsx`, `period-control.tsx`, `export-button.tsx`, `demo-banner.tsx`, `ghost-page.tsx`, `readiness-card.tsx`
- Modify: `app/(dashboard)/dashboard/analytics/layout.tsx`, `components/dashboard/sidebar-08/nav-main.tsx`

**Interfaces:**
- Consumes: `getPageData`, `isDemoParam`, `getReadiness`, `PAGES`, `carryQuery`, period parsing, `pageCsv`, `csvFilename`, `isReady`.
- Produces:
  - `type AnalyticsRouteProps = { searchParams: Promise<RawParams> }`
  - `AnalyticsPage<P extends PageId>({ page, searchParams, View })` where `View: ComponentType<{ data: PageData<P> }>`

Before starting: run `grep -rn "session.user.id\|session?.user" app lib | head` and confirm how this app reads the user id off `getServerSession()`. Use that exact access below.

- [ ] **Step 1: Layout container**

Replace `app/(dashboard)/dashboard/analytics/layout.tsx`:

```tsx
import { SiteHeader } from "@/components/dashboard/site-header";

/**
 * `min-w-0` on every flex child between the viewport and the page. A flex item
 * refuses to shrink below its content without it, which is how a wide card
 * used to push the page past the right edge.
 */
export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader title="Analytics" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create `period-control.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";
import type { DateRange as PickerRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRange } from "@/lib/analytics/format";
import {
  COMPARE_LABELS,
  COMPARE_MODES,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type CompareMode,
  type DateRange,
  type PeriodPreset,
} from "@/lib/analytics/period";
import type { IsoDate } from "@/lib/analytics/types";

interface PeriodControlProps {
  preset: PeriodPreset;
  range: DateRange;
  compare: CompareMode;
  canCompareLastYear: boolean;
}

const pad = (value: number) => String(value).padStart(2, "0");
const toIso = (date: Date): IsoDate =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** The calendar hands back local Dates; midday keeps a timezone shift off the previous day. */
const fromIso = (value: IsoDate): Date => new Date(`${value}T12:00:00`);

function Option({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className="w-full justify-start"
    >
      {children}
    </Button>
  );
}

/**
 * Period and comparison in one control that carries its own label. Both live
 * in the URL, so a view is shareable, survives a refresh, and follows the host
 * to the next analytics page.
 */
export function PeriodControl({ preset, range, compare, canCompareLastYear }: PeriodControlProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  // Merged into the existing params, so `demo` survives a filter change.
  const setParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  };

  const selectPreset = (next: PeriodPreset) =>
    setParams(
      next === "custom"
        ? { period: next, from: range.from, to: range.to }
        : { period: next, from: null, to: null },
    );

  const selectRange = (selected: PickerRange | undefined) => {
    if (!selected?.from) return;
    setParams({ period: "custom", from: toIso(selected.from), to: toIso(selected.to ?? selected.from) });
  };

  const summary = [
    preset === "custom" ? formatRange(range) : PERIOD_LABELS[preset],
    compare === "none" ? null : `vs ${COMPARE_LABELS[compare].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} aria-label={`Period: ${summary}`}>
          <CalendarIcon aria-hidden />
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] p-3">
        <div className="flex flex-wrap gap-6">
          <fieldset>
            <legend className="mb-1.5 text-muted-foreground text-xs">Period</legend>
            <div className="flex flex-col gap-0.5">
              {PERIOD_PRESETS.map((value) => (
                <Option key={value} selected={value === preset} onClick={() => selectPreset(value)}>
                  {PERIOD_LABELS[value]}
                </Option>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-muted-foreground text-xs">Compare with</legend>
            <div className="flex flex-col gap-0.5">
              {COMPARE_MODES.map((value) => {
                const unavailable = value === "last-year" && !canCompareLastYear;
                const option = (
                  <Option
                    key={value}
                    selected={value === compare}
                    disabled={unavailable}
                    onClick={() => setParams({ compare: value })}
                  >
                    {COMPARE_LABELS[value]}
                  </Option>
                );
                // A disabled button fires no pointer events, so the tooltip hangs off a wrapper.
                return unavailable ? (
                  <Tooltip key={value}>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>{option}</span>
                    </TooltipTrigger>
                    <TooltipContent>Available once you have 12 months of data</TooltipContent>
                  </Tooltip>
                ) : (
                  option
                );
              })}
            </div>
          </fieldset>
        </div>
        {preset === "custom" ? (
          <div className="mt-3 border-t pt-3">
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={fromIso(range.from)}
              selected={{ from: fromIso(range.from), to: fromIso(range.to) }}
              onSelect={selectRange}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Create `export-button.tsx` and `page-header.tsx`**

`export-button.tsx`:

```tsx
"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { csvFilename, pageCsv } from "@/lib/analytics/csv";
import type { AnyPageData } from "@/lib/analytics/types";

/**
 * Built in the browser from the view model already on screen, so the file
 * cannot disagree with the page and carries the same suppression. Disabled
 * with a reason in demo mode: demo numbers must never reach a host's books.
 */
export function ExportButton({
  data,
  disabledReason,
}: {
  data: AnyPageData;
  disabledReason: string | null;
}) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([pageCsv(data)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = csvFilename(data);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const button = (
    <Button variant="outline" size="sm" onClick={download} disabled={disabledReason !== null}>
      <Download aria-hidden />
      Export CSV
    </Button>
  );

  if (disabledReason === null) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
```

`page-header.tsx`:

```tsx
"use client";

import type { PeriodPreset } from "@/lib/analytics/period";
import type { AnyPageData } from "@/lib/analytics/types";
import { ExportButton } from "./export-button";
import { PeriodControl } from "./period-control";

interface PageHeaderProps {
  title: string;
  description: string;
  preset: PeriodPreset;
  data: AnyPageData;
  exportDisabledReason: string | null;
}

/** The same on every page: what this is on the left, period and export on the right. */
export function PageHeader({ title, description, preset, data, exportDisabledReason }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 lg:px-6">
      <div className="min-w-0">
        <h1 className="font-semibold text-lg">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PeriodControl
          preset={preset}
          range={data.range}
          compare={data.compare}
          canCompareLastYear={data.canCompareLastYear}
        />
        <ExportButton data={data} disabledReason={exportDisabledReason} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `demo-banner.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";

/** Unmissable, because every figure below it is invented. */
export function DemoBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Dropping the flag, not the page or the period.
  const params = new URLSearchParams(searchParams.toString());
  params.delete("demo");
  const query = params.toString();

  return (
    <div className="flex items-center gap-2 border-(--amber-11)/30 border-b bg-(--amber-3) px-4 py-2 text-(--amber-11) text-sm lg:px-6">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span>
        Demo data: none of these numbers are yours.{" "}
        <Link href={query ? `${pathname}?${query}` : pathname} className="underline">
          Back to your own analytics
        </Link>
        .
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Create `readiness-card.tsx` and `ghost-page.tsx`**

`readiness-card.tsx`:

```tsx
import Link from "next/link";
import { Circle, CircleCheck, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isReady, type ReadinessItem, type ReadinessState } from "@/lib/analytics/readiness";

const ICONS: Record<ReadinessState, typeof Circle> = {
  done: CircleCheck,
  todo: Circle,
  unknown: CircleHelp,
};

/**
 * The message for a host with no bookings yet. The checklist is the useful
 * part: a host in this state usually wants to know why, and every item on it
 * is something they can fix today.
 */
export function ReadinessCard({ readiness, demoHref }: { readiness: ReadinessItem[]; demoHref: string }) {
  const ready = isReady(readiness);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your analytics start with your first booking</CardTitle>
        <CardDescription>
          {ready
            ? "Everything is set up, so bookings will appear here as they come in."
            : "This page fills in as guests book."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ready ? null : (
          <div>
            <p className="font-medium text-sm">Before your first booking</p>
            <ul className="mt-2 space-y-2">
              {readiness.map((item) => {
                const Icon = ICONS[item.state];
                return (
                  <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        className={item.state === "done" ? "size-4 shrink-0 text-(--green-11)" : "size-4 shrink-0 text-muted-foreground"}
                        aria-hidden
                      />
                      <span className={item.state === "done" ? "text-muted-foreground" : undefined}>
                        {item.label}
                      </span>
                    </span>
                    {item.state === "done" ? (
                      <span className="shrink-0 text-muted-foreground text-xs">Done</span>
                    ) : (
                      <Link href={item.href} className="shrink-0 underline underline-offset-4">
                        {item.state === "unknown" ? "Check" : item.action}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Button asChild>
          <Link href={demoHref}>Preview with demo data</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
```

`ghost-page.tsx`:

```tsx
import type { GhostFrame, PageMeta } from "@/lib/analytics/pages";
import type { ReadinessItem } from "@/lib/analytics/readiness";
import { ReadinessCard } from "./readiness-card";

/** An empty frame of the right kind. Every slot is the same height: no shape implies a value. */
function GhostVisual({ kind }: { kind: GhostFrame["kind"] }) {
  if (kind === "table") {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-4 rounded-sm border border-dashed" />
        ))}
      </div>
    );
  }
  if (kind === "strip") {
    return (
      <div className="flex gap-1">
        {Array.from({ length: 30 }, (_, day) => (
          <div key={day} className="h-10 flex-1 rounded-[1px] border border-dashed" />
        ))}
      </div>
    );
  }
  if (kind === "bars") {
    return (
      <div className="flex h-28 items-end gap-3 border-b border-dashed">
        {[0, 1, 2, 3, 4].map((bar) => (
          <div key={bar} className="h-3/5 flex-1 border border-b-0 border-dashed" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-28 gap-2">
      <div className="flex flex-col justify-between text-[10px] text-muted-foreground">
        <span>High</span>
        <span>0</span>
      </div>
      <div className="flex-1 border-b border-l border-dashed" />
    </div>
  );
}

/**
 * For a host who has never had a booking: the page's real layout as a ghost,
 * with one message card over it. Static, faint and dashed, so it cannot be
 * mistaken for loading. One component for every page; only `meta.ghost` differs.
 */
export function GhostPage({
  meta,
  readiness,
  demoHref,
}: {
  meta: PageMeta;
  readiness: ReadinessItem[];
  demoHref: string;
}) {
  return (
    // Both children share one grid cell, so the container is as tall as the taller of the two.
    <div className="grid min-w-0 px-4 lg:px-6 [&>*]:col-start-1 [&>*]:row-start-1">
      <div aria-hidden className="pointer-events-none min-w-0 select-none opacity-40">
        <dl className="flex flex-wrap gap-x-10 gap-y-5 border-b border-dashed pb-5">
          {meta.ghost.stats.map((label) => (
            <div key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-1 font-semibold text-2xl">–</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 grid gap-4 @4xl/main:grid-cols-2">
          {meta.ghost.frames.map((frame) => (
            <div key={frame.title} className="min-w-0 rounded-lg border border-dashed p-4">
              <p className="font-medium text-sm">{frame.title}</p>
              <p className="text-muted-foreground text-xs">{frame.caption}</p>
              <div className="mt-4">
                <GhostVisual kind={frame.kind} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="z-10 mt-20 w-full max-w-xl self-start justify-self-center">
        <ReadinessCard readiness={readiness} demoHref={demoHref} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `analytics-page.tsx`**

```tsx
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { getPageData, isDemoParam } from "@/lib/analytics/get-analytics";
import { carryQuery, PAGES, type PageId } from "@/lib/analytics/pages";
import {
  amsterdamToday,
  parseCompareParam,
  parsePeriodParams,
  type RawParams,
} from "@/lib/analytics/period";
import { getReadiness } from "@/lib/analytics/readiness-query";
import { evaluateReadiness, NOT_STARTED, type ReadinessItem } from "@/lib/analytics/readiness";
import type { AnyPageData, PageData } from "@/lib/analytics/types";
import { getServerSession } from "@/lib/auth";
import { DemoBanner } from "./demo-banner";
import { GhostPage } from "./ghost-page";
import { PageHeader } from "./page-header";

export interface AnalyticsRouteProps {
  searchParams: Promise<RawParams>;
}

/** A checklist that could not be loaded shows every item as "Check", and the page still renders. */
async function loadReadiness(userId: string, today: string): Promise<ReadinessItem[]> {
  try {
    return await getReadiness(userId, today);
  } catch {
    return evaluateReadiness(NOT_STARTED).map((item) => ({ ...item, state: "unknown" as const }));
  }
}

/**
 * Everything the five pages share: the session check, the period, comparison
 * and demo flag from the URL, one getPageData() call, and the header, banner
 * and empty state around whichever view is being read. The request never
 * says which property: there is nothing here to tamper with.
 */
export async function AnalyticsPage<P extends PageId>({
  page,
  searchParams,
  View,
}: AnalyticsRouteProps & { page: P; View: ComponentType<{ data: PageData<P> }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  // Computed once and passed down, so every figure agrees on what day it is.
  const today = amsterdamToday();
  const demo = isDemoParam(params.demo);
  const period = parsePeriodParams(params, today);

  const data = await getPageData(page, {
    period,
    compare: parseCompareParam(params.compare),
    today,
    demo,
  });
  const meta = PAGES[page];

  const neverBooked = !data.hasAnyBookings;
  const header = (
    <PageHeader
      title={meta.title}
      description={meta.description}
      preset={period.preset}
      data={data as unknown as AnyPageData}
      exportDisabledReason={
        demo
          ? "Export is off in demo mode, so demo numbers cannot end up in your books."
          : neverBooked
            ? "Nothing to export until your first booking."
            : null
      }
    />
  );

  if (neverBooked) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first !== undefined) search.set(key, first);
    }
    search.set("demo", "1");
    return (
      <>
        {header}
        <GhostPage
          meta={meta}
          readiness={await loadReadiness(session.user.id, today)}
          demoHref={`${meta.path}${carryQuery(search)}`}
        />
      </>
    );
  }

  return (
    <>
      {demo ? <DemoBanner /> : null}
      {header}
      <View data={data} />
    </>
  );
}
```

- [ ] **Step 7: Carry the filters through the sidebar**

In `components/dashboard/sidebar-08/nav-main.tsx`, change the navigation import and add the page helper import:

```ts
import { usePathname, useSearchParams } from "next/navigation";
import { carryQuery } from "@/lib/analytics/pages";
```

Add this component above `NavMain`:

```tsx
const ANALYTICS_ROOT = "/dashboard/analytics/";

/**
 * Between two analytics pages the period, comparison and demo flag come along.
 * Every other link is untouched. Props and ref pass straight through, because
 * the sidebar button renders this as its child.
 */
function CarriedLink({ href, ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const carried =
    href.startsWith(ANALYTICS_ROOT) && pathname.startsWith(ANALYTICS_ROOT)
      ? carryQuery(new URLSearchParams(searchParams.toString()))
      : "";
  return <Link href={`${href}${carried}`} {...props} />;
}
```

Add `import type * as React from "react";` if the file has no React import. In the sub-item render, replace:

```tsx
                          <Link href={subItem.url} prefetch={true}>
                            <span>{subItem.title}</span>
                          </Link>
```

with:

```tsx
                          <CarriedLink href={subItem.url} prefetch={true}>
                            <span>{subItem.title}</span>
                          </CarriedLink>
```

`useSearchParams` in the sidebar is safe because every dashboard route reads the session and so renders dynamically. If `bun run build` later reports a missing Suspense boundary for it, wrap `<NavMain />` in `<Suspense>` where `app-sidebar.tsx` renders it.

- [ ] **Step 8: Verify and commit**

Run: `bun test lib/analytics && bun run typecheck && bun run lint`
Expected: PASS, rc=0.

```bash
git add "app/(dashboard)/dashboard/analytics" components/dashboard/sidebar-08/nav-main.tsx
git commit -m "Add the analytics page frame, period control and empty state"
```

---

### Task 14: The five page views

**Files:**
- Create (under `_components/pages/`): `revenue-view.tsx`, `occupancy-view.tsx`, `booking-patterns-view.tsx`, `pricing-view.tsx`, `guests-view.tsx`
- Rewrite: the five `page.tsx` files

**Interfaces:**
- Consumes: Task 12 primitives, Task 13 `AnalyticsPage` and `AnalyticsRouteProps`, formatters, `COMPARE_LABELS`.
- Produces: `RevenuePageView`, `OccupancyPageView`, `BookingPatternsPageView`, `PricingPageView`, `GuestsPageView`, each `({ data }: { data: PageData<…> })`.

- [ ] **Step 1: `revenue-view.tsx`**

```tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { formatEuros, formatRange } from "@/lib/analytics/format";
import { COMPARE_LABELS } from "@/lib/analytics/period";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { RankedBars } from "../charts/ranked-bars";
import { TimeLine } from "../charts/time-line";
import { Stat, StatRow } from "../stat-row";

export function RevenuePageView({ data }: { data: PageData<"revenue"> }) {
  const { view } = data;
  const [dimension, setDimension] = React.useState<"room" | "plan">("room");
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat
          label="Revenue"
          widget={view.revenue}
          format={formatEuros}
          info="Net room revenue from bookings made in this period: excluding VAT, tourist tax and non-room fees, after discounts."
        />
        <Stat
          label="Year to date"
          widget={view.yearToDate}
          format={formatEuros}
          info="Net room revenue from bookings made since 1 January. The period does not change it."
        />
        <Stat
          label="ADR"
          widget={view.adr}
          format={formatEuros}
          info="Average daily rate: room revenue divided by nights sold, for nights stayed in this period."
        />
        <Stat
          label="RevPAR"
          widget={view.revpar}
          format={formatEuros}
          info="Revenue per available room night: ADR multiplied by occupancy. Read next to ADR, it tells you whether weak revenue comes from a low price or from empty rooms."
        />
        <Stat
          label="Commission (4.5%)"
          widget={view.commission}
          format={formatEuros}
          info="OpenBookings' commission: 4.5% of the revenue in this period."
          href="/dashboard/finance"
          hrefLabel="Statements in Finance"
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title="Revenue over time"
          unit="EUR"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.overTime}
          className={WIDE}
        >
          {(points) => (
            <TimeLine
              points={points}
              label="Revenue"
              compareLabel={COMPARE_LABELS[data.compare]}
              format={formatEuros}
            />
          )}
        </ChartCard>

        <ChartCard
          title={dimension === "room" ? "Revenue by room type" : "Revenue by rate plan"}
          unit="EUR"
          basis="booking"
          periodLabel={periodLabel}
          widget={dimension === "room" ? view.byRoomType : view.byRatePlan}
          action={
            <div className="flex shrink-0 gap-1" role="group" aria-label="Break revenue down by">
              <Button
                variant={dimension === "room" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={dimension === "room"}
                onClick={() => setDimension("room")}
              >
                Room type
              </Button>
              <Button
                variant={dimension === "plan" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={dimension === "plan"}
                onClick={() => setDimension("plan")}
              >
                Rate plan
              </Button>
            </div>
          }
        >
          {(rows) => <RankedBars rows={rows} format={formatEuros} />}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
```

- [ ] **Step 2: `occupancy-view.tsx`**

```tsx
"use client";

import { formatCount, formatPercent, formatRange } from "@/lib/analytics/format";
import { COMPARE_LABELS } from "@/lib/analytics/period";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { Bars } from "../charts/bars";
import { TimeLine } from "../charts/time-line";
import { DateStrip } from "../date-strip";
import { Stat, StatRow } from "../stat-row";

const percent = (value: number | null) => formatPercent(value, 0);

export function OccupancyPageView({ data }: { data: PageData<"occupancy"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat
          label="Occupancy"
          widget={view.occupancy}
          format={percent}
          info="Share of the nights you made available on OpenBookings that were sold here. Rooms marked out of order are left out; dates you closed for sale still count as available."
        />
        <Stat label="Nights sold" widget={view.nightsSold} format={formatCount} />
        <Stat label="Nights available" widget={view.nightsAvailable} format={formatCount} />
        <Stat
          label="Unsold, next 30 days"
          widget={view.unsoldNext30}
          format={formatCount}
          info="Nights still available over the next 30 days, counted from today. The period does not change it."
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title={view.overTimeGranularity === "day" ? "Occupancy by day" : "Occupancy by week"}
          unit="%"
          basis="stay"
          periodLabel={periodLabel}
          widget={view.overTime}
          className={WIDE}
        >
          {(points) => (
            <TimeLine
              points={points}
              label="Occupancy"
              compareLabel={COMPARE_LABELS[data.compare]}
              format={percent}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Next 90 days"
          unit="Nights sold of available"
          basis="stay"
          periodLabel="From today"
          widget={view.next90}
          emptyMessage="No rooms are available in the next 90 days."
          className={WIDE}
        >
          {(cells) => <DateStrip cells={cells} />}
        </ChartCard>

        {view.pace ? (
          <ChartCard
            title="Pace, next 13 weeks"
            unit="Nights on the books"
            basis="stay"
            periodLabel="Against the same point last year"
            widget={view.pace}
            emptyMessage="Nothing is on the books for the next 13 weeks yet."
          >
            {(points) => (
              <TimeLine
                points={points}
                label="On the books now"
                compareLabel="Same point last year"
                format={formatCount}
              />
            )}
          </ChartCard>
        ) : null}

        <ChartCard
          title="Occupancy by weekday"
          unit="%"
          basis="stay"
          periodLabel={periodLabel}
          widget={view.byWeekday}
        >
          {(rows) => (
            <Bars
              rows={rows.map((row) => ({ ...row, label: row.label.slice(0, 3) }))}
              label="Occupancy"
              format={percent}
              summary={`Occupancy by weekday. ${rows.map((r) => `${r.label} ${percent(r.value)}`).join(", ")}.`}
            />
          )}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
```

- [ ] **Step 3: `booking-patterns-view.tsx`**

```tsx
"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatCents, formatCount, formatDays, formatNights, formatPercent, formatRange,
} from "@/lib/analytics/format";
import type { Bar, PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { Bars } from "../charts/bars";
import { Stat, StatRow } from "../stat-row";

const summarise = (title: string, rows: Bar[]) =>
  `${title}. ${rows.map((r) => `${r.label}: ${formatCount(r.value)}`).join(", ")}.`;

export function BookingPatternsPageView({ data }: { data: PageData<"booking-patterns"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat label="Bookings" widget={view.bookings} format={formatCount} info="Bookings made in this period, including ones later cancelled." />
        <Stat label="Median lead time" widget={view.medianLeadDays} format={formatDays} info="Half of your bookings are made at least this many days before check-in." />
        <Stat label="Median stay length" widget={view.medianStayNights} format={formatNights} info="Half of your stays are at least this long. Cancelled bookings are left out." />
        <Stat label="Cancellation rate" widget={view.cancellationRate} format={formatPercent} info="Share of the bookings made in this period that have been cancelled." />
      </StatRow>

      <WidgetGrid>
        <ChartCard title="Lead time" unit="Bookings" basis="booking" periodLabel={periodLabel} widget={view.leadTime}>
          {(rows) => <Bars rows={rows} label="Bookings" format={formatCount} summary={summarise("Bookings by lead time", rows)} />}
        </ChartCard>

        <ChartCard title="Stay length" unit="Bookings" basis="booking" periodLabel={periodLabel} widget={view.stayLength}>
          {(rows) => <Bars rows={rows} label="Bookings" format={formatCount} summary={summarise("Bookings by stay length", rows)} />}
        </ChartCard>

        <ChartCard
          title="Cancellations by days before check-in"
          unit="Cancelled bookings"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.cancellationsByDaysBefore}
          sampleUnit="cancellations"
        >
          {(rows) => <Bars rows={rows} label="Cancellations" format={formatCount} summary={summarise("Cancellations by days before check-in", rows)} />}
        </ChartCard>

        <ChartCard
          title="Cancellations by rate plan"
          unit="Rate and fees retained"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.byRatePlan}
          className={WIDE}
        >
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate plan</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Cancellation rate</TableHead>
                  <TableHead className="text-right">Fees retained</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.bookings)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.cancelled)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(row.ratePct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(row.feesRetainedCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
```

- [ ] **Step 4: `pricing-view.tsx`**

```tsx
"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents, formatCount, formatEuros, formatPercent, formatRange } from "@/lib/analytics/format";
import { COMPARE_LABELS } from "@/lib/analytics/period";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WIDE, WidgetGrid } from "../chart-card";
import { TimeLine } from "../charts/time-line";
import { Stat, StatRow } from "../stat-row";

export function PricingPageView({ data }: { data: PageData<"pricing"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);
  const share = view.discounts.ok ? view.discounts.value.shareOfBookingsPct : null;

  return (
    <>
      <StatRow>
        <Stat
          label="ADR"
          widget={view.adr}
          format={formatEuros}
          info="Average daily rate: room revenue divided by nights sold, for nights stayed in this period."
        />
        <Stat
          label="Discounts given"
          widget={view.discounts}
          format={formatEuros}
          info="The difference between your standing rate and what guests paid, on bookings made in this period."
          note={share === null ? null : `On ${formatPercent(share, 0)} of bookings`}
        />
        <Stat
          label="Average discount depth"
          widget={view.discountDepth}
          format={formatPercent}
          info="How far below your standing rate a discounted booking was, on average."
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title="ADR over time"
          unit="EUR"
          basis="stay"
          periodLabel={periodLabel}
          widget={view.adrOverTime}
          className={WIDE}
        >
          {(points) => (
            <TimeLine points={points} label="ADR" compareLabel={COMPARE_LABELS[data.compare]} format={formatEuros} />
          )}
        </ChartCard>

        <ChartCard title="By rate plan" unit="EUR" basis="booking" periodLabel={periodLabel} widget={view.byRatePlan}>
          {(rows) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate plan</TableHead>
                  <TableHead className="text-right">Bookings</TableHead>
                  <TableHead className="text-right">Nights</TableHead>
                  <TableHead className="text-right">ADR</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.bookings)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(row.nights)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(row.adrCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(row.revenueCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ChartCard>

        <ChartCard title="By weekday" unit="Occupancy and ADR" basis="stay" periodLabel={periodLabel} widget={view.byWeekday}>
          {(rows) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Weekday</TableHead>
                    <TableHead className="text-right">Occupancy</TableHead>
                    <TableHead className="text-right">ADR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.weekday}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercent(row.occupancyPct, 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(row.adrCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.some((row) => row.hint) ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {rows
                    .filter((row) => row.hint)
                    .map((row) => (
                      <li key={row.weekday}>Rooms on {row.label} sell out below your average rate.</li>
                    ))}
                </ul>
              ) : null}
            </>
          )}
        </ChartCard>
      </WidgetGrid>
    </>
  );
}
```

- [ ] **Step 5: `guests-view.tsx`**

```tsx
"use client";

import { formatCount, formatPercent, formatRange } from "@/lib/analytics/format";
import type { PageData } from "@/lib/analytics/types";
import { ChartCard, WidgetGrid } from "../chart-card";
import { RankedBars } from "../charts/ranked-bars";
import { StackedBar } from "../charts/stacked-bar";
import { Stat, StatRow } from "../stat-row";

const bookings = (value: number) => `${formatCount(value)} ${value === 1 ? "booking" : "bookings"}`;
const partySize = (value: number | null) => (value === null ? "—" : `${value} ${value === 1 ? "guest" : "guests"}`);

export function GuestsPageView({ data }: { data: PageData<"guests"> }) {
  const { view } = data;
  const periodLabel = formatRange(data.range);

  return (
    <>
      <StatRow>
        <Stat
          label="Returning guests"
          widget={view.returning}
          format={(value) => formatPercent(value, 0)}
          info="Share of bookings from guests who had stayed with you before, measured across all your history."
        />
        <Stat
          label="Median party size"
          widget={view.medianPartySize}
          format={partySize}
          info="Half of your bookings are for at least this many guests, adults and children together."
        />
      </StatRow>

      <WidgetGrid>
        <ChartCard
          title="Booker country"
          unit="Bookings"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.countries}
          sampleUnit="guests"
        >
          {(rows) => <RankedBars rows={rows} format={bookings} />}
        </ChartCard>

        <ChartCard
          title="Group type"
          unit="Bookings"
          basis="booking"
          periodLabel={periodLabel}
          widget={view.groupTypes}
          sampleUnit="guests"
        >
          {(rows) => (
            <StackedBar
              rows={rows}
              format={(value) => formatCount(value)}
              summary={`Bookings by group type. ${rows.map((r) => `${r.label}: ${formatCount(r.value)}`).join(", ")}.`}
            />
          )}
        </ChartCard>
      </WidgetGrid>

      <p className="px-4 text-muted-foreground text-xs lg:px-6">
        Totals only. Any group with fewer than five guests is shown as Other, here and in the export, so no single guest can be identified.
      </p>
    </>
  );
}
```

- [ ] **Step 6: Wire the routes**

`revenue/page.tsx`:

```tsx
import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { RevenuePageView } from "../_components/pages/revenue-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="revenue" searchParams={searchParams} View={RevenuePageView} />;
}
```

`occupancy/page.tsx`:

```tsx
import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { OccupancyPageView } from "../_components/pages/occupancy-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="occupancy" searchParams={searchParams} View={OccupancyPageView} />;
}
```

`booking-patterns/page.tsx`:

```tsx
import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { BookingPatternsPageView } from "../_components/pages/booking-patterns-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="booking-patterns" searchParams={searchParams} View={BookingPatternsPageView} />;
}
```

`pricing/page.tsx`:

```tsx
import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { PricingPageView } from "../_components/pages/pricing-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="pricing" searchParams={searchParams} View={PricingPageView} />;
}
```

`guests/page.tsx`:

```tsx
import { AnalyticsPage, type AnalyticsRouteProps } from "../_components/analytics-page";
import { GuestsPageView } from "../_components/pages/guests-view";

export default function Page({ searchParams }: AnalyticsRouteProps) {
  return <AnalyticsPage page="guests" searchParams={searchParams} View={GuestsPageView} />;
}
```

- [ ] **Step 7: Verify and commit**

Run: `bun test lib/analytics && bun run typecheck && bun run lint`
Expected: PASS, rc=0. The guards test now walks the UI too: no property identifier, no old vocabulary, no pie, no smoothing.

```bash
git add "app/(dashboard)/dashboard/analytics"
git commit -m "Build the five analytics page views"
```

---

### Task 15: Docs page and end-to-end verification

**Files:**
- Modify: `apps/docs/content/docs/business/analytics/index.mdx` (from the repo root)

- [ ] **Step 1: Update the docs page**

Replace the body of `apps/docs/content/docs/business/analytics/index.mdx` below the frontmatter, keeping the frontmatter as it is:

```mdx
*Last updated: 1 October 2026*

## Overview

**Analytics** shows how your property performs on OpenBookings. It has five pages, each answering one question:

| Page | Question |
| --- | --- |
| **Revenue** | What did I earn, and what does OpenBookings take? |
| **Occupancy** | How full am I, and what is still unsold? |
| **Booking patterns** | When do guests book, how long do they stay, and who cancels? |
| **Pricing** | Are my rates working? |
| **Guests** | Who is staying with me? |

## Period and comparison

The period control sits at the top right of every page, beside **Export CSV**. Pick a period, and optionally compare it with the previous period or the same period last year. Your choice follows you from page to page. Comparing with last year becomes available once you have 12 months of data.

## How figures are counted

- **Revenue** is net room revenue: excluding VAT, tourist tax and non-room fees, after discounts.
- **Commission** is 4.5% of that revenue and is shown separately.
- **Occupancy** is nights sold divided by nights available. Rooms marked out of order are left out; dates you closed for sale still count as available.
- Each chart states whether it counts by **booking date** (when the reservation was made) or **stay date** (when the guest sleeps there).

## Before your first booking

Until you receive a booking, each page shows an outline of what it will contain and a short checklist of what is still open: your listing, availability, rate plans and payments. **Preview with demo data** fills the pages with example numbers. Export is switched off while demo data is shown.

## Guest privacy

The Guests page shows totals only. Any group with fewer than five guests is shown as **Other**, on screen and in the export.
```

- [ ] **Step 2: Full automated check**

Run from `apps/business`: `bun test && bun run typecheck && bun run lint`
Expected: all analytics tests pass, the rest of the app's suite is unchanged (the `DATABASE_URL`-gated tests still skip), typecheck rc=0, no new lint warnings.

- [ ] **Step 3: Browser pass**

Start the app with `bun run dev` (port 3001) and sign in as a host. Use the browser tooling available in the session. For each of the five pages, check these three URLs and record a pass or the defect:

| URL | Expect |
| --- | --- |
| `/dashboard/analytics/<page>` | Header with period control beside a disabled Export CSV; ghost layout; message card with the checklist and "Preview with demo data"; no horizontal scroll |
| `/dashboard/analytics/<page>?demo=1` | Amber banner; stat row; every card filled; Export disabled with its tooltip |
| `/dashboard/analytics/<page>?demo=1&period=custom&from=2022-01-01&to=2022-01-31` | Normal page, stats at zero or a dash, each chart area reads "No bookings in this period. Try a longer period." |

Then check, once:

- Changing the period on Revenue, then clicking Occupancy in the sidebar, keeps the period and `demo=1` in the URL.
- "Same period last year" is selectable on the default period in demo and disabled with its tooltip on `?demo=1&period=custom&from=2024-07-01&to=2024-07-31`.
- `?demo=1&period=last-7-days` on Revenue shows a table, not a line chart, for Revenue over time.
- The Revenue line ends in a dashed segment on the default period.
- No delta chip reads "0%"; with `&compare=none` there are no delta chips at all.
- `/dashboard/analytics/sell-through?demo=1` lands on `/dashboard/analytics/occupancy?demo=1`, and `/dashboard/analytics/bookings` on `/dashboard/analytics/booking-patterns`.
- At a 390px-wide viewport, the never-booked state and a demo page have no horizontal scroll and the header controls wrap under the title.
- The network tab shows no request carrying a property identifier.

Fix anything that fails, re-run Step 2, and note in the commit message what the browser pass found.

- [ ] **Step 4: Commit**

```bash
cd ../.. && git add apps/docs/content/docs/business/analytics/index.mdx apps/business
git commit -m "Document the rebuilt analytics pages"
```

---

## Deviations from the spec, decided in this plan

- **Pace covers 13 whole weeks (91 days), not 90 days**, so every point is a complete week and comparable with last year's.
- **A bucket is also marked incomplete when the range ends before the bucket does**, not only when it ends after today. A custom range ending mid-week has the same false cliff.
- **Demo prices are computed in the generator**, not through `@openbookings/pricing`, which keeps the demo clear of that package's local-timezone defect.
- **The demo hotel opens on 1 June 2024** (was 1 March 2025), so year-over-year comparison and pace have a full year behind them.
- **Permanent redirects answer 308**, Next's method-preserving permanent redirect, where the spec says 301.



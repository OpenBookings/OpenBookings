# Business Analytics Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Analytics tab in `apps/business` — sections 1–5, global filters, per-section CSV export and every state — entirely on generated demo data, behind one function real queries can later replace.

**Architecture:** A seeded generator produces two fact arrays (`NightFact[]`, `BookingFact[]`) shaped to mirror the database schema. Pure derivation modules turn those facts into a fully-derived `AnalyticsData` view model on the server. React section components render that view model; only chart leaves are `"use client"`. The single entry point is `getAnalytics()`; when real queries land, only its body changes.

**Tech Stack:** Next 16 (App Router, React 19 server components), TypeScript, Tailwind 4, shadcn/ui (new-york, neutral), recharts via shadcn Chart, `bun test`, `@openbookings/pricing` for modifier resolution.

**Spec:** `docs/superpowers/specs/2026-09-25-business-analytics-tab-design.md` — read it before Task 1. The plan argues from the spec; where this plan and the spec disagree, the spec wins and the disagreement is a bug in this plan.

## Global Constraints

- **shadcn/ui only.** No other UI or chart library, no hand-built substitutes for a missing component. recharts arrives as shadcn Chart's own dependency and is the only exception.
- **"Sell-through", never "occupancy"** — in UI copy, CSV headers, aria-labels, type names, identifiers and comments. Task 1 adds a test that enforces this across the whole feature.
- **Money is integer cents** inside `lib/analytics/`. Every cents-bearing field and variable ends in `Cents`. Conversion from the euro-denominated schema and pricing calculator happens once, in `demo/generate.ts`. Display goes through `Intl.NumberFormat` with `currency: "EUR"`.
- **Deterministic.** Seeded PRNG only. No `Math.random()`, no bare `new Date()` inside derivation or generation — the caller passes `today` as an `IsoDate`, as `resolveRoom` in `packages/pricing/src/calculator.ts` already does.
- **Demo data is opt-in via `?demo=1`.** Never a fallback. Without it `getAnalytics()` returns an empty dataset.
- **Net room revenue** excludes VAT, tourist tax and non-room fees, and is after discounts.
- **Commission is 4.5%**, rounded once over the period total.
- **Countries with fewer than 5 bookings fold into "Other"**, in the view model and the CSV alike.
- **The UI imports only `getAnalytics` and types** from `lib/analytics/`. No component imports anything under `demo/` or `derive/`.
- **Commit style follows the repo**: a sentence in the imperative describing the change's effect, no `feat:`/`fix:` prefixes (see `git log`). Every commit ends with the two attribution lines this session is configured with.
- **Tests and builds run from `apps/business`** (`bun test <path>`, `bun run typecheck`, `bun run lint`). **Git commands run from the repo root**, which is why every `git add` path in this plan starts with `apps/business/`.

## Review Focus

Five conditions the spec implies but which no task's own feature tests would otherwise reach. Each has a test added to the task that owns the code.

1. **A period with zero nights available** (property fully closed, or a custom range before the property existed) divides by zero in ADR, RevPAR and sell-through. Expect `null` carried to a "—" display, never `NaN` or `Infinity`. → Task 9.
2. **A custom range with `from` after `to`, or a single day, or spanning a year boundary.** Expect the range swapped rather than rejected, a single day treated as one bucket, and no off-by-one at the year boundary for YTD. → Task 3.
3. **Timezone and DST.** `today`, week bucketing and the YTD boundary are date-string arithmetic; a bare `new Date()` resolved in a non-Amsterdam zone shifts the day and breaks determinism between server render and client hydration. Expect all date maths on `YYYY-MM-DD` strings, never on `Date` local getters. → Task 3.
4. **A period entirely in the future.** Nights available is positive, nights sold is zero. Expect sell-through 0%, ADR "—" (no nights sold to divide by), RevPAR €0 — three different answers to three divisions that all look similar. → Task 8.
5. **A custom range older than the generated history.** Facts are empty but the property is not new. Expect the empty-period state ("No stays in this period."), never the new-property Alert, which must key off "no bookings ever" rather than "no bookings here". → Task 13.

---

## File Structure

```
apps/business/lib/analytics/
  types.ts                  AnalyticsData, fact types, Widget<T>. No logic.
  period.ts                 Presets <-> ranges, clamping, granularity, comparison ranges.
  get-analytics.ts          The single entry point.
  csv.ts                    View model -> CSV, per section.
  format.ts                 Cents/percent/date display helpers shared by widgets.
  demo/rng.ts               Seeded PRNG.
  demo/properties.ts        The three demo properties and their inventory.
  demo/generate.ts          Facts for one property over a range.
  derive/widget.ts          Widget<T> and the wrapper that contains a throw.
  derive/buckets.ts         Day / week / month bucketing.
  derive/delta.ts           Comparison against the previous period.
  derive/revenue.ts         Section 1.
  derive/sell-through.ts    Section 2.
  derive/bookings.ts        Section 3.
  derive/pricing.ts         Section 4.
  derive/guests.ts          Section 5.

apps/business/app/(dashboard)/dashboard/analytics/
  page.tsx                  Server page: parse params, call getAnalytics, choose state.
  _components/
    analytics-view.tsx      Client shell: owns filter state -> URL.
    analytics-filters.tsx   Period Select, property Select, custom-range Popover+Calendar.
    widget-frame.tsx        Card + title + tooltip + error/retry + empty message.
    kpi-card.tsx            KPI, delta with text, optional sparkline.
    export-button.tsx       Per-section CSV download.
    analytics-skeleton.tsx  Per-widget skeletons at final dimensions.
    states.tsx              New-property Alert, empty-period message.
    charts/line-chart.tsx   Revenue and sell-through over time; two-series variant.
    charts/bar-chart.tsx    Horizontal ranked bars.
    charts/stacked-bar.tsx  Upcoming 30/60/90.
    charts/histogram.tsx    Lead time buckets.
    heatmap-table.tsx       Busiest days of the week (tinted Table).
    ranked-list.tsx         Modifiers and countries, with inline bars.
    revenue-section.tsx
    sell-through-section.tsx
    bookings-section.tsx
    pricing-section.tsx
    guests-section.tsx
```

Tests sit beside the module they test (`period.test.ts` next to `period.ts`), matching `rates-availability/_lib/`.

---

## Task 1: Foundations — shadcn components, types, vocabulary guard

**Files:**
- Create: `apps/business/lib/analytics/types.ts`
- Create: `apps/business/lib/analytics/vocabulary.test.ts`
- Modify: `apps/business/components.json` (untouched; shadcn CLI writes into `components/ui/`)

**Interfaces:**
- Consumes: `ModifierType` from `@openbookings/pricing`.
- Produces: every type the rest of the plan names — `IsoDate`, `NightFact`, `BookingFact`, `PropertySummary`, `Widget<T>`, `Delta`, `Point`, `Category`, `RevenueSection`, `SellThroughSection`, `BookingsSection`, `PricingSection`, `GuestsSection`, `AnalyticsData`.

- [ ] **Step 1: Install the four missing shadcn components**

Run from `apps/business`:

```bash
bunx --bun shadcn@latest add chart calendar popover progress
```

This also installs `recharts` (shadcn Chart's own dependency) and `react-day-picker`. Confirm afterwards that `components/ui/chart.tsx`, `calendar.tsx`, `popover.tsx` and `progress.tsx` exist and that `package.json` gained `recharts`.

- [ ] **Step 2: Write the vocabulary guard test**

It fails now because `lib/analytics/` does not exist. That is the red.

```ts
// apps/business/lib/analytics/vocabulary.test.ts
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * We only ever see OpenBookings bookings, never the host's other channels, so
 * the denominator is the inventory they gave us — not the hotel. A host who
 * reads "occupancy" will compare it against their PMS and conclude we are
 * wrong. The word must not survive anywhere a host can reach it, which
 * includes CSV headers, aria-labels and tooltips, so this walks source rather
 * than checking rendered output.
 */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
    }),
  );
  return files.flat().filter((f) => /\.tsx?$/.test(f));
}

const ROOTS = ["lib/analytics", "app/(dashboard)/dashboard/analytics"];

describe("analytics vocabulary", () => {
  test("says sell-through, never occupancy", async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of await walk(root)) {
        const source = await readFile(file, "utf8");
        source.split("\n").forEach((line, i) => {
          if (/occupanc/i.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test lib/analytics/vocabulary.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, scandir 'lib/analytics'`.

- [ ] **Step 4: Write `types.ts`**

```ts
// apps/business/lib/analytics/types.ts
import type { ModifierType } from "@openbookings/pricing";

/** Calendar date, `YYYY-MM-DD`. Every date in this module is one of these. */
export type IsoDate = string;

/** ISO 8601 instant. Booking creation and cancellation carry a time. */
export type IsoInstant = string;

// ─────────────────────────────────────────────
// Facts — the seam. See the spec's "The seam" table for the real source of
// every field. Change these only alongside that table.
// ─────────────────────────────────────────────

/** One room type's trading on one date. The grain everything derives from. */
export interface NightFact {
  date: IsoDate;
  propertyId: string;
  /** A `rooms` row IS the room type. */
  roomId: string;
  ratePlanId: string;
  /** rooms.total_units, less blocked and closed units. */
  unitsAvailable: number;
  unitsSold: number;
  /** Net room revenue: ex VAT, ex tourist tax, ex fees, after discounts. */
  netRevenueCents: number;
  /** Rate plan BAR before modifiers, multiplied by unitsSold. */
  basePriceCents: number;
  modifiers: { type: ModifierType; impactCents: number }[];
}

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";

export interface BookingFact {
  id: string;
  propertyId: string;
  /** Drives lead time and "bookings created in period". */
  createdAt: IsoInstant;
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: number;
  status: BookingStatus;
  cancelledAt: IsoInstant | null;
  adults: number;
  children: number;
  /** Stands in for bookings.user_id. */
  guestKey: string;
  /** ISO-3166-1 alpha-2. No database source exists yet — see the spec. */
  guestCountry: string;
  netRevenueCents: number;
  roomId: string;
  ratePlanId: string;
}

export interface Facts {
  nights: NightFact[];
  bookings: BookingFact[];
  roomTypeNames: Record<string, string>;
  ratePlanNames: Record<string, string>;
}

// ─────────────────────────────────────────────
// View model
// ─────────────────────────────────────────────

export interface PropertySummary {
  id: string;
  name: string;
}

/**
 * One widget's outcome. A derivation that throws is contained here rather than
 * taking the page down with it; today that is defensive, and when one aggregate
 * query can fail while its neighbours succeed it becomes load-bearing.
 */
export type Widget<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * `pct` is null when there is nothing to compare against, which renders "—".
 * `label` is the text beside the arrow, because colour and glyph alone are not
 * enough. `goodDirection` inverts for Cancellations and Average discount.
 */
export interface Delta {
  pct: number | null;
  direction: "up" | "down" | "flat";
  label: string;
  goodDirection: "up" | "down";
}

/** One point on a time series. `label` is pre-formatted for axis and tooltip. */
export interface Point {
  bucket: IsoDate;
  label: string;
  value: number;
}

/** One bar in a ranked chart or list. */
export interface Category {
  key: string;
  label: string;
  value: number;
  /** Populated where a list shows a second figure, e.g. times a modifier fired. */
  count?: number;
}

export type Granularity = "day" | "week" | "month";

export interface KpiWithDelta {
  value: number | null;
  delta: Delta;
}

export interface KpiWithSpark {
  value: number | null;
  spark: Point[];
}

export interface RevenueSection {
  yearToDateCents: Widget<KpiWithDelta>;
  periodCents: Widget<KpiWithDelta>;
  adrCents: Widget<KpiWithSpark>;
  revparCents: Widget<KpiWithSpark>;
  overTime: Widget<Point[]>;
  byRoomType: Widget<Category[]>;
  byRatePlan: Widget<Category[]>;
  commissionCents: Widget<number>;
}

/** One cell of the busiest-days table. `pct` is null where no inventory existed. */
export interface HeatCell {
  weekStart: IsoDate;
  weekday: number; // 1 = Monday ... 7 = Sunday
  pct: number | null;
  nightsSold: number;
  nightsAvailable: number;
}

export interface Heatmap {
  weeks: { start: IsoDate; label: string }[];
  cells: HeatCell[];
}

export interface SellThroughSection {
  pct: Widget<KpiWithDelta>;
  roomsSold: Widget<number>;
  overTime: Widget<Point[]>;
  byRoomType: Widget<Category[]>;
  busiestDays: Widget<Heatmap>;
}

export interface UpcomingWindow {
  window: 30 | 60 | 90;
  label: string;
  nightsSold: number;
  nightsAvailable: number;
}

export interface BookingsSection {
  count: Widget<KpiWithDelta>;
  averageLengthOfStay: Widget<number | null>;
  cancellations: Widget<KpiWithDelta & { count: number }>;
  leadTime: Widget<Category[]>;
  upcoming: Widget<UpcomingWindow[]>;
}

export interface PricingSection {
  averageDiscountPct: Widget<number | null>;
  priceOverTime: Widget<{ base: Point[]; achieved: Point[] }>;
  topModifiers: Widget<Category[]>;
}

export interface GuestsSection {
  averagePartySize: Widget<number | null>;
  repeatGuestPct: Widget<number | null>;
  countries: Widget<Category[]>;
}

export interface AnalyticsData {
  property: PropertySummary;
  properties: PropertySummary[];
  range: { from: IsoDate; to: IsoDate };
  granularity: Granularity;
  /** False only for a property that has never had a booking. Drives the Alert. */
  hasAnyBookings: boolean;
  /** Gates the widgets that need at least 5 bookings to be safe or meaningful. */
  bookingsInPeriod: number;
  /** True when this data was generated rather than queried. Drives the banner. */
  isDemo: boolean;
  revenue: RevenueSection;
  sellThrough: SellThroughSection;
  bookings: BookingsSection;
  pricing: PricingSection;
  guests: GuestsSection;
}

/** Widgets that refuse to render below five bookings, named so the UI and the
 * "not enough data" tests cannot disagree about which they are. */
export const MIN_BOOKINGS_FOR_DETAIL = 5;
```

- [ ] **Step 5: Run the vocabulary test to verify it passes**

Run: `bun test lib/analytics/vocabulary.test.ts`
Expected: PASS — the directory now exists and holds no offending word.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/business/lib/analytics apps/business/components/ui apps/business/package.json bun.lock
git commit -m "$(cat <<'MSG'
Give the analytics tab its vocabulary and its shape

Types only, plus the four shadcn components the widgets need. The
vocabulary test is here first on purpose: "occupancy" is the word a host
would measure against their PMS and find wrong, and it is easiest to keep
out before there is any copy to fix.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 2: Seeded PRNG

**Files:**
- Create: `apps/business/lib/analytics/demo/rng.ts`
- Test: `apps/business/lib/analytics/demo/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeRng(seed: string): Rng` where `Rng` is `{ next(): number; int(min: number, max: number): number; pick<T>(items: T[]): T; bool(p: number): boolean }`. `next()` returns `[0, 1)`. `int` is inclusive of both bounds.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/demo/rng.test.ts
import { describe, expect, test } from "bun:test";
import { makeRng } from "./rng";

/**
 * Determinism is the whole point. `Math.random()` at render would mismatch
 * between the server pass and hydration, and would hand the host a different
 * revenue figure on every refresh — which is worse than a wrong one, because
 * it is not even wrong twice.
 */
describe("makeRng", () => {
  test("the same seed replays the same sequence", () => {
    const a = makeRng("zeeburg");
    const b = makeRng("zeeburg");
    const draw = (r: ReturnType<typeof makeRng>) =>
      Array.from({ length: 20 }, () => r.next());
    expect(draw(a)).toEqual(draw(b));
  });

  test("different seeds diverge", () => {
    const a = Array.from({ length: 20 }, () => makeRng("zeeburg").next());
    const b = Array.from({ length: 20 }, () => makeRng("vlierhof").next());
    expect(a).not.toEqual(b);
  });

  test("next stays in [0, 1)", () => {
    const rng = makeRng("range");
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("int is inclusive at both ends and never leaves them", () => {
    const rng = makeRng("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  test("pick returns a member of the array", () => {
    const rng = makeRng("pick");
    const items = ["NL", "BE", "DE"];
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });

  test("bool(1) is always true and bool(0) always false", () => {
    const rng = makeRng("bool");
    for (let i = 0; i < 50; i++) {
      expect(rng.bool(1)).toBe(true);
      expect(rng.bool(0)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/demo/rng.test.ts`
Expected: FAIL — `Cannot find module './rng'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/demo/rng.ts

/**
 * mulberry32 over an FNV-1a hash of the seed string. Small, fast, and — the
 * only property that matters here — reproducible, so the same property and the
 * same date range always produce the same numbers on the server and in the
 * browser.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer, inclusive of both bounds. */
  int(min: number, max: number): number;
  pick<T>(items: T[]): T;
  /** True with probability `p`. */
  bool(p: number): boolean;
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function makeRng(seed: string): Rng {
  let state = hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    bool: (p) => next() < p,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/demo/rng.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/demo
git commit -m "$(cat <<'MSG'
Seed the demo numbers so they survive a refresh

Math.random() at render would disagree between the server pass and
hydration, and would show the host a different revenue figure every time
they reload. mulberry32 over a hashed seed replays exactly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 3: Period resolution, clamping and granularity

**Files:**
- Create: `apps/business/lib/analytics/period.ts`
- Test: `apps/business/lib/analytics/period.test.ts`

**Interfaces:**
- Consumes: `IsoDate`, `Granularity` from `../types`.
- Produces:
  - `type PeriodPreset = "this-month" | "last-month" | "last-3-months" | "ytd" | "last-12-months" | "custom"`
  - `const PERIOD_LABELS: Record<PeriodPreset, string>`
  - `interface Period { preset: PeriodPreset; from: IsoDate; to: IsoDate }`
  - `resolvePeriod(preset: PeriodPreset, today: IsoDate, custom?: { from?: string; to?: string }): Period`
  - `parsePeriodParams(params: { period?: string; from?: string; to?: string }, today: IsoDate): Period`
  - `granularityFor(period: Period): Granularity`
  - `comparisonRange(period: Period): { from: IsoDate; to: IsoDate } | null`
  - Date helpers reused everywhere: `addDays(date: IsoDate, days: number): IsoDate`, `daysBetween(from: IsoDate, to: IsoDate): number` (inclusive), `startOfWeek(date: IsoDate): IsoDate` (Monday), `startOfMonth(date: IsoDate): IsoDate`, `weekdayOf(date: IsoDate): number` (1 = Monday … 7 = Sunday), `enumerateDates(from: IsoDate, to: IsoDate): IsoDate[]`.

**Why these live together:** granularity, the comparison range and the date helpers all read the same `{from, to}`. Splitting them lets the revenue chart and the sell-through chart bucket differently, which is exactly the bug the spec's "period.ts owns that decision" line exists to prevent.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/period.test.ts
import { describe, expect, test } from "bun:test";
import {
  addDays,
  comparisonRange,
  daysBetween,
  enumerateDates,
  granularityFor,
  parsePeriodParams,
  resolvePeriod,
  startOfWeek,
  weekdayOf,
} from "./period";

const TODAY = "2026-09-25"; // a Friday

describe("date helpers", () => {
  test("addDays crosses months and years without a Date local getter", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  /**
   * Review Focus 3. Europe/Amsterdam moves to summer time on 2026-03-29 and
   * back on 2026-10-25. Date arithmetic that goes through a Date object and
   * local getters lands on the wrong day across those boundaries, and — worse —
   * lands on a *different* wrong day on a server in UTC than in a browser in
   * CET, which is a hydration mismatch that only appears twice a year.
   */
  test("date arithmetic is unaffected by DST transitions", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(3);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(3);
  });

  test("daysBetween is inclusive of both ends", () => {
    expect(daysBetween("2026-09-25", "2026-09-25")).toBe(1);
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(30);
  });

  test("startOfWeek snaps back to Monday, and is idempotent", () => {
    expect(startOfWeek("2026-09-25")).toBe("2026-09-21"); // Fri -> Mon
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // Sun belongs to the week before
  });

  test("weekdayOf is 1..7 with Monday first", () => {
    expect(weekdayOf("2026-09-21")).toBe(1);
    expect(weekdayOf("2026-09-25")).toBe(5);
    expect(weekdayOf("2026-09-27")).toBe(7);
  });

  test("enumerateDates covers both ends", () => {
    expect(enumerateDates("2026-09-25", "2026-09-27")).toEqual([
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
    expect(enumerateDates("2026-09-25", "2026-09-25")).toEqual(["2026-09-25"]);
  });
});

describe("resolvePeriod", () => {
  test("this month runs from the 1st to today, not to month end", () => {
    expect(resolvePeriod("this-month", TODAY)).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-25",
    });
  });

  test("last month is the whole previous calendar month", () => {
    expect(resolvePeriod("last-month", TODAY)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  test("last month handles a January today by stepping into last year", () => {
    expect(resolvePeriod("last-month", "2026-01-15")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("last 3 months ends today", () => {
    expect(resolvePeriod("last-3-months", TODAY)).toMatchObject({
      from: "2026-06-26",
      to: "2026-09-25",
    });
  });

  test("year to date starts 1 January", () => {
    expect(resolvePeriod("ytd", TODAY)).toMatchObject({
      from: "2026-01-01",
      to: "2026-09-25",
    });
  });

  test("last 12 months ends today", () => {
    expect(resolvePeriod("last-12-months", TODAY)).toMatchObject({
      from: "2025-09-26",
      to: "2026-09-25",
    });
  });
});

describe("parsePeriodParams", () => {
  test("defaults to this month", () => {
    expect(parsePeriodParams({}, TODAY).preset).toBe("this-month");
  });

  test("an unknown preset falls back to this month rather than throwing", () => {
    expect(parsePeriodParams({ period: "since-forever" }, TODAY).preset).toBe(
      "this-month",
    );
  });

  test("a custom range is honoured", () => {
    expect(
      parsePeriodParams(
        { period: "custom", from: "2026-07-01", to: "2026-07-31" },
        TODAY,
      ),
    ).toMatchObject({ preset: "custom", from: "2026-07-01", to: "2026-07-31" });
  });

  /**
   * Review Focus 2. A host dragging backwards through the Calendar popover
   * produces from > to for as long as the drag lasts. Rejecting it blanks the
   * page mid-gesture; swapping shows them the range they are drawing.
   */
  test("a reversed custom range is swapped, not rejected", () => {
    expect(
      parsePeriodParams(
        { period: "custom", from: "2026-07-31", to: "2026-07-01" },
        TODAY,
      ),
    ).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

  test("a single-day custom range survives", () => {
    const period = parsePeriodParams(
      { period: "custom", from: "2026-07-04", to: "2026-07-04" },
      TODAY,
    );
    expect(period).toMatchObject({ from: "2026-07-04", to: "2026-07-04" });
    expect(granularityFor(period)).toBe("day");
  });

  test("a custom range spanning the year boundary survives intact", () => {
    expect(
      parsePeriodParams(
        { period: "custom", from: "2025-12-15", to: "2026-01-15" },
        TODAY,
      ),
    ).toMatchObject({ from: "2025-12-15", to: "2026-01-15" });
  });

  test("a malformed custom date falls back to this month", () => {
    expect(
      parsePeriodParams({ period: "custom", from: "yesterday" }, TODAY).preset,
    ).toBe("this-month");
    expect(
      parsePeriodParams({ period: "custom", from: "2026-13-45", to: "2026-07-01" }, TODAY)
        .preset,
    ).toBe("this-month");
  });

  test("a custom range is clamped to five years so one URL cannot ask for everything", () => {
    const period = parsePeriodParams(
      { period: "custom", from: "1999-01-01", to: "2026-09-25" },
      TODAY,
    );
    expect(daysBetween(period.from, period.to)).toBeLessThanOrEqual(366 * 5);
  });
});

describe("granularityFor", () => {
  test("31 days buckets by day, 32 by week", () => {
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-01-31" })).toBe("day");
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-02-01" })).toBe("week");
  });

  test("six months buckets by week, a day more by month", () => {
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-06-30" })).toBe("week");
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-07-02" })).toBe("month");
  });
});

describe("comparisonRange", () => {
  test("an ordinary period compares against the equal-length span before it", () => {
    expect(
      comparisonRange({ preset: "this-month", from: "2026-09-01", to: "2026-09-25" }),
    ).toEqual({ from: "2026-08-07", to: "2026-08-31" });
  });

  test("year to date compares against the same span last year", () => {
    expect(comparisonRange({ preset: "ytd", from: "2026-01-01", to: "2026-09-25" })).toEqual({
      from: "2025-01-01",
      to: "2025-09-25",
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/period.test.ts`
Expected: FAIL — `Cannot find module './period'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/period.ts
import type { Granularity, IsoDate } from "./types";

/**
 * Every date in analytics is a `YYYY-MM-DD` string and every calculation on it
 * runs in UTC. A Date built from a local timestamp reads back a different day
 * either side of a DST change, and reads back a different day again on a server
 * in UTC than in a browser in CET — a hydration mismatch that surfaces twice a
 * year and is nearly impossible to reproduce on purpose.
 */
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: IsoDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True only for a well-formed date that survives a round trip, so "2026-13-45" fails. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Inclusive of both ends: a single day is 1, not 0. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: IsoDate): number {
  return ((new Date(toUtc(date)).getUTCDay() + 6) % 7) + 1;
}

export function startOfWeek(date: IsoDate): IsoDate {
  return addDays(date, -(weekdayOf(date) - 1));
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = date.split("-").map(Number);
  return fromUtc(Date.UTC(y, m, 0));
}

export function enumerateDates(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export type PeriodPreset =
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "ytd"
  | "last-12-months"
  | "custom";

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "last-3-months": "Last 3 months",
  ytd: "Year to date",
  "last-12-months": "Last 12 months",
  custom: "Custom range",
};

export const PERIOD_PRESETS = Object.keys(PERIOD_LABELS) as PeriodPreset[];

export interface Period {
  preset: PeriodPreset;
  from: IsoDate;
  to: IsoDate;
}

/** One URL must not be able to ask for the whole history at daily grain. */
const MAX_CUSTOM_DAYS = 366 * 5;

export function resolvePeriod(
  preset: PeriodPreset,
  today: IsoDate,
  custom?: { from?: string; to?: string },
): Period {
  switch (preset) {
    case "this-month":
      return { preset, from: startOfMonth(today), to: today };
    case "last-month": {
      const lastMonthDay = addDays(startOfMonth(today), -1);
      return { preset, from: startOfMonth(lastMonthDay), to: endOfMonth(lastMonthDay) };
    }
    case "last-3-months":
      // 3 months back, then forward one day, so the span is inclusive.
      return { preset, from: addDays(shiftMonths(today, -3), 1), to: today };
    case "ytd":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last-12-months":
      return { preset, from: addDays(shiftMonths(today, -12), 1), to: today };
    case "custom": {
      if (!isIsoDate(custom?.from) || !isIsoDate(custom?.to)) {
        return resolvePeriod("this-month", today);
      }
      // Swapped rather than rejected: a host dragging backwards through the
      // Calendar produces from > to for the length of the drag, and blanking
      // the page mid-gesture is not a useful answer to a half-finished range.
      let [from, to] =
        custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
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
  return fromUtc(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)),
  );
}

/** Query params are user input. Anything unrecognised falls back; nothing throws. */
export function parsePeriodParams(
  params: { period?: string; from?: string; to?: string },
  today: IsoDate,
): Period {
  const preset = (PERIOD_PRESETS as string[]).includes(params.period ?? "")
    ? (params.period as PeriodPreset)
    : "this-month";
  return resolvePeriod(preset, today, { from: params.from, to: params.to });
}

/**
 * One decision, in one place. If the revenue chart and the sell-through chart
 * each chose their own granularity they would eventually disagree, and a host
 * comparing the two would be comparing different weeks.
 */
export function granularityFor(period: Pick<Period, "from" | "to">): Granularity {
  const days = daysBetween(period.from, period.to);
  if (days <= 31) return "day";
  if (days <= 183) return "week";
  return "month";
}

/** Null when the comparison span would run before any data could exist. */
export function comparisonRange(period: Period): { from: IsoDate; to: IsoDate } | null {
  if (period.preset === "ytd") {
    return { from: shiftYears(period.from, -1), to: shiftYears(period.to, -1) };
  }
  const days = daysBetween(period.from, period.to);
  return { from: addDays(period.from, -days), to: addDays(period.from, -1) };
}

function shiftYears(date: IsoDate, years: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return fromUtc(Date.UTC(y + years, m - 1, Math.min(d, lastDay)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/period.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/period.ts apps/business/lib/analytics/period.test.ts
git commit -m "$(cat <<'MSG'
Do analytics date maths on strings, in UTC, in one place

Dates here are YYYY-MM-DD and every calculation runs in UTC. A Date built
from a local timestamp reads back a different day either side of a DST
change, and a different day again on a UTC server than in a CET browser —
a hydration mismatch that appears twice a year and resists reproduction.

Granularity and the comparison range live here too, so the revenue chart
and the sell-through chart cannot bucket differently and leave a host
comparing different weeks.

A reversed custom range is swapped rather than rejected: dragging
backwards through the calendar produces one for the length of the drag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 4: The widget wrapper

**Files:**
- Create: `apps/business/lib/analytics/derive/widget.ts`
- Test: `apps/business/lib/analytics/derive/widget.test.ts`

**Interfaces:**
- Consumes: `Widget` from `../types`.
- Produces: `widget<T>(compute: () => T): Widget<T>`, and `unwrapOr<T>(w: Widget<T>, fallback: T): T` for the CSV writer, which needs a value or a blank rather than a branch.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/widget.test.ts
import { describe, expect, test } from "bun:test";
import { unwrapOr, widget } from "./widget";

/**
 * The States table requires that one failing widget must not blank the page.
 * With a single getAnalytics() call there is one failure point, so containment
 * has to happen per derivation rather than per fetch. Today that is defensive;
 * when one aggregate query can fail while its neighbours succeed it is the
 * mechanism that keeps the other four sections on screen.
 */
describe("widget", () => {
  test("carries the computed value", () => {
    expect(widget(() => 42)).toEqual({ ok: true, value: 42 });
  });

  test("contains a throw instead of propagating it", () => {
    const result = widget<number>(() => {
      throw new Error("division by zero in ADR");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("division by zero in ADR");
  });

  test("survives a thrown non-Error", () => {
    const result = widget<number>(() => {
      throw "just a string";
    });
    expect(result).toEqual({ ok: false, message: "Something went wrong." });
  });

  test("a falsy value is still a success", () => {
    expect(widget(() => 0)).toEqual({ ok: true, value: 0 });
    expect(widget(() => null)).toEqual({ ok: true, value: null });
  });
});

describe("unwrapOr", () => {
  test("returns the value when present and the fallback when not", () => {
    expect(unwrapOr(widget(() => 7), 0)).toBe(7);
    expect(
      unwrapOr(
        widget<number>(() => {
          throw new Error("nope");
        }),
        0,
      ),
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/widget.test.ts`
Expected: FAIL — `Cannot find module './widget'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/derive/widget.ts
import type { Widget } from "../types";

/**
 * Runs one widget's derivation and contains anything it throws, so a single bad
 * division cannot take the other nineteen widgets down with it. The message
 * reaches the host, so it stays short and does not carry a stack.
 */
export function widget<T>(compute: () => T): Widget<T> {
  try {
    return { ok: true, value: compute() };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

export function unwrapOr<T>(result: Widget<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/widget.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/derive
git commit -m "$(cat <<'MSG'
Contain a widget's failure to that widget

One getAnalytics() call is one failure point, but a single bad division
must not blank a page carrying nineteen other widgets. Wrapping each
derivation is defensive today and load-bearing once one aggregate query
can fail while its neighbours succeed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 5: Demo properties and the fact generator

**Files:**
- Create: `apps/business/lib/analytics/demo/properties.ts`
- Create: `apps/business/lib/analytics/demo/generate.ts`
- Test: `apps/business/lib/analytics/demo/generate.test.ts`

**Interfaces:**
- Consumes: `makeRng` from `./rng`; `addDays`, `enumerateDates`, `weekdayOf` from `../period`; `Facts`, `NightFact`, `BookingFact`, `IsoDate` from `../types`; `resolveNightlyRates`, and the types `Modifier` and `Night`, from `@openbookings/pricing`.
- Produces:
  - `interface DemoRoomType { id: string; name: string; units: number }`
  - `interface DemoRatePlan { id: string; roomId: string; name: string; barEuros: number; modifiers: Modifier[] }`
  - `interface DemoProperty { id: string; name: string; seed: string; roomTypes: DemoRoomType[]; ratePlans: DemoRatePlan[]; openedOn: IsoDate | null; demand: number }`
  - `const DEMO_PROPERTIES: DemoProperty[]`
  - `generateFacts(property: DemoProperty, from: IsoDate, to: IsoDate, today: IsoDate): Facts`

**Note on `resolveNightlyRates`:** its signature is `(nights: Night[], modifiers: Modifier[], options: { baseOccupancy: number; stayLength?: number; today?: string }) => NightlyRate[]`, where `Night` is `{ date, base_price, has_override }`. It returns `price` in **whole euros** and a `trace` of `PriceStep`s, each carrying an optional `modifier_type` and a signed `delta`. That trace is where per-modifier revenue impact comes from — do not recompute it.

- [ ] **Step 1: Write `demo/properties.ts`**

No test of its own; it is data, and Step 3's tests assert the properties it must have.

```ts
// apps/business/lib/analytics/demo/properties.ts
import type { Modifier } from "@openbookings/pricing";
import type { IsoDate } from "../types";

export interface DemoRoomType {
  id: string;
  name: string;
  /** Physical units, mirroring rooms.total_units. */
  units: number;
}

export interface DemoRatePlan {
  id: string;
  roomId: string;
  name: string;
  /** Whole euros, as rate_plans.bar is stored. Converted to cents in generate.ts. */
  barEuros: number;
  modifiers: Modifier[];
}

export interface DemoProperty {
  id: string;
  name: string;
  seed: string;
  roomTypes: DemoRoomType[];
  ratePlans: DemoRatePlan[];
  /** Null means this property has never taken a booking. */
  openedOn: IsoDate | null;
  /** Baseline share of inventory that sells on an ordinary midweek night. */
  demand: number;
}

const weekendUplift: Modifier = {
  type: "day_of_week",
  adjustment_type: "percent",
  adjustment_value: 15,
  trigger_condition: { days: [5, 6] },
  sort_order: 1,
};

const weeklyDiscount: Modifier = {
  type: "length_of_stay",
  adjustment_type: "percent",
  adjustment_value: -10,
  trigger_condition: { min_nights: 7 },
  sort_order: 2,
};

const earlyBird: Modifier = {
  type: "early_bird",
  adjustment_type: "percent",
  adjustment_value: -8,
  trigger_condition: { min_days_ahead: 60 },
  sort_order: 3,
};

const lastMinute: Modifier = {
  type: "last_minute",
  adjustment_type: "percent",
  adjustment_value: -12,
  trigger_condition: { max_days_ahead: 3 },
  sort_order: 4,
};

/**
 * Three properties, chosen so every row of the spec's States table is reachable
 * by selecting one and picking a period — not by a flag that only a developer
 * knows about.
 */
export const DEMO_PROPERTIES: DemoProperty[] = [
  {
    id: "demo-zeeburg",
    name: "Zeeburg Grand",
    seed: "zeeburg-grand",
    openedOn: "2025-03-01",
    demand: 0.62,
    roomTypes: [
      { id: "zb-standard", name: "Standard Double", units: 6 },
      { id: "zb-canal", name: "Canal View Double", units: 4 },
      { id: "zb-suite", name: "Junior Suite", units: 2 },
    ],
    ratePlans: [
      { id: "zb-flex", roomId: "zb-standard", name: "Flexible", barEuros: 139, modifiers: [weekendUplift, lastMinute] },
      { id: "zb-saver", roomId: "zb-canal", name: "Non-refundable Saver", barEuros: 169, modifiers: [weekendUplift, earlyBird, weeklyDiscount] },
      { id: "zb-suite-flex", roomId: "zb-suite", name: "Suite Flexible", barEuros: 265, modifiers: [weekendUplift] },
    ],
  },
  {
    id: "demo-vlierhof",
    name: "De Vlierhof",
    seed: "de-vlierhof",
    openedOn: "2025-06-15",
    // A four-room B&B trading lightly: few enough bookings in a short period to
    // put the histogram, the heatmap and the country list below their threshold.
    demand: 0.28,
    roomTypes: [{ id: "vh-double", name: "Double Room", units: 4 }],
    ratePlans: [
      { id: "vh-bb", roomId: "vh-double", name: "Bed & Breakfast", barEuros: 95, modifiers: [weekendUplift] },
    ],
  },
  {
    id: "demo-nieuwehaven",
    name: "Nieuwehaven Rooms",
    seed: "nieuwehaven",
    openedOn: null,
    demand: 0,
    roomTypes: [{ id: "nh-double", name: "Double Room", units: 3 }],
    ratePlans: [
      { id: "nh-standard", roomId: "nh-double", name: "Standard", barEuros: 110, modifiers: [] },
    ],
  },
];

export function findDemoProperty(id: string | undefined): DemoProperty {
  return DEMO_PROPERTIES.find((p) => p.id === id) ?? DEMO_PROPERTIES[0];
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/business/lib/analytics/demo/generate.test.ts
import { describe, expect, test } from "bun:test";
import { weekdayOf } from "../period";
import { DEMO_PROPERTIES, findDemoProperty } from "./properties";
import { generateFacts } from "./generate";

const TODAY = "2026-09-25";
const ZEEBURG = findDemoProperty("demo-zeeburg");
const VLIERHOF = findDemoProperty("demo-vlierhof");
const NIEUWEHAVEN = findDemoProperty("demo-nieuwehaven");

const YEAR = { from: "2025-09-26", to: "2026-09-25" };

describe("generateFacts", () => {
  test("is deterministic across calls", () => {
    const a = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const b = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    expect(a).toEqual(b);
  });

  test("covers every date in the range, for every rate plan", () => {
    const facts = generateFacts(ZEEBURG, "2026-09-01", "2026-09-30", TODAY);
    expect(facts.nights).toHaveLength(30 * ZEEBURG.ratePlans.length);
    expect(new Set(facts.nights.map((n) => n.date)).size).toBe(30);
  });

  test("every cents field is a whole number", () => {
    const facts = generateFacts(ZEEBURG, "2026-07-01", "2026-07-31", TODAY);
    for (const night of facts.nights) {
      expect(Number.isInteger(night.netRevenueCents)).toBe(true);
      expect(Number.isInteger(night.basePriceCents)).toBe(true);
      for (const m of night.modifiers) expect(Number.isInteger(m.impactCents)).toBe(true);
    }
    for (const booking of facts.bookings) {
      expect(Number.isInteger(booking.netRevenueCents)).toBe(true);
    }
  });

  test("never sells more units than are available", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    for (const night of facts.nights) {
      expect(night.unitsSold).toBeLessThanOrEqual(night.unitsAvailable);
      expect(night.unitsSold).toBeGreaterThanOrEqual(0);
    }
  });

  test("a night with no units sold earns nothing", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    for (const night of facts.nights.filter((n) => n.unitsSold === 0)) {
      expect(night.netRevenueCents).toBe(0);
      expect(night.basePriceCents).toBe(0);
    }
  });

  test("weekends outsell midweek", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const rate = (days: number[]) => {
      const nights = facts.nights.filter((n) => days.includes(weekdayOf(n.date)));
      const sold = nights.reduce((sum, n) => sum + n.unitsSold, 0);
      const available = nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
      return sold / available;
    };
    expect(rate([5, 6])).toBeGreaterThan(rate([1, 2, 3]));
  });

  test("summer outsells winter", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const rate = (months: string[]) => {
      const nights = facts.nights.filter((n) => months.includes(n.date.slice(5, 7)));
      const sold = nights.reduce((sum, n) => sum + n.unitsSold, 0);
      const available = nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
      return sold / available;
    };
    expect(rate(["07", "08"])).toBeGreaterThan(rate(["01", "02"]));
  });

  test("a brand new property has no nights sold and no bookings, ever", () => {
    const facts = generateFacts(NIEUWEHAVEN, YEAR.from, YEAR.to, TODAY);
    expect(facts.bookings).toEqual([]);
    expect(facts.nights.every((n) => n.unitsSold === 0)).toBe(true);
    // Inventory still exists — it is a property with rooms, not a void.
    expect(facts.nights.some((n) => n.unitsAvailable > 0)).toBe(true);
  });

  test("the B&B trades thinly enough to fall under the five-booking threshold", () => {
    const facts = generateFacts(VLIERHOF, "2026-02-01", "2026-02-14", TODAY);
    expect(facts.bookings.length).toBeLessThan(5);
  });

  test("no booking predates the property opening", () => {
    for (const property of DEMO_PROPERTIES.filter((p) => p.openedOn)) {
      const facts = generateFacts(property, "2024-01-01", TODAY, TODAY);
      for (const booking of facts.bookings) {
        expect(booking.checkIn >= property.openedOn!).toBe(true);
      }
    }
  });

  test("bookings are created before they check in", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    for (const booking of facts.bookings) {
      expect(booking.createdAt.slice(0, 10) <= booking.checkIn).toBe(true);
    }
  });

  test("some bookings are cancelled, and a cancelled booking carries a cancelledAt", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const cancelled = facts.bookings.filter((b) => b.status === "cancelled");
    expect(cancelled.length).toBeGreaterThan(0);
    for (const booking of cancelled) expect(booking.cancelledAt).not.toBeNull();
    for (const booking of facts.bookings.filter((b) => b.status !== "cancelled")) {
      expect(booking.cancelledAt).toBeNull();
    }
  });

  test("guests are mostly NL/BE/DE with a long tail, so the Other rule can fire", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const counts = new Map<string, number>();
    for (const b of facts.bookings) counts.set(b.guestCountry, (counts.get(b.guestCountry) ?? 0) + 1);
    const core = ["NL", "BE", "DE"].reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);
    expect(core / facts.bookings.length).toBeGreaterThan(0.5);
    expect([...counts.values()].filter((n) => n < 5).length).toBeGreaterThan(0);
  });

  test("some guests stay more than once, so repeat share is not always zero", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const seen = new Map<string, number>();
    for (const b of facts.bookings) seen.set(b.guestKey, (seen.get(b.guestKey) ?? 0) + 1);
    expect([...seen.values()].some((n) => n > 1)).toBe(true);
  });

  test("names are exposed for room types and rate plans", () => {
    const facts = generateFacts(ZEEBURG, "2026-09-01", "2026-09-30", TODAY);
    expect(facts.roomTypeNames["zb-canal"]).toBe("Canal View Double");
    expect(facts.ratePlanNames["zb-saver"]).toBe("Non-refundable Saver");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test lib/analytics/demo/generate.test.ts`
Expected: FAIL — `Cannot find module './generate'`.

- [ ] **Step 4: Implement `demo/generate.ts`**

```ts
// apps/business/lib/analytics/demo/generate.ts
import {
  resolveNightlyRates,
  type Modifier,
  type Night,
} from "@openbookings/pricing";
import { addDays, enumerateDates, weekdayOf } from "../period";
import type { BookingFact, Facts, IsoDate, NightFact } from "../types";
import { makeRng, type Rng } from "./rng";
import type { DemoProperty, DemoRatePlan } from "./properties";

/**
 * Demand shape. Two effects a host would recognise on their own numbers: the
 * weekend peak, and a summer high season that in the Netherlands runs June to
 * August with a shoulder either side.
 */
const WEEKEND_FACTOR: Record<number, number> = {
  1: 0.82, 2: 0.84, 3: 0.9, 4: 1.0, 5: 1.28, 6: 1.34, 7: 0.92,
};

const SEASON_FACTOR: Record<string, number> = {
  "01": 0.55, "02": 0.6, "03": 0.72, "04": 0.88, "05": 1.0, "06": 1.2,
  "07": 1.38, "08": 1.36, "09": 1.1, "10": 0.9, "11": 0.66, "12": 0.74,
};

/** Countries in the order they are drawn. The tail exists so the <5 fold fires. */
const COUNTRY_WEIGHTS: [string, number][] = [
  ["NL", 38], ["BE", 16], ["DE", 14], ["GB", 8], ["FR", 6], ["US", 4],
  ["IT", 3], ["ES", 3], ["DK", 2], ["SE", 2], ["PL", 1], ["IE", 1],
  ["JP", 1], ["CA", 1], ["AT", 1], ["PT", 1], ["NO", 1], ["CH", 1],
];

const CANCELLATION_RATE = 0.09;
/** Cents, from whole euros. The one place this conversion happens. */
const toCents = (euros: number): number => Math.round(euros * 100);

function pickCountry(rng: Rng): string {
  const total = COUNTRY_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [code, weight] of COUNTRY_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return code;
  }
  return COUNTRY_WEIGHTS[0][0];
}

/** Share of inventory that sells on this date, before rounding to whole units. */
function demandFor(property: DemoProperty, date: IsoDate, rng: Rng): number {
  const weekend = WEEKEND_FACTOR[weekdayOf(date)] ?? 1;
  const season = SEASON_FACTOR[date.slice(5, 7)] ?? 1;
  const jitter = 0.82 + rng.next() * 0.36;
  return property.demand * weekend * season * jitter;
}

/**
 * Prices come out of the real calculator, not out of this file. A demo revenue
 * figure that did not pass through the modifier pipeline would agree with
 * nothing — not the ARI grid, not a guest quote — and section 4 would be
 * comparing a base price against a number nobody computed.
 */
function priceNights(plan: DemoRatePlan, dates: IsoDate[], today: IsoDate) {
  const nights: Night[] = dates.map((date) => ({
    date,
    base_price: plan.barEuros,
    has_override: false,
  }));
  return resolveNightlyRates(nights, plan.modifiers, { baseOccupancy: 2, today });
}

export function generateFacts(
  property: DemoProperty,
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
): Facts {
  const dates = enumerateDates(from, to);
  const nights: NightFact[] = [];

  for (const plan of property.ratePlans) {
    const roomType = property.roomTypes.find((r) => r.id === plan.roomId);
    if (!roomType) continue;

    // Seeded per plan, so adding a plan cannot shift another plan's history.
    const rng = makeRng(`${property.seed}:${plan.id}`);
    const rates = priceNights(plan, dates, today);

    dates.forEach((date, i) => {
      const rate = rates[i];
      // A few units are held back now and then: maintenance, owner use.
      const blocked = rng.bool(0.04) ? rng.int(1, Math.max(1, Math.floor(roomType.units / 3))) : 0;
      const unitsAvailable = Math.max(0, roomType.units - blocked);

      const open = property.openedOn !== null && date >= property.openedOn;
      const unitsSold = open
        ? Math.min(unitsAvailable, Math.max(0, Math.round(unitsAvailable * demandFor(property, date, rng))))
        : 0;

      // The trace carries one step per modifier that actually fired, with a
      // signed euro delta. Multiplying by unitsSold gives the revenue impact
      // for the night; a modifier that did not fire leaves no step and so
      // contributes nothing, which is the behaviour section 4 reports.
      const modifiers = rate.trace
        .filter((step) => step.modifier_type !== undefined)
        .map((step) => ({
          type: step.modifier_type!,
          impactCents: toCents(step.delta * unitsSold),
        }));

      nights.push({
        date,
        propertyId: property.id,
        roomId: roomType.id,
        ratePlanId: plan.id,
        unitsAvailable,
        unitsSold,
        netRevenueCents: toCents(rate.price * unitsSold),
        basePriceCents: toCents(plan.barEuros * unitsSold),
        modifiers,
      });
    });
  }

  nights.sort((a, b) => a.date.localeCompare(b.date) || a.ratePlanId.localeCompare(b.ratePlanId));

  return {
    nights,
    bookings: generateBookings(property, nights, today),
    roomTypeNames: Object.fromEntries(property.roomTypes.map((r) => [r.id, r.name])),
    ratePlanNames: Object.fromEntries(property.ratePlans.map((p) => [p.id, p.name])),
  };
}

/**
 * Bookings are assembled from the nights that sold rather than invented beside
 * them, so the two arrays describe the same trading. A booking is a run of
 * consecutive sold nights on one plan; its revenue is the sum of those nights'
 * per-unit revenue.
 */
function generateBookings(
  property: DemoProperty,
  nights: NightFact[],
  today: IsoDate,
): BookingFact[] {
  if (property.openedOn === null) return [];

  const rng = makeRng(`${property.seed}:bookings`);
  const bookings: BookingFact[] = [];
  // A small pool, so some guests recur and "repeat guests" is not always zero.
  const guestPool = Array.from({ length: 140 }, (_, i) => `guest-${property.id}-${i}`);

  const byPlan = new Map<string, NightFact[]>();
  for (const night of nights) {
    if (night.unitsSold === 0) continue;
    const list = byPlan.get(night.ratePlanId) ?? [];
    list.push(night);
    byPlan.set(night.ratePlanId, list);
  }

  for (const [planId, planNights] of byPlan) {
    let cursor = 0;
    while (cursor < planNights.length) {
      const stay = rng.int(1, 5);
      const window = planNights.slice(cursor, cursor + stay);
      cursor += window.length;
      if (window.length === 0) break;

      const checkIn = window[0].date;
      const checkOut = addDays(window[window.length - 1].date, 1);
      const leadDays = rng.int(0, 120);
      const createdAt = `${addDays(checkIn, -leadDays)}T${String(rng.int(8, 21)).padStart(2, "0")}:00:00.000Z`;
      const cancelled = rng.bool(CANCELLATION_RATE);

      // Per-unit revenue: the night's revenue divided by the units that sold.
      const netRevenueCents = window.reduce(
        (sum, n) => sum + Math.round(n.netRevenueCents / Math.max(1, n.unitsSold)),
        0,
      );

      bookings.push({
        id: `bk-${property.id}-${planId}-${checkIn}`,
        propertyId: property.id,
        createdAt,
        checkIn,
        checkOut,
        nights: window.length,
        status: cancelled ? "cancelled" : checkOut <= today ? "completed" : "confirmed",
        cancelledAt: cancelled ? `${addDays(checkIn, -rng.int(1, Math.max(1, leadDays)))}T12:00:00.000Z` : null,
        adults: rng.int(1, 2),
        children: rng.bool(0.22) ? rng.int(1, 2) : 0,
        guestKey: rng.pick(guestPool),
        guestCountry: pickCountry(rng),
        netRevenueCents,
        roomId: window[0].roomId,
        ratePlanId: planId,
      });
    }
  }

  return bookings.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test lib/analytics/demo/generate.test.ts`
Expected: PASS, 15 tests.

If "the B&B trades thinly enough" fails, lower `DEMO_PROPERTIES[1].demand` rather than changing the assertion — the threshold is the point of that property. If "weekends outsell midweek" fails, the jitter band in `demandFor` is too wide relative to `WEEKEND_FACTOR`; narrow the jitter, do not widen the factor, or the weekend will start pinning to full.

- [ ] **Step 6: Commit**

```bash
git add apps/business/lib/analytics/demo
git commit -m "$(cat <<'MSG'
Generate demo facts through the real pricing calculator

Prices are not written into this file. The rate plans carry real
modifiers and the generator runs them through resolveNightlyRates, the
same function the ARI grid and a guest quote use, so a demo revenue
figure agrees with something. Section 4 reads per-modifier impact out of
the calculator's own trace rather than recomputing it.

Bookings are assembled from the nights that sold rather than invented
beside them, so the two fact arrays describe one property's trading and
cannot drift apart.

Euros become cents here and nowhere else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 6: Bucketing

**Files:**
- Create: `apps/business/lib/analytics/derive/buckets.ts`
- Test: `apps/business/lib/analytics/derive/buckets.test.ts`

**Interfaces:**
- Consumes: `addDays`, `startOfMonth`, `startOfWeek` from `../period`; `Granularity`, `IsoDate`, `Point` from `../types`.
- Produces:
  - `bucketKey(date: IsoDate, granularity: Granularity): IsoDate`
  - `bucketLabel(bucket: IsoDate, granularity: Granularity): string`
  - `emptyBuckets(from: IsoDate, to: IsoDate, granularity: Granularity): IsoDate[]`
  - `toSeries<T>(rows: T[], opts: { date: (row: T) => IsoDate; value: (row: T) => number; from: IsoDate; to: IsoDate; granularity: Granularity; reduce?: "sum" | "mean" }): Point[]`

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/buckets.test.ts
import { describe, expect, test } from "bun:test";
import { bucketKey, bucketLabel, emptyBuckets, toSeries } from "./buckets";

describe("bucketKey", () => {
  test("day is the date, week is its Monday, month is the first", () => {
    expect(bucketKey("2026-09-25", "day")).toBe("2026-09-25");
    expect(bucketKey("2026-09-25", "week")).toBe("2026-09-21");
    expect(bucketKey("2026-09-25", "month")).toBe("2026-09-01");
  });
});

describe("emptyBuckets", () => {
  test("a gap with no trading still gets a bucket", () => {
    // Without this a quiet fortnight would close up and the line would lie
    // about how fast revenue moved.
    expect(emptyBuckets("2026-09-01", "2026-09-05", "day")).toEqual([
      "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
    ]);
  });

  test("weeks start on the Monday on or before the range start", () => {
    expect(emptyBuckets("2026-09-02", "2026-09-20", "week")).toEqual([
      "2026-08-31", "2026-09-07", "2026-09-14",
    ]);
  });

  test("months cover partial months at both ends", () => {
    expect(emptyBuckets("2026-07-15", "2026-09-04", "month")).toEqual([
      "2026-07-01", "2026-08-01", "2026-09-01",
    ]);
  });
});

describe("toSeries", () => {
  const rows = [
    { date: "2026-09-21", value: 100 },
    { date: "2026-09-22", value: 50 },
    { date: "2026-09-28", value: 30 },
  ];
  const opts = {
    date: (r: (typeof rows)[number]) => r.date,
    value: (r: (typeof rows)[number]) => r.value,
    from: "2026-09-21",
    to: "2026-09-30",
  } as const;

  test("sums into weekly buckets", () => {
    expect(toSeries(rows, { ...opts, granularity: "week" })).toEqual([
      { bucket: "2026-09-21", label: "21 Sep", value: 150 },
      { bucket: "2026-09-28", label: "28 Sep", value: 30 },
    ]);
  });

  test("a day with no rows is present with a zero, not absent", () => {
    const series = toSeries(rows, { ...opts, granularity: "day" });
    expect(series).toHaveLength(10);
    expect(series.find((p) => p.bucket === "2026-09-23")).toEqual({
      bucket: "2026-09-23",
      label: "23 Sep",
      value: 0,
    });
  });

  test("mean divides by the rows present, not by the bucket length", () => {
    expect(
      toSeries(rows, { ...opts, granularity: "week", reduce: "mean" })[0].value,
    ).toBe(75);
  });

  test("an empty bucket under mean is 0, not NaN", () => {
    const series = toSeries([], { ...opts, granularity: "day", reduce: "mean" });
    expect(series.every((p) => Number.isFinite(p.value))).toBe(true);
    expect(series[0].value).toBe(0);
  });
});

describe("bucketLabel", () => {
  test("labels read for their grain", () => {
    expect(bucketLabel("2026-09-25", "day")).toBe("25 Sep");
    expect(bucketLabel("2026-09-21", "week")).toBe("21 Sep");
    expect(bucketLabel("2026-09-01", "month")).toBe("Sep 2026");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/buckets.test.ts`
Expected: FAIL — `Cannot find module './buckets'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/derive/buckets.ts
import { addDays, startOfMonth, startOfWeek } from "../period";
import type { Granularity, IsoDate, Point } from "../types";

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const monthLabel = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function bucketKey(date: IsoDate, granularity: Granularity): IsoDate {
  if (granularity === "day") return date;
  if (granularity === "week") return startOfWeek(date);
  return startOfMonth(date);
}

export function bucketLabel(bucket: IsoDate, granularity: Granularity): string {
  const at = new Date(`${bucket}T00:00:00Z`);
  return granularity === "month" ? monthLabel.format(at) : dayLabel.format(at);
}

/**
 * Every bucket in the range, including the ones nothing happened in. A quiet
 * fortnight that closes up makes the line either side of it look steeper than
 * it was, which is the kind of wrong a host would act on.
 */
export function emptyBuckets(
  from: IsoDate,
  to: IsoDate,
  granularity: Granularity,
): IsoDate[] {
  const buckets: IsoDate[] = [];
  let cursor = bucketKey(from, granularity);
  const last = bucketKey(to, granularity);
  while (cursor <= last) {
    buckets.push(cursor);
    cursor =
      granularity === "day"
        ? addDays(cursor, 1)
        : granularity === "week"
          ? addDays(cursor, 7)
          : startOfMonth(addDays(`${cursor.slice(0, 7)}-28`, 7));
  }
  return buckets;
}

export function toSeries<T>(
  rows: T[],
  opts: {
    date: (row: T) => IsoDate;
    value: (row: T) => number;
    from: IsoDate;
    to: IsoDate;
    granularity: Granularity;
    reduce?: "sum" | "mean";
  },
): Point[] {
  const totals = new Map<IsoDate, { sum: number; count: number }>();
  for (const row of rows) {
    const key = bucketKey(opts.date(row), opts.granularity);
    const entry = totals.get(key) ?? { sum: 0, count: 0 };
    entry.sum += opts.value(row);
    entry.count += 1;
    totals.set(key, entry);
  }

  return emptyBuckets(opts.from, opts.to, opts.granularity).map((bucket) => {
    const entry = totals.get(bucket);
    const value =
      opts.reduce === "mean"
        ? entry && entry.count > 0
          ? entry.sum / entry.count
          : 0
        : (entry?.sum ?? 0);
    return { bucket, label: bucketLabel(bucket, opts.granularity), value };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/buckets.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/derive/buckets.ts apps/business/lib/analytics/derive/buckets.test.ts
git commit -m "$(cat <<'MSG'
Keep empty buckets in the series

A fortnight nobody booked has to appear as a fortnight nobody booked. If
the gap closes up, the line either side of it looks steeper than trading
actually was, and that is the kind of wrong a host changes their prices
over.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 7: Deltas

**Files:**
- Create: `apps/business/lib/analytics/derive/delta.ts`
- Test: `apps/business/lib/analytics/derive/delta.test.ts`

**Interfaces:**
- Consumes: `Delta` from `../types`.
- Produces: `makeDelta(current: number | null, previous: number | null, goodDirection?: "up" | "down"): Delta`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/delta.test.ts
import { describe, expect, test } from "bun:test";
import { makeDelta } from "./delta";

/**
 * The label matters as much as the number. The spec forbids relying on colour
 * alone, so every delta carries text a screen reader can read out and a
 * colourblind host can see.
 */
describe("makeDelta", () => {
  test("a rise reads up, with a rounded percentage", () => {
    expect(makeDelta(112, 100)).toEqual({
      pct: 12,
      direction: "up",
      label: "up 12%",
      goodDirection: "up",
    });
  });

  test("a fall reads down, with the magnitude, not the sign", () => {
    expect(makeDelta(80, 100)).toMatchObject({ pct: -20, direction: "down", label: "down 20%" });
  });

  test("no change reads flat", () => {
    expect(makeDelta(100, 100)).toMatchObject({ direction: "flat", label: "no change" });
  });

  test("no comparison data renders an em dash, not a zero", () => {
    // Zero would say "trading was identical last period", which is a different
    // claim from "we have nothing to compare against".
    expect(makeDelta(100, null)).toEqual({
      pct: null,
      direction: "flat",
      label: "—",
      goodDirection: "up",
    });
    expect(makeDelta(null, 100)).toMatchObject({ pct: null, label: "—" });
  });

  test("a previous period of zero has no percentage to give", () => {
    expect(makeDelta(500, 0)).toMatchObject({ pct: null, label: "—" });
  });

  test("goodDirection travels with the delta for the inverted widgets", () => {
    expect(makeDelta(12, 8, "down")).toMatchObject({
      direction: "up",
      label: "up 50%",
      goodDirection: "down",
    });
  });

  test("percentages round to one decimal below 10 and none above", () => {
    expect(makeDelta(103.7, 100).label).toBe("up 3.7%");
    expect(makeDelta(147.4, 100).label).toBe("up 47%");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/delta.test.ts`
Expected: FAIL — `Cannot find module './delta'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/derive/delta.ts
import type { Delta } from "../types";

const NO_COMPARISON: Omit<Delta, "goodDirection"> = {
  pct: null,
  direction: "flat",
  label: "—",
};

/**
 * `goodDirection` travels with the delta rather than being decided at render,
 * so Cancellations and Average discount cannot be coloured green for rising by
 * a component that forgot they are the two that invert.
 */
export function makeDelta(
  current: number | null,
  previous: number | null,
  goodDirection: "up" | "down" = "up",
): Delta {
  if (current === null || previous === null || previous === 0) {
    return { ...NO_COMPARISON, goodDirection };
  }

  const pctRaw = ((current - previous) / Math.abs(previous)) * 100;
  const magnitude = Math.abs(pctRaw);
  const rounded = magnitude < 10 ? Math.round(pctRaw * 10) / 10 : Math.round(pctRaw);
  const shown = Math.abs(rounded);

  if (rounded === 0) {
    return { pct: 0, direction: "flat", label: "no change", goodDirection };
  }

  const direction = rounded > 0 ? "up" : "down";
  return { pct: rounded, direction, label: `${direction} ${shown}%`, goodDirection };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/delta.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/derive/delta.ts apps/business/lib/analytics/derive/delta.test.ts
git commit -m "$(cat <<'MSG'
Say which way is good on the delta itself

Cancellations and average discount are the two figures where rising is
bad. Deciding that at render is how one of them eventually gets coloured
green by a component that did not know. Every delta also carries its own
text, because the arrow and the colour are not enough on their own.

A missing comparison reads as an em dash. Zero would claim trading was
identical last period, which is a different thing from having nothing to
compare against.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 8: Revenue (section 1)

**Files:**
- Create: `apps/business/lib/analytics/derive/totals.ts`
- Create: `apps/business/lib/analytics/derive/revenue.ts`
- Test: `apps/business/lib/analytics/derive/revenue.test.ts`

**Interfaces:**
- Consumes: `widget` from `./widget`; `toSeries` from `./buckets`; `makeDelta` from `./delta`; `comparisonRange`, `granularityFor`, `type Period` from `../period`; `Facts`, `NightFact`, `RevenueSection`, `IsoDate` from `../types`.
- Produces, from `totals.ts` (Task 9 and Task 11 consume these — same names, same units):
  - `const COMMISSION_RATE = 0.045`
  - `inRange(nights: NightFact[], from: IsoDate, to: IsoDate): NightFact[]`
  - `sumRevenueCents(nights: NightFact[]): number`
  - `sumNightsSold(nights: NightFact[]): number`
  - `sumNightsAvailable(nights: NightFact[]): number`
  - `ratio(numerator: number, denominator: number): number | null` — null when the denominator is zero, so no division reaches a widget as `NaN` or `Infinity`.
  - `rank(groups: Map<string, number>, names: Record<string, string>): Category[]` — sorted descending.
- Produces, from `revenue.ts`: `deriveRevenue(facts: Facts, period: Period, today: IsoDate): RevenueSection`.

**Facts must already span the comparison range.** `deriveRevenue` filters rather than fetches; Task 13 is responsible for generating over the wider window.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/revenue.test.ts
import { describe, expect, test } from "bun:test";
import type { Facts, NightFact } from "../types";
import { COMMISSION_RATE, ratio } from "./totals";
import { deriveRevenue } from "./revenue";

const night = (over: Partial<NightFact>): NightFact => ({
  date: "2026-09-10",
  propertyId: "p1",
  roomId: "standard",
  ratePlanId: "flex",
  unitsAvailable: 10,
  unitsSold: 5,
  netRevenueCents: 50_000,
  basePriceCents: 55_000,
  modifiers: [],
  ...over,
});

const facts = (nights: NightFact[]): Facts => ({
  nights,
  bookings: [],
  roomTypeNames: { standard: "Standard Double", suite: "Junior Suite" },
  ratePlanNames: { flex: "Flexible", saver: "Saver" },
});

const SEPT = { preset: "custom", from: "2026-09-01", to: "2026-09-30" } as const;
const TODAY = "2026-09-30";

const value = <T,>(w: { ok: boolean } & Record<string, unknown>): T => {
  expect(w.ok).toBe(true);
  return (w as { value: T }).value;
};

describe("ratio", () => {
  test("a zero denominator yields null, never Infinity or NaN", () => {
    expect(ratio(100, 0)).toBeNull();
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(100, 4)).toBe(25);
  });
});

describe("deriveRevenue", () => {
  test("period revenue sums only nights inside the range", () => {
    const section = deriveRevenue(
      facts([
        night({ date: "2026-08-31", netRevenueCents: 99_999 }),
        night({ date: "2026-09-01", netRevenueCents: 10_000 }),
        night({ date: "2026-09-30", netRevenueCents: 20_000 }),
        night({ date: "2026-10-01", netRevenueCents: 99_999 }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number }>(section.periodCents).value).toBe(30_000);
  });

  test("ADR is revenue over nights sold, and reconciles back", () => {
    const section = deriveRevenue(
      facts([
        night({ date: "2026-09-02", unitsSold: 4, netRevenueCents: 40_000 }),
        night({ date: "2026-09-03", unitsSold: 6, netRevenueCents: 80_000 }),
      ]),
      SEPT,
      TODAY,
    );
    const adr = value<{ value: number }>(section.adrCents).value;
    expect(adr).toBe(12_000);
    expect(adr * 10).toBe(value<{ value: number }>(section.periodCents).value);
  });

  test("RevPAR is revenue over nights available", () => {
    const section = deriveRevenue(
      facts([night({ date: "2026-09-02", unitsAvailable: 10, netRevenueCents: 50_000 })]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number }>(section.revparCents).value).toBe(5_000);
  });

  /**
   * Review Focus 4. A host looking at next month sees positive inventory and no
   * sales. Three divisions that look alike must give three different answers:
   * sell-through 0, RevPAR €0, and ADR nothing at all — there were no nights
   * sold to average over, and reporting €0 would claim they sold rooms for free.
   */
  test("a period entirely in the future gives RevPAR zero and ADR null", () => {
    const section = deriveRevenue(
      facts([
        night({ date: "2026-09-10", unitsSold: 0, unitsAvailable: 10, netRevenueCents: 0, basePriceCents: 0 }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number | null }>(section.revparCents).value).toBe(0);
    expect(value<{ value: number | null }>(section.adrCents).value).toBeNull();
  });

  test("commission rounds once over the period total, not per night", () => {
    // 3 x 33333c at 4.5% is 1499.985c per night. Rounding per night gives 4500;
    // rounding the total gives 4500 too — so use a total where they part:
    // 7 x 14_285c = 100_000c -> 4500 exactly, per-night 642.825 -> 643 x 7 = 4501.
    const nights = Array.from({ length: 7 }, (_, i) =>
      night({ date: `2026-09-0${i + 1}`, netRevenueCents: 14_285, unitsSold: 1, unitsAvailable: 1 }),
    );
    const section = deriveRevenue(facts(nights), SEPT, TODAY);
    const revenue = value<{ value: number }>(section.periodCents).value;
    expect(value<number>(section.commissionCents)).toBe(Math.round(revenue * COMMISSION_RATE));
    expect(value<number>(section.commissionCents)).not.toBe(7 * Math.round(14_285 * COMMISSION_RATE));
  });

  test("year to date ignores the period selector and starts 1 January", () => {
    const section = deriveRevenue(
      facts([
        night({ date: "2025-12-31", netRevenueCents: 90_000 }),
        night({ date: "2026-01-02", netRevenueCents: 10_000 }),
        night({ date: "2026-09-10", netRevenueCents: 20_000 }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number }>(section.yearToDateCents).value).toBe(30_000);
  });

  test("year to date compares against the same span last year", () => {
    const section = deriveRevenue(
      facts([
        night({ date: "2025-03-01", netRevenueCents: 50_000 }),
        night({ date: "2026-03-01", netRevenueCents: 100_000 }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ delta: { label: string } }>(section.yearToDateCents).delta.label).toBe("up 100%");
  });

  test("revenue by room type is grouped, named and sorted descending", () => {
    const section = deriveRevenue(
      facts([
        night({ date: "2026-09-02", roomId: "standard", netRevenueCents: 10_000 }),
        night({ date: "2026-09-03", roomId: "suite", netRevenueCents: 70_000 }),
        night({ date: "2026-09-04", roomId: "standard", netRevenueCents: 15_000 }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ label: string; value: number }[]>(section.byRoomType)).toEqual([
      { key: "suite", label: "Junior Suite", value: 70_000 },
      { key: "standard", label: "Standard Double", value: 25_000 },
    ]);
  });

  test("revenue by rate plan is grouped, named and sorted descending", () => {
    const section = deriveRevenue(
      facts([
        night({ date: "2026-09-02", ratePlanId: "flex", netRevenueCents: 10_000 }),
        night({ date: "2026-09-03", ratePlanId: "saver", netRevenueCents: 40_000 }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ label: string }[]>(section.byRatePlan)[0].label).toBe("Saver");
  });

  test("revenue over time buckets by the period's own granularity", () => {
    const section = deriveRevenue(
      facts([night({ date: "2026-09-02", netRevenueCents: 10_000 })]),
      SEPT,
      TODAY,
    );
    // 30 days is daily grain, so there is one point per day in September.
    expect(value<unknown[]>(section.overTime)).toHaveLength(30);
  });

  test("an empty period gives zeroes and nulls, not a failed widget", () => {
    const section = deriveRevenue(facts([]), SEPT, TODAY);
    expect(value<{ value: number }>(section.periodCents).value).toBe(0);
    expect(value<{ value: number | null }>(section.adrCents).value).toBeNull();
    expect(value<number>(section.commissionCents)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/revenue.test.ts`
Expected: FAIL — `Cannot find module './totals'`.

- [ ] **Step 3: Implement `derive/totals.ts`**

```ts
// apps/business/lib/analytics/derive/totals.ts
import type { Category, IsoDate, NightFact } from "../types";

/** OpenBookings' cut of net room revenue. */
export const COMMISSION_RATE = 0.045;

export function inRange(nights: NightFact[], from: IsoDate, to: IsoDate): NightFact[] {
  return nights.filter((n) => n.date >= from && n.date <= to);
}

export function sumRevenueCents(nights: NightFact[]): number {
  return nights.reduce((sum, n) => sum + n.netRevenueCents, 0);
}

export function sumNightsSold(nights: NightFact[]): number {
  return nights.reduce((sum, n) => sum + n.unitsSold, 0);
}

export function sumNightsAvailable(nights: NightFact[]): number {
  return nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
}

/**
 * The only division in this module. Nothing here may produce NaN or Infinity:
 * a host reading "€NaN" learns nothing, and a host reading "—" learns that the
 * question had no answer this period, which is true and useful.
 */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function rank(
  groups: Map<string, number>,
  names: Record<string, string>,
): Category[] {
  return [...groups.entries()]
    .map(([key, value]) => ({ key, label: names[key] ?? key, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function groupSum<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const groups = new Map<string, number>();
  for (const row of rows) groups.set(key(row), (groups.get(key(row)) ?? 0) + value(row));
  return groups;
}
```

- [ ] **Step 4: Implement `derive/revenue.ts`**

```ts
// apps/business/lib/analytics/derive/revenue.ts
import { comparisonRange, granularityFor, type Period } from "../period";
import type { Facts, IsoDate, RevenueSection } from "../types";
import { toSeries } from "./buckets";
import { makeDelta } from "./delta";
import {
  COMMISSION_RATE,
  groupSum,
  inRange,
  rank,
  ratio,
  sumNightsAvailable,
  sumNightsSold,
  sumRevenueCents,
} from "./totals";
import { widget } from "./widget";

export function deriveRevenue(
  facts: Facts,
  period: Period,
  today: IsoDate,
): RevenueSection {
  const granularity = granularityFor(period);
  const current = inRange(facts.nights, period.from, period.to);
  const comparison = comparisonRange(period);
  const previous = comparison ? inRange(facts.nights, comparison.from, comparison.to) : [];

  const revenueCents = sumRevenueCents(current);
  const sold = sumNightsSold(current);
  const available = sumNightsAvailable(current);

  // Year to date ignores the selector by design: it is the one figure a host
  // reads without first checking which period is on screen.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const ytdCents = sumRevenueCents(inRange(facts.nights, yearStart, today));
  const lastYearCents = sumRevenueCents(
    inRange(
      facts.nights,
      `${Number(today.slice(0, 4)) - 1}-01-01`,
      `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`,
    ),
  );

  return {
    yearToDateCents: widget(() => ({
      value: ytdCents,
      delta: makeDelta(ytdCents, lastYearCents === 0 ? null : lastYearCents),
    })),
    periodCents: widget(() => ({
      value: revenueCents,
      delta: makeDelta(revenueCents, comparison ? sumRevenueCents(previous) : null),
    })),
    // ADR over nights SOLD; RevPAR over nights AVAILABLE. When nothing sold,
    // ADR has no answer — reporting €0 would say rooms went for nothing —
    // while RevPAR legitimately is €0, because the rooms were there and earned.
    adrCents: widget(() => ({
      value: ratio(revenueCents, sold),
      spark: toSeries(current, {
        date: (n) => n.date,
        value: (n) => n.netRevenueCents,
        from: period.from,
        to: period.to,
        granularity,
      }),
    })),
    revparCents: widget(() => ({
      value: ratio(revenueCents, available),
      spark: toSeries(current, {
        date: (n) => n.date,
        value: (n) => n.netRevenueCents,
        from: period.from,
        to: period.to,
        granularity,
      }),
    })),
    overTime: widget(() =>
      toSeries(current, {
        date: (n) => n.date,
        value: (n) => n.netRevenueCents,
        from: period.from,
        to: period.to,
        granularity,
      }),
    ),
    byRoomType: widget(() =>
      rank(groupSum(current, (n) => n.roomId, (n) => n.netRevenueCents), facts.roomTypeNames),
    ),
    byRatePlan: widget(() =>
      rank(groupSum(current, (n) => n.ratePlanId, (n) => n.netRevenueCents), facts.ratePlanNames),
    ),
    // Rounded once, over the total. Rounding per night drifts by up to a cent a
    // night, which on four thousand room-nights visibly disagrees with 4.5% of
    // the revenue figure printed directly above it.
    commissionCents: widget(() => Math.round(revenueCents * COMMISSION_RATE)),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/revenue.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/business/lib/analytics/derive/totals.ts apps/business/lib/analytics/derive/revenue.ts apps/business/lib/analytics/derive/revenue.test.ts
git commit -m "$(cat <<'MSG'
Derive revenue so its four figures agree with each other

ADR is revenue over nights sold and RevPAR is revenue over nights
available, so multiplying either back gives the revenue shown beside it.
Commission rounds once over the period total; rounding per night drifts
by up to a cent a night and visibly disagrees with 4.5% of the figure
directly above it.

Every division goes through ratio(), which answers null rather than
Infinity. A month with inventory and no sales has RevPAR of zero and no
ADR at all — reporting zero there would claim the rooms went for nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 9: Sell-through and the heatmap (section 2)

**Files:**
- Create: `apps/business/lib/analytics/derive/sell-through.ts`
- Test: `apps/business/lib/analytics/derive/sell-through.test.ts`

**Interfaces:**
- Consumes: `totals.ts` (`inRange`, `ratio`, `sumNightsSold`, `sumNightsAvailable`), `buckets.ts` (`emptyBuckets`, `toSeries`), `delta.ts`, `widget.ts`; `addDays`, `comparisonRange`, `granularityFor`, `type Period` from `../period`.
- Produces: `deriveSellThrough(facts: Facts, period: Period): SellThroughSection`, and `buildHeatmap(nights: NightFact[], period: Period): Heatmap` exported for the heatmap's own tests.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/sell-through.test.ts
import { describe, expect, test } from "bun:test";
import type { Facts, Heatmap, NightFact } from "../types";
import { buildHeatmap, deriveSellThrough } from "./sell-through";

const night = (over: Partial<NightFact>): NightFact => ({
  date: "2026-09-10", propertyId: "p1", roomId: "standard", ratePlanId: "flex",
  unitsAvailable: 10, unitsSold: 5, netRevenueCents: 50_000,
  basePriceCents: 55_000, modifiers: [], ...over,
});

const facts = (nights: NightFact[]): Facts => ({
  nights, bookings: [],
  roomTypeNames: { standard: "Standard Double", suite: "Junior Suite" },
  ratePlanNames: { flex: "Flexible" },
});

const SEPT = { preset: "custom", from: "2026-09-01", to: "2026-09-30" } as const;

const value = <T,>(w: { ok: boolean } & Record<string, unknown>): T => {
  expect(w.ok).toBe(true);
  return (w as { value: T }).value;
};

describe("deriveSellThrough", () => {
  test("is nights sold over nights available, as a percentage", () => {
    const section = deriveSellThrough(
      facts([
        night({ date: "2026-09-02", unitsSold: 3, unitsAvailable: 10 }),
        night({ date: "2026-09-03", unitsSold: 7, unitsAvailable: 10 }),
      ]),
      SEPT,
    );
    expect(value<{ value: number }>(section.pct).value).toBe(50);
    expect(value<number>(section.roomsSold)).toBe(10);
  });

  /**
   * Review Focus 1. A property closed for the whole period — refurbishment, or
   * a custom range before it opened — has no denominator. The answer is "we
   * cannot say", not zero: zero would tell a host their rooms went unsold when
   * in fact they were never on sale.
   */
  test("a period with no inventory at all has no percentage, rather than zero", () => {
    const section = deriveSellThrough(
      facts([night({ date: "2026-09-05", unitsSold: 0, unitsAvailable: 0 })]),
      SEPT,
    );
    expect(value<{ value: number | null }>(section.pct).value).toBeNull();
    expect(value<number>(section.roomsSold)).toBe(0);
  });

  test("inventory that exists but does not sell is zero, not null", () => {
    const section = deriveSellThrough(
      facts([night({ date: "2026-09-05", unitsSold: 0, unitsAvailable: 8 })]),
      SEPT,
    );
    expect(value<{ value: number | null }>(section.pct).value).toBe(0);
  });

  test("by room type divides each type by its own inventory", () => {
    const section = deriveSellThrough(
      facts([
        night({ date: "2026-09-02", roomId: "standard", unitsSold: 6, unitsAvailable: 10 }),
        night({ date: "2026-09-02", roomId: "suite", unitsSold: 1, unitsAvailable: 2 }),
      ]),
      SEPT,
    );
    const rows = value<{ key: string; value: number }[]>(section.byRoomType);
    expect(rows).toEqual([
      { key: "standard", label: "Standard Double", value: 60 },
      { key: "suite", label: "Junior Suite", value: 50 },
    ]);
  });

  test("over time uses the period's granularity and keeps empty buckets", () => {
    const section = deriveSellThrough(facts([night({ date: "2026-09-02" })]), SEPT);
    expect(value<unknown[]>(section.overTime)).toHaveLength(30);
  });
});

describe("buildHeatmap", () => {
  test("has one column per week and seven rows per column", () => {
    const map = buildHeatmap([night({ date: "2026-09-02" })], SEPT);
    // 1 Sept 2026 is a Tuesday, so the range touches five Monday-started weeks.
    expect(map.weeks.map((w) => w.start)).toEqual([
      "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28",
    ]);
    expect(map.cells).toHaveLength(map.weeks.length * 7);
  });

  test("a cell is that weekday's sell-through in that week", () => {
    const map = buildHeatmap(
      [
        night({ date: "2026-09-05", unitsSold: 9, unitsAvailable: 10 }), // Saturday
        night({ date: "2026-09-08", unitsSold: 2, unitsAvailable: 10 }), // Tuesday
      ],
      SEPT,
    );
    const cell = (weekStart: string, weekday: number) =>
      map.cells.find((c) => c.weekStart === weekStart && c.weekday === weekday)!;
    expect(cell("2026-08-31", 6).pct).toBe(90);
    expect(cell("2026-09-07", 2).pct).toBe(20);
  });

  test("a date outside the range has no inventory and so no percentage", () => {
    const map = buildHeatmap([night({ date: "2026-09-02" })], SEPT);
    // 31 August falls in the first column but before the period starts.
    const cell = map.cells.find((c) => c.weekStart === "2026-08-31" && c.weekday === 1)!;
    expect(cell.pct).toBeNull();
    expect(cell.nightsAvailable).toBe(0);
  });

  test("cells carry their raw counts so a tooltip can show the working", () => {
    const map = buildHeatmap(
      [
        night({ date: "2026-09-05", roomId: "a", unitsSold: 4, unitsAvailable: 5 }),
        night({ date: "2026-09-05", roomId: "b", unitsSold: 1, unitsAvailable: 5 }),
      ],
      SEPT,
    );
    const cell = map.cells.find((c) => c.weekStart === "2026-08-31" && c.weekday === 6)!;
    expect(cell).toMatchObject({ nightsSold: 5, nightsAvailable: 10, pct: 50 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/sell-through.test.ts`
Expected: FAIL — `Cannot find module './sell-through'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/derive/sell-through.ts
import { addDays, comparisonRange, granularityFor, type Period } from "../period";
import type { Facts, Heatmap, HeatCell, NightFact, SellThroughSection } from "../types";
import { emptyBuckets, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { inRange, ratio, sumNightsAvailable, sumNightsSold } from "./totals";
import { widget } from "./widget";

/** Sell-through as a percentage, or null when there was no inventory to sell. */
function pctOf(nights: NightFact[]): number | null {
  const r = ratio(sumNightsSold(nights), sumNightsAvailable(nights));
  return r === null ? null : r * 100;
}

/**
 * Rows Mon–Sun, one column per week the period touches. A cell with no
 * inventory behind it reports null rather than zero — the difference between
 * "nothing sold" and "nothing was on sale" is the whole value of the widget to
 * a host deciding whether to open more rooms.
 */
export function buildHeatmap(nights: NightFact[], period: Period): Heatmap {
  const scoped = inRange(nights, period.from, period.to);
  const byDate = new Map<string, { sold: number; available: number }>();
  for (const night of scoped) {
    const entry = byDate.get(night.date) ?? { sold: 0, available: 0 };
    entry.sold += night.unitsSold;
    entry.available += night.unitsAvailable;
    byDate.set(night.date, entry);
  }

  const weeks = emptyBuckets(period.from, period.to, "week").map((start) => ({
    start,
    label: weekLabel(start),
  }));

  const cells: HeatCell[] = [];
  for (const week of weeks) {
    for (let weekday = 1; weekday <= 7; weekday++) {
      const date = addDays(week.start, weekday - 1);
      const entry = byDate.get(date) ?? { sold: 0, available: 0 };
      const r = ratio(entry.sold, entry.available);
      cells.push({
        weekStart: week.start,
        weekday,
        pct: r === null ? null : r * 100,
        nightsSold: entry.sold,
        nightsAvailable: entry.available,
      });
    }
  }

  return { weeks, cells };
}

const weekFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function weekLabel(start: string): string {
  return weekFormatter.format(new Date(`${start}T00:00:00Z`));
}

export function deriveSellThrough(facts: Facts, period: Period): SellThroughSection {
  const granularity = granularityFor(period);
  const current = inRange(facts.nights, period.from, period.to);
  const comparison = comparisonRange(period);
  const previous = comparison ? inRange(facts.nights, comparison.from, comparison.to) : [];

  const byRoom = new Map<string, { sold: number; available: number }>();
  for (const night of current) {
    const entry = byRoom.get(night.roomId) ?? { sold: 0, available: 0 };
    entry.sold += night.unitsSold;
    entry.available += night.unitsAvailable;
    byRoom.set(night.roomId, entry);
  }

  return {
    pct: widget(() => ({
      value: pctOf(current),
      delta: makeDelta(pctOf(current), comparison ? pctOf(previous) : null),
    })),
    roomsSold: widget(() => sumNightsSold(current)),
    overTime: widget(() => {
      // Bucketed as sold-over-available per bucket, not as a mean of nightly
      // percentages: a night with two rooms open must not weigh as much as a
      // night with twelve.
      const sold = toSeries(current, {
        date: (n) => n.date, value: (n) => n.unitsSold,
        from: period.from, to: period.to, granularity,
      });
      const available = toSeries(current, {
        date: (n) => n.date, value: (n) => n.unitsAvailable,
        from: period.from, to: period.to, granularity,
      });
      return sold.map((point, i) => {
        const r = ratio(point.value, available[i].value);
        return { ...point, value: r === null ? 0 : r * 100 };
      });
    }),
    byRoomType: widget(() =>
      [...byRoom.entries()]
        .map(([key, { sold, available }]) => {
          const r = ratio(sold, available);
          return {
            key,
            label: facts.roomTypeNames[key] ?? key,
            value: r === null ? 0 : r * 100,
          };
        })
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    ),
    busiestDays: widget(() => buildHeatmap(facts.nights, period)),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/sell-through.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/derive/sell-through.ts apps/business/lib/analytics/derive/sell-through.test.ts
git commit -m "$(cat <<'MSG'
Tell apart nothing sold from nothing on sale

Sell-through over an empty denominator answers null, not zero. A host
reading zero concludes their rooms went unsold; the truth is the rooms
were never open, and that changes what they do next. The heatmap carries
the same distinction per cell, and keeps its raw counts so a tooltip can
show the working.

Bucketed sell-through divides each bucket's sold by its available rather
than averaging nightly percentages, so a night with two rooms open does
not weigh as much as a night with twelve.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 10: Bookings (section 3)

**Files:**
- Create: `apps/business/lib/analytics/derive/bookings.ts`
- Test: `apps/business/lib/analytics/derive/bookings.test.ts`

**Interfaces:**
- Consumes: `widget.ts`, `delta.ts`, `totals.ts` (`inRange`, `ratio`); `addDays`, `comparisonRange`, `daysBetween`, `type Period` from `../period`.
- Produces: `deriveBookings(facts: Facts, period: Period, today: IsoDate): BookingsSection`, and `const LEAD_TIME_BUCKETS: { key: string; label: string; max: number }[]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/bookings.test.ts
import { describe, expect, test } from "bun:test";
import type { BookingFact, Facts, NightFact, UpcomingWindow } from "../types";
import { deriveBookings } from "./bookings";

const booking = (over: Partial<BookingFact>): BookingFact => ({
  id: "b1", propertyId: "p1", createdAt: "2026-09-10T12:00:00.000Z",
  checkIn: "2026-09-20", checkOut: "2026-09-22", nights: 2,
  status: "confirmed", cancelledAt: null, adults: 2, children: 0,
  guestKey: "g1", guestCountry: "NL", netRevenueCents: 30_000,
  roomId: "standard", ratePlanId: "flex", ...over,
});

const night = (over: Partial<NightFact>): NightFact => ({
  date: "2026-09-10", propertyId: "p1", roomId: "standard", ratePlanId: "flex",
  unitsAvailable: 10, unitsSold: 5, netRevenueCents: 50_000,
  basePriceCents: 55_000, modifiers: [], ...over,
});

const facts = (bookings: BookingFact[], nights: NightFact[] = []): Facts => ({
  nights, bookings, roomTypeNames: {}, ratePlanNames: {},
});

const SEPT = { preset: "custom", from: "2026-09-01", to: "2026-09-30" } as const;
const TODAY = "2026-09-15";

const value = <T,>(w: { ok: boolean } & Record<string, unknown>): T => {
  expect(w.ok).toBe(true);
  return (w as { value: T }).value;
};

describe("deriveBookings", () => {
  test("counts bookings created in the period, cancelled ones included", () => {
    const section = deriveBookings(
      facts([
        booking({ id: "a", createdAt: "2026-08-31T23:00:00.000Z" }),
        booking({ id: "b", createdAt: "2026-09-01T00:00:00.000Z" }),
        booking({ id: "c", createdAt: "2026-09-30T23:59:00.000Z", status: "cancelled", cancelledAt: "2026-09-30T23:59:00.000Z" }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number }>(section.count).value).toBe(2);
  });

  /**
   * The Bookings section deliberately counts a population Revenue does not. A
   * cancelled booking is a booking that happened and then unhappened; it belongs
   * in the count and in the cancellation rate, and nowhere else.
   */
  test("a cancelled booking contributes to the count and to cancellations, and to nothing else", () => {
    const section = deriveBookings(
      facts([
        booking({ id: "a", nights: 2, adults: 2 }),
        booking({ id: "b", nights: 10, adults: 2, status: "cancelled", cancelledAt: "2026-09-11T00:00:00.000Z" }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number }>(section.count).value).toBe(2);
    expect(value<{ count: number; value: number }>(section.cancellations)).toMatchObject({
      count: 1,
      value: 50,
    });
    // Length of stay averages the two nights that actually happened, not six.
    expect(value<number>(section.averageLengthOfStay)).toBe(2);
  });

  test("average length of stay is null when nothing stayed", () => {
    const section = deriveBookings(facts([]), SEPT, TODAY);
    expect(value<number | null>(section.averageLengthOfStay)).toBeNull();
  });

  test("the cancellation delta inverts, so rising is bad", () => {
    const section = deriveBookings(facts([booking({})]), SEPT, TODAY);
    expect(value<{ delta: { goodDirection: string } }>(section.cancellations).delta.goodDirection).toBe("down");
  });

  test("lead time buckets on the boundaries the spec names", () => {
    const at = (days: number, id: string) =>
      booking({ id, checkIn: "2026-09-20", createdAt: `${addDaysLocal("2026-09-20", -days)}T12:00:00.000Z` });
    const section = deriveBookings(
      facts([at(0, "a"), at(1, "b"), at(2, "c"), at(7, "d"), at(8, "e"), at(30, "f"), at(31, "g"), at(90, "h"), at(91, "i")]),
      { preset: "custom", from: "2026-06-01", to: "2026-09-30" },
      TODAY,
    );
    const rows = value<{ key: string; value: number }[]>(section.leadTime);
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ["0-1", 2], ["2-7", 2], ["8-30", 2], ["31-90", 2], ["90+", 1],
    ]);
  });

  test("lead time never goes negative when a booking is made after check-in", () => {
    const section = deriveBookings(
      facts([booking({ checkIn: "2026-09-05", createdAt: "2026-09-10T12:00:00.000Z" })]),
      SEPT,
      TODAY,
    );
    const rows = value<{ key: string; value: number }[]>(section.leadTime);
    expect(rows.find((r) => r.key === "0-1")!.value).toBe(1);
  });

  test("upcoming windows run from today and ignore the period selector", () => {
    const nights = [
      night({ date: "2026-09-20", unitsSold: 4, unitsAvailable: 10 }),
      night({ date: "2026-10-20", unitsSold: 2, unitsAvailable: 10 }),
      night({ date: "2026-12-20", unitsSold: 9, unitsAvailable: 10 }),
    ];
    const section = deriveBookings(facts([], nights), SEPT, TODAY);
    const windows = value<UpcomingWindow[]>(section.upcoming);
    expect(windows.map((w) => w.window)).toEqual([30, 60, 90]);
    // 20 Sept is within 30 days of 15 Sept; 20 Oct is within 60; 20 Dec is beyond 90.
    expect(windows[0]).toMatchObject({ nightsSold: 4, nightsAvailable: 6 });
    expect(windows[1].nightsSold).toBe(6);
    expect(windows[2].nightsSold).toBe(6);
  });

  test("upcoming reports rooms still available, not total inventory", () => {
    const section = deriveBookings(
      facts([], [night({ date: "2026-09-20", unitsSold: 4, unitsAvailable: 10 })]),
      SEPT,
      TODAY,
    );
    const first = value<UpcomingWindow[]>(section.upcoming)[0];
    expect(first.nightsSold + first.nightsAvailable).toBe(10);
  });
});

function addDaysLocal(date: string, days: number): string {
  const ms = Date.UTC(...(date.split("-").map(Number) as [number, number, number])) ;
  return new Date(ms + (days - 0) * 86_400_000).toISOString().slice(0, 10);
}
```

Note: the helper above builds a UTC date from `[y, m, d]`, so subtract one from the month when calling `Date.UTC` — write it as `Date.UTC(y, m - 1, d)`. Fix it inline while implementing if the test's own arithmetic is off; the assertions are what matter.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/bookings.test.ts`
Expected: FAIL — `Cannot find module './bookings'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/derive/bookings.ts
import { addDays, comparisonRange, daysBetween, type Period } from "../period";
import type {
  BookingFact,
  BookingsSection,
  Facts,
  IsoDate,
  UpcomingWindow,
} from "../types";
import { makeDelta } from "./delta";
import { inRange, ratio } from "./totals";
import { widget } from "./widget";

export const LEAD_TIME_BUCKETS = [
  { key: "0-1", label: "0–1 days", max: 1 },
  { key: "2-7", label: "2–7 days", max: 7 },
  { key: "8-30", label: "8–30 days", max: 30 },
  { key: "31-90", label: "31–90 days", max: 90 },
  { key: "90+", label: "90+ days", max: Number.POSITIVE_INFINITY },
] as const;

const createdIn = (bookings: BookingFact[], from: IsoDate, to: IsoDate) =>
  bookings.filter((b) => b.createdAt.slice(0, 10) >= from && b.createdAt.slice(0, 10) <= to);

const stayed = (bookings: BookingFact[]) => bookings.filter((b) => b.status !== "cancelled");

export function deriveBookings(
  facts: Facts,
  period: Period,
  today: IsoDate,
): BookingsSection {
  const current = createdIn(facts.bookings, period.from, period.to);
  const comparison = comparisonRange(period);
  const previous = comparison ? createdIn(facts.bookings, comparison.from, comparison.to) : [];

  const cancelledCount = current.filter((b) => b.status === "cancelled").length;
  const cancelledPct = ratio(cancelledCount, current.length);
  const previousCancelledPct = comparison
    ? ratio(previous.filter((b) => b.status === "cancelled").length, previous.length)
    : null;

  return {
    count: widget(() => ({
      value: current.length,
      delta: makeDelta(current.length, comparison ? previous.length : null),
    })),
    // Cancelled stays never happened, so they cannot lengthen the average one.
    averageLengthOfStay: widget(() => {
      const kept = stayed(current);
      return ratio(kept.reduce((sum, b) => sum + b.nights, 0), kept.length);
    }),
    cancellations: widget(() => ({
      count: cancelledCount,
      value: cancelledPct === null ? 0 : cancelledPct * 100,
      // Inverted: more cancellations is worse, and the colour has to know.
      delta: makeDelta(
        cancelledPct === null ? null : cancelledPct * 100,
        previousCancelledPct === null ? null : previousCancelledPct * 100,
        "down",
      ),
    })),
    leadTime: widget(() => {
      const counts = new Map<string, number>(LEAD_TIME_BUCKETS.map((b) => [b.key, 0]));
      for (const b of current) {
        // A booking made after check-in is same-day, not negative days out.
        const lead = Math.max(0, daysBetween(b.createdAt.slice(0, 10), b.checkIn) - 1);
        const bucket = LEAD_TIME_BUCKETS.find((candidate) => lead <= candidate.max)!;
        counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
      }
      return LEAD_TIME_BUCKETS.map((b) => ({
        key: b.key,
        label: b.label,
        value: counts.get(b.key) ?? 0,
      }));
    }),
    // Always from today: a host asking "what does my next month look like" is
    // not asking about whichever period happens to be selected.
    upcoming: widget<UpcomingWindow[]>(() =>
      ([30, 60, 90] as const).map((window) => {
        const nights = inRange(facts.nights, today, addDays(today, window - 1));
        const sold = nights.reduce((sum, n) => sum + n.unitsSold, 0);
        const total = nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
        return {
          window,
          label: `Next ${window} days`,
          nightsSold: sold,
          // What is still sellable, not the whole pool — the stacked bar reads
          // as sold against remaining, and those must add up to inventory.
          nightsAvailable: total - sold,
        };
      }),
    ),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/bookings.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/derive/bookings.ts apps/business/lib/analytics/derive/bookings.test.ts
git commit -m "$(cat <<'MSG'
Count cancelled bookings where they belong and nowhere else

A cancelled booking happened and then unhappened. It belongs in the
booking count and in the cancellation rate; letting it into length of
stay or party size would let a ten-night booking nobody took stretch the
average. The Bookings section therefore counts a population the Revenue
section does not, which is the point of the cancellation widget.

The upcoming windows run from today and ignore the period selector,
because a host asking what their next month looks like is not asking
about whichever period is on screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 11: Pricing (section 4)

**Files:**
- Create: `apps/business/lib/analytics/derive/pricing.ts`
- Test: `apps/business/lib/analytics/derive/pricing.test.ts`

**Interfaces:**
- Consumes: `widget.ts`, `buckets.ts`, `totals.ts`; `granularityFor`, `type Period` from `../period`.
- Produces: `derivePricing(facts: Facts, period: Period): PricingSection`, and `const MODIFIER_LABELS: Record<ModifierType, string>` so a modifier's name is written once.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/pricing.test.ts
import { describe, expect, test } from "bun:test";
import type { Category, Facts, NightFact, Point } from "../types";
import { derivePricing } from "./pricing";

const night = (over: Partial<NightFact>): NightFact => ({
  date: "2026-09-10", propertyId: "p1", roomId: "standard", ratePlanId: "flex",
  unitsAvailable: 10, unitsSold: 1, netRevenueCents: 9_000,
  basePriceCents: 10_000, modifiers: [], ...over,
});

const facts = (nights: NightFact[]): Facts => ({
  nights, bookings: [], roomTypeNames: {}, ratePlanNames: {},
});

const SEPT = { preset: "custom", from: "2026-09-01", to: "2026-09-30" } as const;

const value = <T,>(w: { ok: boolean } & Record<string, unknown>): T => {
  expect(w.ok).toBe(true);
  return (w as { value: T }).value;
};

describe("derivePricing", () => {
  test("average discount is the gap between base and achieved", () => {
    const section = derivePricing(
      facts([night({ date: "2026-09-02", basePriceCents: 10_000, netRevenueCents: 9_000 })]),
      SEPT,
    );
    expect(value<number>(section.averageDiscountPct)).toBe(10);
  });

  /**
   * Weighted by nights sold. Unweighted, one heavily discounted night in a
   * quiet week outweighs a full week at rack rate, and the host reads a pricing
   * problem that is not there.
   */
  test("average discount is weighted by nights sold, not a mean of nightly percentages", () => {
    const section = derivePricing(
      facts([
        // One night at 50% off.
        night({ date: "2026-09-02", unitsSold: 1, basePriceCents: 10_000, netRevenueCents: 5_000 }),
        // Nine nights at full price.
        night({ date: "2026-09-03", unitsSold: 9, basePriceCents: 90_000, netRevenueCents: 90_000 }),
      ]),
      SEPT,
    );
    // Weighted: 1 - 95000/100000 = 5%. Unweighted would be 25%.
    expect(value<number>(section.averageDiscountPct)).toBe(5);
  });

  test("a night with no base price is excluded rather than counted as no discount", () => {
    const section = derivePricing(
      facts([
        night({ date: "2026-09-02", unitsSold: 0, basePriceCents: 0, netRevenueCents: 0 }),
        night({ date: "2026-09-03", unitsSold: 1, basePriceCents: 10_000, netRevenueCents: 8_000 }),
      ]),
      SEPT,
    );
    expect(value<number>(section.averageDiscountPct)).toBe(20);
  });

  test("average discount is null when nothing was priced", () => {
    const section = derivePricing(facts([night({ unitsSold: 0, basePriceCents: 0, netRevenueCents: 0 })]), SEPT);
    expect(value<number | null>(section.averageDiscountPct)).toBeNull();
  });

  test("a surcharge reads as a negative discount rather than being dropped", () => {
    // A weekend uplift is a real thing a host does; hiding it would make the
    // two lines cross with nothing to explain why.
    const section = derivePricing(
      facts([night({ date: "2026-09-05", basePriceCents: 10_000, netRevenueCents: 11_500 })]),
      SEPT,
    );
    expect(value<number>(section.averageDiscountPct)).toBe(-15);
  });

  test("base and achieved come back as two aligned series", () => {
    const section = derivePricing(
      facts([night({ date: "2026-09-02", unitsSold: 2, basePriceCents: 20_000, netRevenueCents: 18_000 })]),
      SEPT,
    );
    const { base, achieved } = value<{ base: Point[]; achieved: Point[] }>(section.priceOverTime);
    expect(base).toHaveLength(30);
    expect(achieved).toHaveLength(30);
    expect(base.map((p) => p.bucket)).toEqual(achieved.map((p) => p.bucket));
    // Per-night averages, so 20000c over 2 units is 10000c.
    expect(base.find((p) => p.bucket === "2026-09-02")!.value).toBe(10_000);
    expect(achieved.find((p) => p.bucket === "2026-09-02")!.value).toBe(9_000);
  });

  test("modifiers rank by absolute revenue impact and cap at ten", () => {
    const section = derivePricing(
      facts([
        night({
          date: "2026-09-02",
          modifiers: [
            { type: "day_of_week", impactCents: 5_000 },
            { type: "early_bird", impactCents: -12_000 },
          ],
        }),
        night({
          date: "2026-09-03",
          modifiers: [{ type: "day_of_week", impactCents: 3_000 }],
        }),
      ]),
      SEPT,
    );
    const rows = value<Category[]>(section.topModifiers);
    // Early bird moved more money even though it moved it downwards.
    expect(rows[0]).toMatchObject({ key: "early_bird", value: -12_000, count: 1 });
    expect(rows[1]).toMatchObject({ key: "day_of_week", value: 8_000, count: 2 });
    expect(rows.length).toBeLessThanOrEqual(10);
  });

  test("modifier rows carry a readable label, not the enum value", () => {
    const section = derivePricing(
      facts([night({ date: "2026-09-02", modifiers: [{ type: "last_minute", impactCents: -900 }] })]),
      SEPT,
    );
    expect(value<Category[]>(section.topModifiers)[0].label).toBe("Last-minute discount");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/pricing.test.ts`
Expected: FAIL — `Cannot find module './pricing'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/derive/pricing.ts
import type { ModifierType } from "@openbookings/pricing";
import { granularityFor, type Period } from "../period";
import type { Category, Facts, PricingSection } from "../types";
import { toSeries } from "./buckets";
import { inRange, ratio } from "./totals";
import { widget } from "./widget";

/** Written once, so a modifier is named the same in the chart, the list and the CSV. */
export const MODIFIER_LABELS: Record<ModifierType, string> = {
  day_of_week: "Day-of-week rate",
  length_of_stay: "Length-of-stay discount",
  early_bird: "Early-bird discount",
  last_minute: "Last-minute discount",
  extra_guest: "Extra-guest charge",
};

const TOP_N = 10;

export function derivePricing(facts: Facts, period: Period): PricingSection {
  const granularity = granularityFor(period);
  const current = inRange(facts.nights, period.from, period.to);

  // Only nights that were actually priced. A night with no base price is not a
  // night sold at no discount — it is a night with no rate to discount from,
  // and averaging it in as zero drags the figure towards nothing.
  const priced = current.filter((n) => n.basePriceCents > 0);
  const baseCents = priced.reduce((sum, n) => sum + n.basePriceCents, 0);
  const achievedCents = priced.reduce((sum, n) => sum + n.netRevenueCents, 0);

  return {
    // Weighted by the money at stake rather than by night. One cheap night in a
    // quiet week must not outweigh a full week at rack rate. A surcharge comes
    // through as a negative discount rather than being dropped, so the two
    // lines below always have something to explain them.
    averageDiscountPct: widget(() => {
      const r = ratio(achievedCents, baseCents);
      return r === null ? null : (1 - r) * 100;
    }),
    priceOverTime: widget(() => {
      const perNight = (pick: (n: (typeof current)[number]) => number) =>
        toSeries(
          current.filter((n) => n.unitsSold > 0),
          {
            date: (n) => n.date,
            // Per unit, so the line is a price rather than a nightly total.
            value: (n) => pick(n) / n.unitsSold,
            from: period.from,
            to: period.to,
            granularity,
            reduce: "mean",
          },
        );
      return {
        base: perNight((n) => n.basePriceCents),
        achieved: perNight((n) => n.netRevenueCents),
      };
    }),
    topModifiers: widget<Category[]>(() => {
      const totals = new Map<ModifierType, { impactCents: number; count: number }>();
      for (const night of current) {
        for (const modifier of night.modifiers) {
          const entry = totals.get(modifier.type) ?? { impactCents: 0, count: 0 };
          entry.impactCents += modifier.impactCents;
          entry.count += 1;
          totals.set(modifier.type, entry);
        }
      }
      return [...totals.entries()]
        .map(([type, { impactCents, count }]) => ({
          key: type,
          label: MODIFIER_LABELS[type] ?? type,
          value: impactCents,
          count,
        }))
        // By how much money moved, in either direction: a discount that gave
        // away €12,000 matters more than an uplift that earned €5,000, and
        // sorting signed would bury it at the bottom.
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.label.localeCompare(b.label))
        .slice(0, TOP_N);
    }),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/pricing.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/derive/pricing.ts apps/business/lib/analytics/derive/pricing.test.ts
git commit -m "$(cat <<'MSG'
Weight the average discount by the money at stake

Unweighted, one heavily discounted night in a quiet week outweighs a full
week at rack rate, and the host goes looking for a pricing problem that
is not there. Nights with no base price are excluded rather than averaged
in as zero discount, and a weekend uplift comes through as a negative
discount rather than vanishing.

Modifiers rank by how much money they moved in either direction, so a
discount that gave away twelve thousand outranks an uplift that earned
five.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 12: Guests (section 5)

**Files:**
- Create: `apps/business/lib/analytics/derive/guests.ts`
- Test: `apps/business/lib/analytics/derive/guests.test.ts`

**Interfaces:**
- Consumes: `widget.ts`, `totals.ts`; `type Period` from `../period`; `MIN_BOOKINGS_FOR_DETAIL` from `../types`.
- Produces: `deriveGuests(facts: Facts, period: Period): GuestsSection`, `const OTHER_COUNTRY_KEY = "OTHER"`, and `countryName(code: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/derive/guests.test.ts
import { describe, expect, test } from "bun:test";
import type { BookingFact, Category, Facts } from "../types";
import { deriveGuests, OTHER_COUNTRY_KEY } from "./guests";

const booking = (over: Partial<BookingFact>): BookingFact => ({
  id: "b1", propertyId: "p1", createdAt: "2026-09-10T12:00:00.000Z",
  checkIn: "2026-09-20", checkOut: "2026-09-22", nights: 2,
  status: "confirmed", cancelledAt: null, adults: 2, children: 0,
  guestKey: "g1", guestCountry: "NL", netRevenueCents: 30_000,
  roomId: "standard", ratePlanId: "flex", ...over,
});

const facts = (bookings: BookingFact[]): Facts => ({
  nights: [], bookings, roomTypeNames: {}, ratePlanNames: {},
});

const SEPT = { preset: "custom", from: "2026-09-01", to: "2026-09-30" } as const;

const value = <T,>(w: { ok: boolean } & Record<string, unknown>): T => {
  expect(w.ok).toBe(true);
  return (w as { value: T }).value;
};

const many = (country: string, count: number, from = 0) =>
  Array.from({ length: count }, (_, i) =>
    booking({ id: `${country}-${i + from}`, guestKey: `${country}-g${i + from}`, guestCountry: country }),
  );

describe("deriveGuests", () => {
  test("average party size counts adults and children", () => {
    const section = deriveGuests(
      facts([booking({ adults: 2, children: 2 }), booking({ id: "b2", adults: 1, children: 0 })]),
      SEPT,
    );
    expect(value<number>(section.averagePartySize)).toBe(2.5);
  });

  test("a cancelled booking never stayed, so it has no party size", () => {
    const section = deriveGuests(
      facts([
        booking({ adults: 2, children: 0 }),
        booking({ id: "b2", adults: 8, children: 0, status: "cancelled", cancelledAt: "2026-09-11T00:00:00.000Z" }),
      ]),
      SEPT,
    );
    expect(value<number>(section.averagePartySize)).toBe(2);
  });

  test("party size is null with nothing to average", () => {
    expect(value<number | null>(deriveGuests(facts([]), SEPT).averagePartySize)).toBeNull();
  });

  /**
   * All history, not just the selected period. A guest's second stay is their
   * second stay whichever window the host happens to be looking at.
   */
  test("a guest whose first stay predates the period still counts as repeat", () => {
    const section = deriveGuests(
      facts([
        booking({ id: "old", guestKey: "gerda", checkIn: "2025-05-01", createdAt: "2025-04-01T12:00:00.000Z" }),
        booking({ id: "new", guestKey: "gerda", checkIn: "2026-09-20" }),
      ]),
      SEPT,
    );
    expect(value<number>(section.repeatGuestPct)).toBe(100);
  });

  test("a first-time guest is not a repeat guest", () => {
    const section = deriveGuests(facts([booking({ guestKey: "new-face" })]), SEPT);
    expect(value<number>(section.repeatGuestPct)).toBe(0);
  });

  /**
   * The privacy rule. A four-room B&B with one Japanese guest would otherwise
   * publish that guest's presence to anyone who can see the screen.
   */
  test("a country with four bookings folds into Other; five stands on its own", () => {
    const section = deriveGuests(
      facts([...many("NL", 10), ...many("DE", 5), ...many("JP", 4), ...many("CA", 1)]),
      SEPT,
    );
    const rows = value<Category[]>(section.countries);
    expect(rows.map((r) => r.key)).toEqual(["NL", "DE", OTHER_COUNTRY_KEY]);
    expect(rows.find((r) => r.key === OTHER_COUNTRY_KEY)).toMatchObject({ label: "Other", value: 5 });
  });

  test("Other sorts last even when it outweighs a named country", () => {
    const section = deriveGuests(
      facts([...many("NL", 6), ...many("JP", 4), ...many("CA", 4), ...many("IE", 4)]),
      SEPT,
    );
    const rows = value<Category[]>(section.countries);
    expect(rows[rows.length - 1]).toMatchObject({ key: OTHER_COUNTRY_KEY, value: 12 });
  });

  test("no Other row appears when nothing needs folding", () => {
    const section = deriveGuests(facts([...many("NL", 6), ...many("DE", 5)]), SEPT);
    expect(value<Category[]>(section.countries).some((r) => r.key === OTHER_COUNTRY_KEY)).toBe(false);
  });

  test("countries carry a readable name", () => {
    const section = deriveGuests(facts(many("NL", 5)), SEPT);
    expect(value<Category[]>(section.countries)[0].label).toBe("Netherlands");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/derive/guests.test.ts`
Expected: FAIL — `Cannot find module './guests'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/derive/guests.ts
import type { Period } from "../period";
import {
  MIN_BOOKINGS_FOR_DETAIL,
  type BookingFact,
  type Category,
  type Facts,
  type GuestsSection,
} from "../types";
import { ratio } from "./totals";
import { widget } from "./widget";

export const OTHER_COUNTRY_KEY = "OTHER";

const regionNames = new Intl.DisplayNames(["en-GB"], { type: "region" });

export function countryName(code: string): string {
  if (code === OTHER_COUNTRY_KEY) return "Other";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const createdIn = (bookings: BookingFact[], period: Period) =>
  bookings.filter(
    (b) => b.createdAt.slice(0, 10) >= period.from && b.createdAt.slice(0, 10) <= period.to,
  );

const stayed = (bookings: BookingFact[]) => bookings.filter((b) => b.status !== "cancelled");

export function deriveGuests(facts: Facts, period: Period): GuestsSection {
  const current = createdIn(facts.bookings, period);

  return {
    // Cancelled bookings brought nobody, so they cannot change the party size.
    averagePartySize: widget(() => {
      const kept = stayed(current);
      return ratio(kept.reduce((sum, b) => sum + b.adults + b.children, 0), kept.length);
    }),

    /**
     * Repeat is judged against the whole fact set, not the selected period. A
     * guest's second stay is their second stay regardless of which window the
     * host is looking at, so the generator has to carry history outside it.
     */
    repeatGuestPct: widget(() => {
      const earliestByGuest = new Map<string, string>();
      for (const b of stayed(facts.bookings)) {
        const seen = earliestByGuest.get(b.guestKey);
        if (!seen || b.checkIn < seen) earliestByGuest.set(b.guestKey, b.checkIn);
      }
      const kept = stayed(current);
      const repeats = kept.filter((b) => (earliestByGuest.get(b.guestKey) ?? b.checkIn) < b.checkIn);
      const r = ratio(repeats.length, kept.length);
      return r === null ? null : r * 100;
    }),

    /**
     * Countries under five bookings fold into "Other". A four-room B&B with one
     * guest from Japan would otherwise publish that guest's presence to anyone
     * who can see the screen — or who opens the exported CSV. The fold lives
     * here rather than in the component so the export cannot skip it.
     */
    countries: widget<Category[]>(() => {
      const counts = new Map<string, number>();
      for (const b of current) counts.set(b.guestCountry, (counts.get(b.guestCountry) ?? 0) + 1);

      let folded = 0;
      const named: Category[] = [];
      for (const [code, count] of counts) {
        if (count < MIN_BOOKINGS_FOR_DETAIL) folded += count;
        else named.push({ key: code, label: countryName(code), value: count });
      }

      named.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      // Other sits last whatever its size: it is a residual, not a destination,
      // and ranking it first would read as "most guests come from Other".
      return folded > 0
        ? [...named, { key: OTHER_COUNTRY_KEY, label: "Other", value: folded }]
        : named;
    }),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/derive/guests.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/derive/guests.ts apps/business/lib/analytics/derive/guests.test.ts
git commit -m "$(cat <<'MSG'
Fold small countries together before anyone can read them

A four-room B&B with one guest from Japan would otherwise publish that
guest's presence to anyone who can see the screen, or who opens the
exported CSV. Folding under five lives in the derivation rather than the
component, so the export cannot skip it. Other sorts last whatever its
size, because it is a residual and not a destination.

Repeat guests are judged against all history rather than the selected
period: a second stay is a second stay whichever window is on screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 13: `getAnalytics()` and reconciliation

**Files:**
- Create: `apps/business/lib/analytics/get-analytics.ts`
- Test: `apps/business/lib/analytics/get-analytics.test.ts`
- Test: `apps/business/lib/analytics/reconciliation.test.ts`

**Interfaces:**
- Consumes: every `derive/*` module, `demo/properties.ts`, `demo/generate.ts`, `period.ts`.
- Produces:
  - `interface AnalyticsQuery { propertyId?: string; period: Period; today: IsoDate; demo: boolean; fail?: string }`
  - `getAnalytics(query: AnalyticsQuery): Promise<AnalyticsData>`
  - `const DEMO_DELAY_MS = 350`
  - `listProperties(demo: boolean): PropertySummary[]`

**How the comparison window is covered:** `getAnalytics` generates facts from `min(comparisonRange.from, startOfYear(today) - 1 year, period.from)` through `max(period.to, today + 90)`, so every widget that reaches outside the selected period — YTD, deltas, repeat guests, the upcoming windows — has facts to read. This is the one place that knows the union of those needs.

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/get-analytics.test.ts
import { describe, expect, test } from "bun:test";
import { resolvePeriod } from "./period";
import { getAnalytics, listProperties } from "./get-analytics";

const TODAY = "2026-09-25";
const thisMonth = resolvePeriod("this-month", TODAY);

describe("getAnalytics", () => {
  test("returns the same data for the same query, every time", async () => {
    const query = { propertyId: "demo-zeeburg", period: thisMonth, today: TODAY, demo: true };
    expect(await getAnalytics(query)).toEqual(await getAnalytics(query));
  });

  test("without demo it returns an empty dataset and says the property is new", async () => {
    const data = await getAnalytics({ period: thisMonth, today: TODAY, demo: false });
    expect(data.isDemo).toBe(false);
    expect(data.hasAnyBookings).toBe(false);
    expect(data.bookingsInPeriod).toBe(0);
    // The sections are still well-formed, so a component cannot crash on them.
    expect(data.revenue.periodCents.ok).toBe(true);
    expect(data.guests.countries.ok).toBe(true);
  });

  test("a demo property with history says it has bookings", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.hasAnyBookings).toBe(true);
    expect(data.bookingsInPeriod).toBeGreaterThan(0);
  });

  test("the brand new demo property has never had a booking", async () => {
    const data = await getAnalytics({
      propertyId: "demo-nieuwehaven", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.hasAnyBookings).toBe(false);
  });

  /**
   * Review Focus 5. An empty period is not a new property. Keying the Alert off
   * "no bookings here" would tell an established host with a quiet fortnight
   * that they are waiting for their first ever booking.
   */
  test("a range before the property opened is empty but not new", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod("custom", TODAY, { from: "2024-01-01", to: "2024-01-31" }),
      today: TODAY,
      demo: true,
    });
    expect(data.bookingsInPeriod).toBe(0);
    expect(data.hasAnyBookings).toBe(true);
  });

  test("an unknown property id falls back rather than throwing", async () => {
    const data = await getAnalytics({
      propertyId: "does-not-exist", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.property.id).toBe("demo-zeeburg");
  });

  test("the selected property and the full list both come back", async () => {
    const data = await getAnalytics({
      propertyId: "demo-vlierhof", period: thisMonth, today: TODAY, demo: true,
    });
    expect(data.property).toEqual({ id: "demo-vlierhof", name: "De Vlierhof" });
    expect(data.properties).toHaveLength(3);
  });

  test("fail forces exactly one widget to fail and leaves the rest standing", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg", period: thisMonth, today: TODAY, demo: true, fail: "revenue.overTime",
    });
    expect(data.revenue.overTime.ok).toBe(false);
    expect(data.revenue.periodCents.ok).toBe(true);
    expect(data.sellThrough.pct.ok).toBe(true);
  });

  test("fail is ignored outside demo mode", async () => {
    const data = await getAnalytics({
      period: thisMonth, today: TODAY, demo: false, fail: "revenue.overTime",
    });
    expect(data.revenue.overTime.ok).toBe(true);
  });

  test("the upcoming windows have facts to read beyond the period", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod("last-month", TODAY),
      today: TODAY,
      demo: true,
    });
    expect(data.bookings.upcoming.ok).toBe(true);
    if (data.bookings.upcoming.ok) {
      const ninety = data.bookings.upcoming.value.find((w) => w.window === 90)!;
      expect(ninety.nightsSold + ninety.nightsAvailable).toBeGreaterThan(0);
    }
  });

  test("granularity travels with the data so charts cannot disagree", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg", period: resolvePeriod("last-12-months", TODAY), today: TODAY, demo: true,
    });
    expect(data.granularity).toBe("month");
  });
});

describe("listProperties", () => {
  test("demo mode offers all three, so every state is reachable from the selector", () => {
    expect(listProperties(true).map((p) => p.id)).toEqual([
      "demo-zeeburg", "demo-vlierhof", "demo-nieuwehaven",
    ]);
  });

  test("outside demo mode there is nothing to list yet", () => {
    expect(listProperties(false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the reconciliation test**

```ts
// apps/business/lib/analytics/reconciliation.test.ts
import { describe, expect, test } from "bun:test";
import { COMMISSION_RATE } from "./derive/totals";
import { resolvePeriod, type PeriodPreset } from "./period";
import { getAnalytics } from "./get-analytics";

const TODAY = "2026-09-25";
const PRESETS: PeriodPreset[] = [
  "this-month", "last-month", "last-3-months", "ytd", "last-12-months",
];

/**
 * The acceptance criteria, asserted. Each of these is an identity that holds
 * because the figures are derived from one fact set rather than written down
 * beside each other — so if one ever fails, a derivation has started inventing.
 */
describe.each(PRESETS)("reconciliation over %s", (preset) => {
  const load = () =>
    getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod(preset, TODAY),
      today: TODAY,
      demo: true,
    });

  test("ADR times nights sold equals revenue", async () => {
    const data = await load();
    if (!data.revenue.adrCents.ok || !data.revenue.periodCents.ok || !data.sellThrough.roomsSold.ok) {
      throw new Error("widget failed");
    }
    const adr = data.revenue.adrCents.value.value;
    const sold = data.sellThrough.roomsSold.value;
    if (adr === null) {
      expect(sold).toBe(0);
      return;
    }
    expect(Math.round(adr * sold)).toBe(data.revenue.periodCents.value.value);
  });

  test("commission is 4.5% of revenue", async () => {
    const data = await load();
    if (!data.revenue.commissionCents.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    expect(data.revenue.commissionCents.value).toBe(
      Math.round(data.revenue.periodCents.value.value * COMMISSION_RATE),
    );
  });

  test("revenue by room type sums to period revenue", async () => {
    const data = await load();
    if (!data.revenue.byRoomType.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    const sum = data.revenue.byRoomType.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(data.revenue.periodCents.value.value);
  });

  test("revenue by rate plan sums to period revenue", async () => {
    const data = await load();
    if (!data.revenue.byRatePlan.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    const sum = data.revenue.byRatePlan.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(data.revenue.periodCents.value.value);
  });

  test("revenue over time sums to period revenue", async () => {
    const data = await load();
    if (!data.revenue.overTime.ok || !data.revenue.periodCents.ok) throw new Error("widget failed");
    const sum = data.revenue.overTime.value.reduce((total, point) => total + point.value, 0);
    expect(sum).toBe(data.revenue.periodCents.value.value);
  });

  test("lead-time buckets sum to the booking count", async () => {
    const data = await load();
    if (!data.bookings.leadTime.ok || !data.bookings.count.ok) throw new Error("widget failed");
    const sum = data.bookings.leadTime.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(data.bookings.count.value.value);
  });

  test("the country list accounts for every booking in the period", async () => {
    const data = await load();
    if (!data.guests.countries.ok) throw new Error("widget failed");
    const sum = data.guests.countries.value.reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(data.bookingsInPeriod);
  });

  test("RevPAR never exceeds ADR", async () => {
    // Nights available is always at least nights sold, so revenue spread over
    // the wider denominator cannot be the larger number. If it is, one of the
    // two is dividing by the wrong thing.
    const data = await load();
    if (!data.revenue.revparCents.ok || !data.revenue.adrCents.ok) throw new Error("widget failed");
    const revpar = data.revenue.revparCents.value.value;
    const adr = data.revenue.adrCents.value.value;
    if (revpar === null || adr === null) return;
    expect(revpar).toBeLessThanOrEqual(adr + 0.0001);
  });

  test("no widget reports NaN or Infinity", async () => {
    const data = await load();
    const offenders: string[] = [];
    JSON.stringify(data, (key, value) => {
      if (typeof value === "number" && !Number.isFinite(value)) offenders.push(key);
      return value;
    });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `bun test lib/analytics/get-analytics.test.ts lib/analytics/reconciliation.test.ts`
Expected: FAIL — `Cannot find module './get-analytics'`.

- [ ] **Step 4: Implement**

```ts
// apps/business/lib/analytics/get-analytics.ts
import { deriveBookings } from "./derive/bookings";
import { deriveGuests } from "./derive/guests";
import { derivePricing } from "./derive/pricing";
import { deriveRevenue } from "./derive/revenue";
import { deriveSellThrough } from "./derive/sell-through";
import { generateFacts } from "./demo/generate";
import { DEMO_PROPERTIES, findDemoProperty } from "./demo/properties";
import { addDays, comparisonRange, granularityFor, type Period } from "./period";
import type {
  AnalyticsData,
  Facts,
  IsoDate,
  PropertySummary,
  Widget,
} from "./types";

export interface AnalyticsQuery {
  propertyId?: string;
  period: Period;
  today: IsoDate;
  /** Opt-in. Never inferred from the absence of real data. */
  demo: boolean;
  /** Demo-only: forces one widget to fail, so the error state is reachable. */
  fail?: string;
}

/** Long enough for the skeletons to be visible, short enough not to annoy. */
export const DEMO_DELAY_MS = 350;

const EMPTY_FACTS: Facts = { nights: [], bookings: [], roomTypeNames: {}, ratePlanNames: {} };

export function listProperties(demo: boolean): PropertySummary[] {
  // Nothing to list until the real query lands: the property selector appears
  // only when there is more than one, and outside demo mode there are none.
  return demo ? DEMO_PROPERTIES.map(({ id, name }) => ({ id, name })) : [];
}

/**
 * The single entry point. Today it generates facts and derives; when the real
 * queries land, only this function's body changes — the returned type, every
 * derivation and every component stay exactly as they are.
 */
export async function getAnalytics(query: AnalyticsQuery): Promise<AnalyticsData> {
  const { period, today, demo } = query;

  if (demo) await new Promise((resolve) => setTimeout(resolve, DEMO_DELAY_MS));

  const property = demo
    ? (({ id, name }) => ({ id, name }))(findDemoProperty(query.propertyId))
    : { id: query.propertyId ?? "unknown", name: "Your property" };

  const facts = demo ? generateFacts(findDemoProperty(query.propertyId), ...factWindow(period, today), today) : EMPTY_FACTS;

  const data: AnalyticsData = {
    property,
    properties: listProperties(demo),
    range: { from: period.from, to: period.to },
    granularity: granularityFor(period),
    // "Ever", not "in this period". An established host with a quiet fortnight
    // must not be told they are waiting for their first booking.
    hasAnyBookings: facts.bookings.length > 0,
    bookingsInPeriod: facts.bookings.filter(
      (b) => b.createdAt.slice(0, 10) >= period.from && b.createdAt.slice(0, 10) <= period.to,
    ).length,
    isDemo: demo,
    revenue: deriveRevenue(facts, period, today),
    sellThrough: deriveSellThrough(facts, period),
    bookings: deriveBookings(facts, period, today),
    pricing: derivePricing(facts, period),
    guests: deriveGuests(facts, period),
  };

  return demo && query.fail ? forceFailure(data, query.fail) : data;
}

/**
 * Facts have to cover more than the selected period: year to date reaches back
 * to 1 January and its delta a year before that, the ordinary delta reaches one
 * period back, repeat guests reach across all history, and the upcoming windows
 * reach ninety days forward. This is the one place that knows the union.
 */
function factWindow(period: Period, today: IsoDate): [IsoDate, IsoDate] {
  const comparison = comparisonRange(period);
  const lastYearStart = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const from = [period.from, comparison?.from ?? period.from, lastYearStart].sort()[0];
  const to = [period.to, addDays(today, 90)].sort().at(-1)!;
  return [from, to];
}

/**
 * Demo-only. Without it the error row of the spec's States table is unreachable,
 * which means it is also untested and nobody finds out it is broken.
 */
function forceFailure(data: AnalyticsData, path: string): AnalyticsData {
  const [section, key] = path.split(".");
  const target = (data as unknown as Record<string, Record<string, Widget<unknown>>>)[section];
  if (!target || !(key in target)) return data;
  target[key] = { ok: false, message: "We could not work this one out." };
  return data;
}
```

- [ ] **Step 5: Run both suites to verify they pass**

Run: `bun test lib/analytics/`
Expected: PASS, all suites.

If a reconciliation test fails, the fault is in the derivation it names, not in the test — these identities are the acceptance criteria. Fix the derivation.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add apps/business/lib/analytics
git commit -m "$(cat <<'MSG'
Put one function between the widgets and the data

getAnalytics generates facts and derives every section. When the real
queries land, only this body changes: the returned type, the derivations
and the components stay as they are.

It also owns the fact window, because year to date reaches back to
January, its delta a year further, repeat guests across all history and
the upcoming windows ninety days forward. Only one place can know the
union of those, and it is here.

hasAnyBookings means ever, not in this period. Keying the new-property
alert off an empty period would tell an established host with a quiet
fortnight that they are waiting for their first booking.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 14: CSV export

**Files:**
- Create: `apps/business/lib/analytics/csv.ts`
- Test: `apps/business/lib/analytics/csv.test.ts`

**Interfaces:**
- Consumes: `AnalyticsData`, `Category`, `Point` and `Widget` from `./types`. It reads the widgets directly rather than through `unwrapOr`, because a failed widget needs a note in the file, not a fallback value.
- Produces:
  - `type SectionId = "revenue" | "sell-through" | "bookings" | "pricing" | "guests"`
  - `const SECTION_TITLES: Record<SectionId, string>`
  - `sectionCsv(data: AnalyticsData, section: SectionId): string`
  - `csvFilename(data: AnalyticsData, section: SectionId): string`

- [ ] **Step 1: Write the failing test**

```ts
// apps/business/lib/analytics/csv.test.ts
import { describe, expect, test } from "bun:test";
import { resolvePeriod } from "./period";
import { getAnalytics } from "./get-analytics";
import { csvFilename, sectionCsv, SECTION_TITLES, type SectionId } from "./csv";

const TODAY = "2026-09-25";
const SECTIONS = Object.keys(SECTION_TITLES) as SectionId[];

const load = (propertyId = "demo-zeeburg") =>
  getAnalytics({ propertyId, period: resolvePeriod("this-month", TODAY), today: TODAY, demo: true });

describe("sectionCsv", () => {
  test.each(SECTIONS)("%s produces a header row and at least one data row", async (section) => {
    const csv = sectionCsv(await load(), section);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain(",");
  });

  test.each(SECTIONS)("%s never writes the word occupancy", async (section) => {
    expect(sectionCsv(await load(), section)).not.toMatch(/occupanc/i);
  });

  test("money is written in euros with two decimals, not raw cents", async () => {
    // A host opens this in a spreadsheet; 4523900 is not a price.
    const csv = sectionCsv(await load(), "revenue");
    expect(csv).toMatch(/\d+\.\d{2}/);
  });

  test("revenue rows match the view model they came from", async () => {
    const data = await load();
    if (!data.revenue.byRoomType.ok) throw new Error("widget failed");
    const csv = sectionCsv(data, "revenue");
    for (const row of data.revenue.byRoomType.value) {
      expect(csv).toContain(row.label);
      expect(csv).toContain((row.value / 100).toFixed(2));
    }
  });

  test("the guests export folds small countries exactly as the screen does", async () => {
    const data = await load("demo-vlierhof");
    if (!data.guests.countries.ok) throw new Error("widget failed");
    const csv = sectionCsv(data, "guests");
    const codes = data.guests.countries.value.map((c) => c.label);
    // Every label on screen appears, and nothing else does: a country folded
    // into Other must not reappear in the file a host can forward to anyone.
    for (const label of codes) expect(csv).toContain(label);
    const countryLines = csv.split("\n").filter((l) => l.startsWith("Country,"));
    expect(countryLines).toHaveLength(codes.length);
  });

  test("a failed widget leaves a note rather than a blank or a crash", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod("this-month", TODAY),
      today: TODAY,
      demo: true,
      fail: "revenue.byRoomType",
    });
    expect(sectionCsv(data, "revenue")).toContain("unavailable");
  });

  test("a value containing a comma or a quote is escaped", async () => {
    const data = await load();
    if (!data.revenue.byRoomType.ok) throw new Error("widget failed");
    data.revenue.byRoomType.value.push({ key: "x", label: 'Suite "Grand", sea view', value: 1_000 });
    expect(sectionCsv(data, "revenue")).toContain('"Suite ""Grand"", sea view"');
  });

  test("a missing value is an empty field, not the string null", async () => {
    const data = await getAnalytics({
      propertyId: "demo-nieuwehaven",
      period: resolvePeriod("this-month", TODAY),
      today: TODAY,
      demo: true,
    });
    expect(sectionCsv(data, "pricing")).not.toContain("null");
  });
});

describe("csvFilename", () => {
  test("names the property, the section and the range", async () => {
    const data = await load();
    expect(csvFilename(data, "sell-through")).toBe(
      "zeeburg-grand-sell-through-2026-09-01-to-2026-09-25.csv",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/csv.test.ts`
Expected: FAIL — `Cannot find module './csv'`.

- [ ] **Step 3: Implement**

```ts
// apps/business/lib/analytics/csv.ts
import type { AnalyticsData, Category, Point, Widget } from "./types";

export type SectionId = "revenue" | "sell-through" | "bookings" | "pricing" | "guests";

export const SECTION_TITLES: Record<SectionId, string> = {
  revenue: "Revenue",
  "sell-through": "Sell-through",
  bookings: "Bookings",
  pricing: "Pricing",
  guests: "Guests",
};

type Row = (string | number | null)[];

function escape(field: string | number | null): string {
  if (field === null) return "";
  const text = String(field);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const toCsv = (rows: Row[]): string => rows.map((row) => row.map(escape).join(",")).join("\n");

/** Cents are an internal unit. A host opening this in a spreadsheet wants euros. */
const euros = (cents: number | null): string | null =>
  cents === null ? null : (cents / 100).toFixed(2);

const pct = (value: number | null): string | null =>
  value === null ? null : value.toFixed(1);

/**
 * A failed widget leaves a visible note. A blank block would read as "nothing
 * happened here", which is a different and wrong claim.
 */
function rowsFor<T>(w: Widget<T>, build: (value: T) => Row[]): Row[] {
  return w.ok ? build(w.value) : [["This widget was unavailable when the file was exported."]];
}

const categories = (label: string, rows: Category[], format: (v: number) => string | null): Row[] =>
  rows.map((row) => [label, row.label, format(row.value), row.count ?? null]);

const series = (label: string, points: Point[], format: (v: number) => string | null): Row[] =>
  points.map((point) => [label, point.bucket, point.label, format(point.value)]);

export function sectionCsv(data: AnalyticsData, section: SectionId): string {
  const header: Row = [
    ["Property", data.property.name],
    ["Section", SECTION_TITLES[section]],
    ["From", data.range.from],
    ["To", data.range.to],
  ].flat() as Row;

  const rows: Row[] = [
    ["Metric", "Key", "Value", "Count"],
    ...bodyFor(data, section),
  ];

  return `${toCsv([header])}\n\n${toCsv(rows)}\n`;
}

function bodyFor(data: AnalyticsData, section: SectionId): Row[] {
  switch (section) {
    case "revenue":
      return [
        ...rowsFor(data.revenue.yearToDateCents, (v) => [["Year to date (EUR)", "", euros(v.value), v.delta.label]]),
        ...rowsFor(data.revenue.periodCents, (v) => [["Revenue in period (EUR)", "", euros(v.value), v.delta.label]]),
        ...rowsFor(data.revenue.adrCents, (v) => [["Average room price (EUR)", "", euros(v.value), null]]),
        ...rowsFor(data.revenue.revparCents, (v) => [["RevPAR (EUR)", "", euros(v.value), null]]),
        ...rowsFor(data.revenue.commissionCents, (v) => [["Commission paid (EUR)", "", euros(v), null]]),
        ...rowsFor(data.revenue.overTime, (v) => series("Revenue over time (EUR)", v, euros)),
        ...rowsFor(data.revenue.byRoomType, (v) => categories("Revenue by room type (EUR)", v, euros)),
        ...rowsFor(data.revenue.byRatePlan, (v) => categories("Revenue by rate plan (EUR)", v, euros)),
      ];
    case "sell-through":
      return [
        ...rowsFor(data.sellThrough.pct, (v) => [["Sell-through (%)", "", pct(v.value), v.delta.label]]),
        ...rowsFor(data.sellThrough.roomsSold, (v) => [["Rooms sold", "", v, null]]),
        ...rowsFor(data.sellThrough.overTime, (v) => series("Sell-through over time (%)", v, pct)),
        ...rowsFor(data.sellThrough.byRoomType, (v) => categories("Sell-through by room type (%)", v, pct)),
        ...rowsFor(data.sellThrough.busiestDays, (v) =>
          v.cells.map((cell) => [
            "Busiest days (%)",
            `${cell.weekStart} weekday ${cell.weekday}`,
            pct(cell.pct),
            cell.nightsSold,
          ]),
        ),
      ];
    case "bookings":
      return [
        ...rowsFor(data.bookings.count, (v) => [["Number of bookings", "", v.value, v.delta.label]]),
        ...rowsFor(data.bookings.averageLengthOfStay, (v) => [["Average length of stay (nights)", "", v === null ? null : v.toFixed(2), null]]),
        ...rowsFor(data.bookings.cancellations, (v) => [["Cancellations", "", v.count, v.delta.label]]),
        ...rowsFor(data.bookings.leadTime, (v) => categories("Lead time (bookings)", v, (n) => String(n))),
        ...rowsFor(data.bookings.upcoming, (v) =>
          v.flatMap((w) => [
            ["Upcoming nights sold", w.label, w.nightsSold, null],
            ["Upcoming nights available", w.label, w.nightsAvailable, null],
          ]),
        ),
      ];
    case "pricing":
      return [
        ...rowsFor(data.pricing.averageDiscountPct, (v) => [["Average discount (%)", "", pct(v), null]]),
        ...rowsFor(data.pricing.priceOverTime, (v) => [
          ...series("Base price (EUR)", v.base, euros),
          ...series("Achieved price (EUR)", v.achieved, euros),
        ]),
        ...rowsFor(data.pricing.topModifiers, (v) => categories("Modifier impact (EUR)", v, euros)),
      ];
    case "guests":
      return [
        ...rowsFor(data.guests.averagePartySize, (v) => [["Average party size", "", v === null ? null : v.toFixed(2), null]]),
        ...rowsFor(data.guests.repeatGuestPct, (v) => [["Repeat guests (%)", "", pct(v), null]]),
        ...rowsFor(data.guests.countries, (v) => categories("Country", v, (n) => String(n))),
      ];
  }
}

export function csvFilename(data: AnalyticsData, section: SectionId): string {
  const slug = data.property.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug}-${section}-${data.range.from}-to-${data.range.to}.csv`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/csv.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/business/lib/analytics/csv.ts apps/business/lib/analytics/csv.test.ts
git commit -m "$(cat <<'MSG'
Export the same numbers the screen is showing

The CSV writer reads the view model the widgets render, so the file and
the page cannot drift. In particular the country fold happens upstream of
both: a country folded into Other on screen must not reappear in a file a
host can forward to anyone.

Cents become euros here, because a host opening this in a spreadsheet
wants a price. A failed widget leaves a visible note rather than a blank
block, which would read as nothing having happened.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 15: Display formatting and the widget shell

**Files:**
- Create: `apps/business/lib/analytics/format.ts`
- Test: `apps/business/lib/analytics/format.test.ts`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/widget-frame.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/kpi-card.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/states.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/analytics-skeleton.tsx`

**Interfaces:**
- Produces from `format.ts`: `formatCents(cents: number | null): string`, `formatPercent(value: number | null, digits?: number): string`, `formatCount(value: number | null): string`, `formatNights(value: number | null): string`, `trendSentence(label: string, points: Point[], format: (v: number) => string): string`.
- Produces from the components: `WidgetFrame`, `KpiCard`, `NewPropertyAlert`, `NoStaysMessage`, `NotEnoughDataMessage`, `DemoBanner`, `AnalyticsSkeleton`.

- [ ] **Step 1: Write the failing test for `format.ts`**

```ts
// apps/business/lib/analytics/format.test.ts
import { describe, expect, test } from "bun:test";
import { formatCents, formatCount, formatNights, formatPercent, trendSentence } from "./format";

describe("formatCents", () => {
  test("renders euros from cents", () => {
    expect(formatCents(452_390)).toBe("€4,523.90");
    expect(formatCents(0)).toBe("€0.00");
  });

  test("a missing value is an em dash, never €0", () => {
    // €0 says they earned nothing; the em dash says we cannot say.
    expect(formatCents(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  test("renders one decimal by default and an em dash when absent", () => {
    expect(formatPercent(62.47)).toBe("62.5%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatCount and formatNights", () => {
  test("group thousands, and dash on null", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(null)).toBe("—");
    expect(formatNights(2.456)).toBe("2.5 nights");
    expect(formatNights(1)).toBe("1 night");
    expect(formatNights(null)).toBe("—");
  });
});

describe("trendSentence", () => {
  /**
   * This is the chart's aria-label. It has to be a sentence, built from the
   * chart's own numbers, because a static description would go stale the moment
   * the period changes and would then be actively misleading.
   */
  test("describes the movement across the series", () => {
    const points = [
      { bucket: "2026-09-01", label: "1 Sep", value: 310_000 },
      { bucket: "2026-09-02", label: "2 Sep", value: 420_000 },
    ];
    expect(trendSentence("Revenue", points, formatCents)).toBe(
      "Revenue rose from €3,100.00 on 1 Sep to €4,200.00 on 2 Sep.",
    );
  });

  test("says fell when it fell, and held steady when it did not move", () => {
    const at = (value: number, label: string) => ({ bucket: "x", label, value });
    expect(trendSentence("Revenue", [at(400, "1 Sep"), at(100, "2 Sep")], formatCents)).toContain("fell from");
    expect(trendSentence("Revenue", [at(400, "1 Sep"), at(400, "2 Sep")], formatCents)).toContain("held steady at");
  });

  test("a single point and an empty series still yield a usable sentence", () => {
    expect(trendSentence("Revenue", [{ bucket: "x", label: "1 Sep", value: 500 }], formatCents)).toBe(
      "Revenue was €5.00 on 1 Sep, the only point in this period.",
    );
    expect(trendSentence("Revenue", [], formatCents)).toBe("Revenue has no data in this period.");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test lib/analytics/format.test.ts`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: Implement `format.ts`**

```ts
// apps/business/lib/analytics/format.ts
import type { Point } from "./types";

/** An absent number is an em dash everywhere. €0 and "we cannot say" are different claims. */
export const EM_DASH = "—";

const money = new Intl.NumberFormat("en-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const counts = new Intl.NumberFormat("en-NL");

export function formatCents(cents: number | null): string {
  return cents === null ? EM_DASH : money.format(cents / 100);
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? EM_DASH : `${value.toFixed(digits)}%`;
}

export function formatCount(value: number | null): string {
  return value === null ? EM_DASH : counts.format(value);
}

export function formatNights(value: number | null): string {
  if (value === null) return EM_DASH;
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "night" : "nights"}`;
}

/**
 * A chart's aria-label, built from the chart's own numbers. A static
 * description would go stale the moment the host changes the period, and a
 * stale description of a chart is worse than none.
 */
export function trendSentence(
  label: string,
  points: Point[],
  format: (value: number) => string,
): string {
  if (points.length === 0) return `${label} has no data in this period.`;
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length === 1) {
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test lib/analytics/format.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write `widget-frame.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/widget-frame.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MIN_BOOKINGS_FOR_DETAIL, type Widget } from "@/lib/analytics/types";

interface WidgetFrameProps<T> {
  title: string;
  /** The widget's definition, shown on the info affordance. */
  definition?: string;
  widget: Widget<T>;
  /** When set, the widget refuses to render below five bookings. */
  bookingsInPeriod?: number;
  requiresDetail?: boolean;
  /** True when the period holds no stays at all. */
  isEmpty?: boolean;
  className?: string;
  children: (value: T) => React.ReactNode;
}

/**
 * Every widget's outer shell: the card, the definition tooltip, and the three
 * ways a widget can decline to draw itself. Retry is router.refresh() — the
 * data comes from a server component, so re-rendering the route IS the retry.
 */
export function WidgetFrame<T>({
  title,
  definition,
  widget,
  bookingsInPeriod,
  requiresDetail = false,
  isEmpty = false,
  className,
  children,
}: WidgetFrameProps<T>) {
  const router = useRouter();
  const [retrying, startRetry] = React.useTransition();

  const tooThin =
    requiresDetail &&
    bookingsInPeriod !== undefined &&
    bookingsInPeriod < MIN_BOOKINGS_FOR_DETAIL;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 font-medium text-sm">
          {title}
          {definition ? (
            <Tooltip>
              <TooltipTrigger
                // Focusable in visual order, so the definition is reachable
                // without a mouse.
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
                aria-label={`What ${title} means`}
              >
                <Info className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{definition}</TooltipContent>
            </Tooltip>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!widget.ok ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
              {widget.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={() => startRetry(() => router.refresh())}
            >
              <RotateCw className={retrying ? "animate-spin" : undefined} aria-hidden />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : tooThin ? (
          <CardDescription>
            Not enough bookings in this period to show this.
          </CardDescription>
        ) : isEmpty ? (
          <CardDescription>No stays in this period.</CardDescription>
        ) : (
          children(widget.value)
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Write `kpi-card.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/kpi-card.tsx
"use client";

import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Area, AreaChart } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { Delta, Point } from "@/lib/analytics/types";

/**
 * The arrow is never alone: `delta.label` is rendered as text beside it, so the
 * direction survives colour blindness, a greyscale print and a screen reader.
 * Whether up is good travels on the delta, because Cancellations and Average
 * discount are the two where it is not.
 */
export function DeltaBadge({ delta }: { delta: Delta }) {
  if (delta.pct === null) {
    return <span className="text-muted-foreground text-xs">No comparison data</span>;
  }

  const Icon =
    delta.direction === "up" ? ArrowUp : delta.direction === "down" ? ArrowDown : ArrowRight;
  const good =
    delta.direction === "flat" ? null : delta.direction === delta.goodDirection;

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        good === null && "text-muted-foreground",
        good === true && "text-(--green-11)",
        good === false && "text-destructive",
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {delta.label}
    </span>
  );
}

export function Sparkline({ points, label }: { points: Point[]; label: string }) {
  if (points.length < 2) return null;
  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className="h-10 w-full"
      // Decorative: the number above it carries the value, and the chart beside
      // it carries the shape. Announcing it again would only add noise.
      aria-hidden
    >
      <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          fill="var(--color-value)"
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function KpiValue({
  value,
  delta,
  spark,
  sparkLabel,
}: {
  value: string;
  delta?: Delta;
  spark?: Point[];
  sparkLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-semibold text-2xl tabular-nums tracking-tight">{value}</p>
      {delta ? <DeltaBadge delta={delta} /> : null}
      {spark && sparkLabel ? <Sparkline points={spark} label={sparkLabel} /> : null}
    </div>
  );
}
```

- [ ] **Step 7: Write `states.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/states.tsx
import Link from "next/link";
import { ChartNoAxesColumn, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * Shown for a property that has never taken a booking — not for one having a
 * quiet fortnight. There is nothing to arrange on the page yet, so the sections
 * are hidden rather than filled with dashes.
 */
export function NewPropertyAlert({ showDemoLink }: { showDemoLink: boolean }) {
  return (
    <Alert className="mx-4 lg:mx-6">
      <ChartNoAxesColumn />
      <AlertTitle>No analytics yet</AlertTitle>
      <AlertDescription>
        <p>Your analytics will appear once you receive your first booking.</p>
        {showDemoLink ? (
          <p>
            {/* Without this the demo is discoverable only to whoever knows the
                flag, which makes the whole tab look unbuilt. */}
            <Link href="?demo=1" className="underline underline-offset-4">
              Preview with demo data
            </Link>{" "}
            to see what this page will show you.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Unmissable, because every figure below it is invented. Mirrors the banner on
 * the rates-availability grid, for the same reason: a host must never mistake
 * demo numbers for their own.
 */
export function DemoBanner() {
  return (
    <div className="flex items-center gap-2 border-(--amber-11)/30 border-b bg-(--amber-3) px-4 py-2 text-(--amber-11) text-sm lg:px-6">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span>
        Demo data — none of these numbers are yours.{" "}
        <Link href="/dashboard/analytics" className="underline">
          Switch to your own analytics
        </Link>
        .
      </span>
    </div>
  );
}
```

- [ ] **Step 8: Write `analytics-skeleton.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/analytics-skeleton.tsx
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dimensions match the real widgets, so nothing jumps when the data arrives.
 * A skeleton that resizes on load is a worse experience than a spinner.
 */
function KpiSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-16" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ height = "h-64" }: { height?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className={`w-full ${height}`} />
      </CardContent>
    </Card>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-8 px-4 lg:px-6" aria-busy="true" aria-label="Loading analytics">
      {[4, 2, 3, 2, 3].map((kpis, section) => (
        <section key={section} className="space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="grid gap-4 @lg/main:grid-cols-2 @4xl/main:grid-cols-4">
            {Array.from({ length: kpis }, (_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </div>
          <div className="grid gap-4 @4xl/main:grid-cols-2">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Typecheck and commit**

```bash
bun run typecheck
git add apps/business/lib/analytics/format.ts apps/business/lib/analytics/format.test.ts "apps/business/app/(dashboard)/dashboard/analytics/_components"
git commit -m "$(cat <<'MSG'
Build the shell every widget sits in

One frame owns the card, the definition tooltip, and the three ways a
widget declines to draw: it failed, the period holds no stays, or there
are fewer than five bookings and showing detail would either mislead or
identify a guest. Retry is router.refresh(), because the data comes from a
server component and re-rendering the route is the retry.

The delta arrow never travels alone — its label renders as text beside
it, so direction survives colour blindness, greyscale and a screen reader.

Chart labels are sentences built from the chart's own numbers. A static
description would go stale the moment the period changes, and a stale
description is worse than none.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 16: Chart primitives

**Files:**
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/charts/line-chart.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/charts/bar-chart.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/charts/stacked-bar.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/ranked-list.tsx`

**Interfaces:**
- Consumes: `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent` from `@/components/ui/chart`; `Point`, `Category`, `UpcomingWindow` from `@/lib/analytics/types`; `trendSentence` from `@/lib/analytics/format`.
- Produces: `TrendLineChart`, `DualLineChart`, `RankedBarChart` (also serves the lead-time histogram), `UpcomingStackedBar`, `RankedList`.

**Available tokens:** `--chart-1` through `--chart-5` are defined in `app/globals.css`. Use them; do not introduce new colours.

**Note on the histogram:** the spec calls lead time a histogram, and a histogram of pre-bucketed counts is a bar chart with no gap between bars. `RankedBarChart` with `sorted={false}` and `layout="vertical"` is that chart — a separate component would be the same code with a different name.

- [ ] **Step 1: Write `charts/line-chart.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/charts/line-chart.tsx
"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { trendSentence } from "@/lib/analytics/format";
import type { Point } from "@/lib/analytics/types";

interface TrendLineChartProps {
  points: Point[];
  /** Names the measure in the tooltip and in the accessible summary. */
  label: string;
  format: (value: number) => string;
}

export function TrendLineChart({ points, label, format }: TrendLineChartProps) {
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className="h-64 w-full"
      role="img"
      // Built from this chart's own numbers, so it cannot go stale when the
      // host changes the period.
      aria-label={trendSentence(label, points, format)}
    >
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={72}
          tickFormatter={(value: number) => format(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              // The exact value plus the date, as the spec requires.
              labelKey="label"
              formatter={(value) => format(Number(value))}
            />
          }
        />
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

interface DualLineChartProps {
  series: { key: string; label: string; points: Point[] }[];
  format: (value: number) => string;
  summary: string;
}

/** Achieved price against base price: two series over the same buckets. */
export function DualLineChart({ series, format, summary }: DualLineChartProps) {
  if (series.every((s) => s.points.length === 0)) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  // Recharts wants one row per bucket with a column per series.
  const buckets = series[0]?.points ?? [];
  const data = buckets.map((point, index) => ({
    label: point.label,
    ...Object.fromEntries(series.map((s) => [s.key, s.points[index]?.value ?? 0])),
  }));

  const config = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: `var(--chart-${i + 1})` }]),
  );

  return (
    <ChartContainer config={config} className="h-64 w-full" role="img" aria-label={summary}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Write `charts/bar-chart.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/charts/bar-chart.tsx
"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { Category } from "@/lib/analytics/types";

interface RankedBarChartProps {
  rows: Category[];
  label: string;
  format: (value: number) => string;
  /** The accessible summary. Built by the caller, which knows what the bars mean. */
  summary: string;
  /** Lead time keeps the spec's bucket order; everything else sorts descending. */
  sorted?: boolean;
  height?: string;
}

/**
 * Horizontal bars, which is what the spec asks for on every ranked chart — and
 * also what a lead-time histogram of pre-bucketed counts is. A separate
 * histogram component would be this code with a different name.
 */
export function RankedBarChart({
  rows,
  label,
  format,
  summary,
  sorted = true,
  height = "h-64",
}: RankedBarChartProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  const data = sorted ? [...rows].sort((a, b) => b.value - a.value) : rows;

  return (
    <ChartContainer
      config={{ value: { label, color: "var(--chart-1)" } }}
      className={`${height} w-full`}
      role="img"
      aria-label={summary}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={132}
          tickMargin={8}
        />
        <ChartTooltip
          content={<ChartTooltipContent labelKey="label" formatter={(value) => format(Number(value))} />}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 3: Write `charts/stacked-bar.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/charts/stacked-bar.tsx
"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCount } from "@/lib/analytics/format";
import type { UpcomingWindow } from "@/lib/analytics/types";

const config = {
  nightsSold: { label: "Nights sold", color: "var(--chart-1)" },
  nightsAvailable: { label: "Still available", color: "var(--chart-3)" },
};

/**
 * Sold against still-available, per window. Stacking these two is only honest
 * because they add up to the inventory in the window — which is why the
 * derivation subtracts sold from the total rather than reporting both.
 */
export function UpcomingStackedBar({ windows }: { windows: UpcomingWindow[] }) {
  if (windows.every((w) => w.nightsSold + w.nightsAvailable === 0)) {
    return <p className="text-muted-foreground text-sm">No rooms open in the next 90 days.</p>;
  }

  const summary = windows
    .map(
      (w) =>
        `${w.label}: ${formatCount(w.nightsSold)} of ${formatCount(
          w.nightsSold + w.nightsAvailable,
        )} nights sold`,
    )
    .join("; ");

  return (
    <ChartContainer
      config={config}
      className="h-64 w-full"
      role="img"
      aria-label={`Upcoming sell-through. ${summary}.`}
    >
      <BarChart data={windows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={56} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent labelKey="label" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="nightsSold" stackId="nights" fill="var(--color-nightsSold)" radius={[0, 0, 4, 4]} />
        <Bar dataKey="nightsAvailable" stackId="nights" fill="var(--color-nightsAvailable)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 4: Write `ranked-list.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/ranked-list.tsx
import { Progress } from "@/components/ui/progress";
import type { Category } from "@/lib/analytics/types";

interface RankedListProps {
  rows: Category[];
  /** Renders the primary figure — euros for modifiers, a count for countries. */
  format: (value: number) => string;
  /** Labels `count` when a row carries one, e.g. "applied 24 times". */
  countLabel?: (count: number) => string;
  emptyMessage?: string;
}

/**
 * Countries and modifiers: a name, an inline bar for shape, and the figure. The
 * bar is scaled to the largest absolute value so a negative revenue impact —
 * a discount — still draws a bar proportional to the money it moved.
 */
export function RankedList({
  rows,
  format,
  countLabel,
  emptyMessage = "No stays in this period.",
}: RankedListProps) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  const peak = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 tabular-nums">
              {format(row.value)}
              {row.count !== undefined && countLabel ? (
                <span className="ml-2 text-muted-foreground text-xs">
                  {countLabel(row.count)}
                </span>
              ) : null}
            </span>
          </div>
          <Progress
            value={(Math.abs(row.value) / peak) * 100}
            // The figure beside it is the accessible value; the bar is shape.
            aria-hidden
            className="h-1.5"
          />
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add "apps/business/app/(dashboard)/dashboard/analytics/_components"
git commit -m "$(cat <<'MSG'
Add the chart primitives, each carrying its own summary

Every chart takes an aria-label built from its own numbers rather than a
description written once and left to rot as the period changes.

Lead time reuses the ranked bar chart with sorting off: a histogram of
counts that are already bucketed is a bar chart, and a second component
would be the same code under a different name.

The upcoming windows stack sold against still-available, which is only
honest because the derivation subtracts one from the total so the two add
up to the inventory.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 17: The busiest-days table

**Files:**
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/heatmap-table.tsx`

**Interfaces:**
- Consumes: `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow` from `@/components/ui/table`; `Tooltip*`; `Heatmap`, `HeatCell` from `@/lib/analytics/types`; `formatPercent` from `@/lib/analytics/format`.
- Produces: `HeatmapTable`.

**Why a table and not a chart:** shadcn has no heatmap. A weekday bar chart would drop the week dimension the spec defines the widget with; a grouped bar chart keeps it but is unreadable past about eight weeks, and Last 12 months is fifty-two. A Table scrolls, which is how it survives fifty-two columns.

- [ ] **Step 1: Write `heatmap-table.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/heatmap-table.tsx
"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/analytics/format";
import type { Heatmap, HeatCell } from "@/lib/analytics/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Tint is redundant encoding, never the message: the percentage is printed in
 * every cell. Five steps rather than a continuous ramp, because a host reading a
 * grid is comparing bands, not interpolating opacity.
 */
function tintFor(pct: number | null): string {
  if (pct === null) return "bg-muted/40";
  if (pct >= 90) return "bg-(--chart-1)/80 text-background";
  if (pct >= 70) return "bg-(--chart-1)/60";
  if (pct >= 50) return "bg-(--chart-1)/40";
  if (pct >= 25) return "bg-(--chart-1)/20";
  return "bg-(--chart-1)/5";
}

function cellTooltip(cell: HeatCell, weekLabel: string): string {
  if (cell.nightsAvailable === 0) {
    return `${WEEKDAYS[cell.weekday - 1]}, week of ${weekLabel}: no rooms were open.`;
  }
  return `${WEEKDAYS[cell.weekday - 1]}, week of ${weekLabel}: ${cell.nightsSold} of ${cell.nightsAvailable} nights sold, ${formatPercent(cell.pct)} sell-through.`;
}

export function HeatmapTable({ heatmap }: { heatmap: Heatmap }) {
  if (heatmap.weeks.length === 0) {
    return <p className="text-muted-foreground text-sm">No stays in this period.</p>;
  }

  const byKey = new Map(heatmap.cells.map((cell) => [`${cell.weekStart}:${cell.weekday}`, cell]));

  return (
    // Fifty-two weeks on Last 12 months, so the table scrolls and the weekday
    // column stays put. That is the whole reason this is a Table.
    <div className="overflow-x-auto">
      <Table className="w-auto">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Day</TableHead>
            {heatmap.weeks.map((week) => (
              <TableHead key={week.start} className="whitespace-nowrap text-center">
                {week.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {WEEKDAYS.map((weekday, index) => (
            <TableRow key={weekday}>
              <TableCell className="sticky left-0 z-10 bg-card font-medium">
                {weekday}
              </TableCell>
              {heatmap.weeks.map((week) => {
                const cell = byKey.get(`${week.start}:${index + 1}`);
                if (!cell) return <TableCell key={week.start} />;
                return (
                  <TableCell key={week.start} className="p-1 text-center">
                    <Tooltip>
                      <TooltipTrigger
                        className={cn(
                          "w-full rounded-sm px-2 py-1.5 text-xs tabular-nums",
                          tintFor(cell.pct),
                        )}
                      >
                        {/* Printed, always. The tint alone would fail anyone who
                            cannot distinguish the steps. */}
                        {formatPercent(cell.pct, 0)}
                      </TooltipTrigger>
                      <TooltipContent>{cellTooltip(cell, week.label)}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
bun run typecheck
git add "apps/business/app/(dashboard)/dashboard/analytics/_components/heatmap-table.tsx"
git commit -m "$(cat <<'MSG'
Draw the busiest days as a table, because shadcn has no heatmap

A weekday bar chart would have dropped the week dimension the widget is
defined with. A grouped bar chart keeps it and becomes unreadable past
eight weeks, and Last 12 months is fifty-two. A table scrolls, with the
weekday column pinned, which is how it survives that.

The percentage is printed in every cell and the tint is redundant. A grid
that says what it means only in colour says nothing to a host who cannot
tell the steps apart.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 18: Filters, URL state and the page

**Files:**
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/analytics-filters.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/export-button.tsx`
- Modify: `apps/business/app/(dashboard)/dashboard/analytics/page.tsx` (replace the `ComingSoon` stub entirely)

**Interfaces:**
- Consumes: `PERIOD_LABELS`, `PERIOD_PRESETS`, `parsePeriodParams`, `type PeriodPreset` from `@/lib/analytics/period`; `getAnalytics` from `@/lib/analytics/get-analytics`; `sectionCsv`, `csvFilename`, `type SectionId` from `@/lib/analytics/csv`; `getServerSession` from `@/lib/auth`.
- Produces: `AnalyticsFilters`, `ExportButton`, and the page's default export.

- [ ] **Step 1: Write `analytics-filters.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/analytics-filters.tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type PeriodPreset,
} from "@/lib/analytics/period";
import type { IsoDate, PropertySummary } from "@/lib/analytics/types";

interface AnalyticsFiltersProps {
  preset: PeriodPreset;
  range: { from: IsoDate; to: IsoDate };
  properties: PropertySummary[];
  selectedPropertyId: string;
}

const toIso = (date: Date): IsoDate =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The Calendar hands back local Dates; parse back through midday to avoid a
 * timezone shift pushing the selection onto the previous day. */
const fromIso = (value: IsoDate): Date => new Date(`${value}T12:00:00`);

export function AnalyticsFilters({
  preset,
  range,
  properties,
  selectedPropertyId,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  /**
   * Filters live in the URL, so the view is shareable and survives a refresh.
   * Merging into the existing params rather than rebuilding them keeps `demo`
   * and `fail` alive across a filter change.
   */
  const setParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
    },
    [router, searchParams],
  );

  const onPresetChange = (value: string) => {
    const next = value as PeriodPreset;
    setParams(
      next === "custom"
        ? { period: next, from: range.from, to: range.to }
        : { period: next, from: null, to: null },
    );
  };

  const onRangeSelect = (selected: DateRange | undefined) => {
    if (!selected?.from) return;
    setParams({
      period: "custom",
      from: toIso(selected.from),
      to: toIso(selected.to ?? selected.from),
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 px-4 lg:px-6">
      <div className="space-y-1.5">
        <Label htmlFor="analytics-period">Period</Label>
        <Select value={preset} onValueChange={onPresetChange} disabled={pending}>
          <SelectTrigger id="analytics-period" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_PRESETS.map((value) => (
              <SelectItem key={value} value={value}>
                {PERIOD_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preset === "custom" ? (
        <div className="space-y-1.5">
          <Label htmlFor="analytics-range">Dates</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button id="analytics-range" variant="outline" disabled={pending}>
                <CalendarIcon aria-hidden />
                {range.from} → {range.to}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                numberOfMonths={2}
                defaultMonth={fromIso(range.from)}
                selected={{ from: fromIso(range.from), to: fromIso(range.to) }}
                onSelect={onRangeSelect}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {/* Only when there is a choice to make. One property needs no selector. */}
      {properties.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="analytics-property">Property</Label>
          <Select
            value={selectedPropertyId}
            onValueChange={(value) => setParams({ property: value })}
            disabled={pending}
          >
            <SelectTrigger id="analytics-property" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {properties.map((property) => (
                <SelectItem key={property.id} value={property.id}>
                  {property.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Write `export-button.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/export-button.tsx
"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { csvFilename, sectionCsv, type SectionId } from "@/lib/analytics/csv";
import type { AnalyticsData } from "@/lib/analytics/types";

/**
 * Client-side Blob rather than a route handler: the view model is already here,
 * so a round trip could only fetch data that might have moved on and produce a
 * file that disagrees with the screen.
 */
export function ExportButton({
  data,
  section,
  label,
}: {
  data: AnalyticsData;
  section: SectionId;
  label: string;
}) {
  const [busy, setBusy] = React.useState(false);

  const download = () => {
    setBusy(true);
    try {
      const blob = new Blob([sectionCsv(data, section)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = csvFilename(data, section);
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={busy}
      aria-label={`Export ${label} as CSV`}
    >
      <Download aria-hidden />
      Export CSV
    </Button>
  );
}
```

- [ ] **Step 3: Rewrite `page.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/dashboard/site-header";
import { getServerSession } from "@/lib/auth";
import { getAnalytics, listProperties } from "@/lib/analytics/get-analytics";
import { parsePeriodParams } from "@/lib/analytics/period";
import type { IsoDate } from "@/lib/analytics/types";
import { AnalyticsFilters } from "./_components/analytics-filters";
import { AnalyticsSkeleton } from "./_components/analytics-skeleton";
import { BookingsSectionView } from "./_components/bookings-section";
import { GuestsSectionView } from "./_components/guests-section";
import { PricingSectionView } from "./_components/pricing-section";
import { RevenueSectionView } from "./_components/revenue-section";
import { SellThroughSectionView } from "./_components/sell-through-section";
import { DemoBanner, NewPropertyAlert } from "./_components/states";

interface PageProps {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    property?: string;
    demo?: string;
    fail?: string;
  }>;
}

export default function AnalyticsPage({ searchParams }: PageProps) {
  return (
    <>
      <SiteHeader title="Analytics" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="@container/main flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-4 md:gap-6 md:py-6">
            <Suspense fallback={<AnalyticsSkeleton />}>
              <AnalyticsContent searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}

async function AnalyticsContent({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  // Passed in rather than read inside, so every derivation agrees on what day
  // it is and nothing reaches for a bare `new Date()`.
  const today: IsoDate = new Date().toISOString().slice(0, 10);

  // Opt-in, never a fallback. A host must not be shown invented revenue because
  // the real query has not been written yet.
  const demo = params.demo === "1";
  const period = parsePeriodParams(params, today);
  const properties = listProperties(demo);

  const data = await getAnalytics({
    propertyId: params.property,
    period,
    today,
    demo,
    fail: params.fail,
  });

  if (!data.hasAnyBookings) {
    return (
      <>
        {demo ? <DemoBanner /> : null}
        {properties.length > 1 ? (
          <AnalyticsFilters
            preset={period.preset}
            range={data.range}
            properties={properties}
            selectedPropertyId={data.property.id}
          />
        ) : null}
        {/* Sections hidden: there is nothing to arrange yet, and a grid of
            em dashes is not an improvement on a sentence. */}
        <NewPropertyAlert showDemoLink={!demo} />
      </>
    );
  }

  return (
    <>
      {demo ? <DemoBanner /> : null}
      <AnalyticsFilters
        preset={period.preset}
        range={data.range}
        properties={properties}
        selectedPropertyId={data.property.id}
      />
      <RevenueSectionView data={data} />
      <SellThroughSectionView data={data} />
      <BookingsSectionView data={data} />
      <PricingSectionView data={data} />
      <GuestsSectionView data={data} />
    </>
  );
}
```

- [ ] **Step 4: Verify the states by hand**

Start the app (`bun run dev` from `apps/business`, port 3001) and walk these URLs. Task 19 completes the section components, so do this step after Task 19 if the sections do not exist yet.

| URL | Expect |
| --- | --- |
| `/dashboard/analytics` | New-property Alert, "Preview with demo data" link, no sections, no demo banner |
| `/dashboard/analytics?demo=1` | Demo banner, all five sections, Zeeburg Grand selected |
| `?demo=1&property=demo-nieuwehaven` | New-property Alert with the selector still usable |
| `?demo=1&property=demo-vlierhof&period=custom&from=2026-02-01&to=2026-02-14` | "Not enough bookings in this period to show this." on the histogram, heatmap and country list |
| `?demo=1&period=custom&from=2024-01-01&to=2024-01-31` | "No stays in this period." on charts, KPIs at 0 or —, sections still present |
| `?demo=1&fail=revenue.overTime` | One widget shows an error and a Retry; every other widget renders |
| `?demo=1&period=last-12-months` | Monthly buckets, heatmap scrolls horizontally with the weekday column pinned |
| Reload any of the above twice | Identical numbers both times |

- [ ] **Step 5: Commit**

```bash
bun run typecheck
git add "apps/business/app/(dashboard)/dashboard/analytics"
git commit -m "$(cat <<'MSG'
Put the analytics filters in the URL and wire up the page

Period, custom range and property all live in search params, so a view is
shareable and survives a refresh. Filter changes merge into the existing
params rather than rebuilding them, which keeps demo and fail alive.

Today is resolved once, in the page, and passed down. Nothing below
reaches for a bare new Date(), so every widget agrees on what day it is.

The new-property case hides the sections rather than filling them with em
dashes, and links to the demo preview so the tab does not look unbuilt to
a host with no bookings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Task 19: The five sections, and verification

**Files:**
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/section-shell.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/revenue-section.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/sell-through-section.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/bookings-section.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/pricing-section.tsx`
- Create: `apps/business/app/(dashboard)/dashboard/analytics/_components/guests-section.tsx`

**Interfaces:**
- Consumes: `WidgetFrame`, `KpiValue`, `RankedList`, `HeatmapTable`, `TrendLineChart`, `DualLineChart`, `RankedBarChart`, `UpcomingStackedBar`, `ExportButton`; the formatters from `@/lib/analytics/format`.
- Produces: `SectionShell`, and `RevenueSectionView`, `SellThroughSectionView`, `BookingsSectionView`, `PricingSectionView`, `GuestsSectionView` — each taking `{ data: AnalyticsData }`.

**Layout:** KPIs in a responsive grid (`@lg/main:grid-cols-2 @4xl/main:grid-cols-4`), charts below in two columns, full-width for the heatmap. The page uses `@container/main`, already set in `page.tsx`.

- [ ] **Step 1: Write `section-shell.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/section-shell.tsx
import type { ReactNode } from "react";
import type { SectionId } from "@/lib/analytics/csv";
import type { AnalyticsData } from "@/lib/analytics/types";
import { ExportButton } from "./export-button";

/**
 * Heading, export button, content. The export sits in the heading so it is
 * reachable in visual order: a keyboard user tabs the section title, then its
 * export, then into its widgets.
 */
export function SectionShell({
  id,
  title,
  description,
  data,
  children,
}: {
  id: SectionId;
  title: string;
  description: string;
  data: AnalyticsData;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`analytics-${id}`} className="space-y-4 px-4 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`analytics-${id}`} className="font-semibold text-lg">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <ExportButton data={data} section={id} label={title} />
      </div>
      {children}
    </section>
  );
}

export const KpiGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-4 @lg/main:grid-cols-2 @4xl/main:grid-cols-4">{children}</div>
);

export const ChartGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-4 @4xl/main:grid-cols-2">{children}</div>
);
```

- [ ] **Step 2: Write `revenue-section.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/revenue-section.tsx
import { formatCents } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { RankedBarChart } from "./charts/bar-chart";
import { TrendLineChart } from "./charts/line-chart";
import { KpiValue } from "./kpi-card";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function RevenueSectionView({ data }: { data: AnalyticsData }) {
  const { revenue } = data;
  const isEmpty = data.bookingsInPeriod === 0;

  return (
    <SectionShell
      id="revenue"
      title="Revenue"
      description="Net room revenue, excluding VAT, tourist tax and non-room fees, after discounts."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Year to date"
          definition="Net room revenue from 1 January to today. This one ignores the period selector."
          widget={revenue.yearToDateCents}
        >
          {(v) => <KpiValue value={formatCents(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Revenue (selected period)"
          definition="Net room revenue in the selected period, compared with the previous period of the same length."
          widget={revenue.periodCents}
        >
          {(v) => <KpiValue value={formatCents(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Average room price (ADR)"
          definition="Net room revenue divided by nights sold."
          widget={revenue.adrCents}
        >
          {(v) => (
            <KpiValue value={formatCents(v.value)} spark={v.spark} sparkLabel="Revenue" />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="RevPAR"
          definition="Net room revenue divided by nights available — what every room you opened earned on average, sold or not."
          widget={revenue.revparCents}
        >
          {(v) => (
            <KpiValue value={formatCents(v.value)} spark={v.spark} sparkLabel="Revenue" />
          )}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame title="Revenue over time" widget={revenue.overTime} isEmpty={isEmpty}>
          {(points) => (
            <TrendLineChart points={points} label="Revenue" format={formatCents} />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Commission paid"
          definition="OpenBookings' commission: 4.5% of net room revenue."
          widget={revenue.commissionCents}
        >
          {(cents) => <KpiValue value={formatCents(cents)} />}
        </WidgetFrame>

        <WidgetFrame title="Revenue by room type" widget={revenue.byRoomType} isEmpty={isEmpty}>
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Revenue"
              format={formatCents}
              summary={`Revenue by room type. ${rows
                .map((r) => `${r.label} ${formatCents(r.value)}`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>

        <WidgetFrame title="Revenue by rate plan" widget={revenue.byRatePlan} isEmpty={isEmpty}>
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Revenue"
              format={formatCents}
              summary={`Revenue by rate plan. ${rows
                .map((r) => `${r.label} ${formatCents(r.value)}`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>
      </ChartGrid>
    </SectionShell>
  );
}
```

- [ ] **Step 3: Write `sell-through-section.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/sell-through-section.tsx
import { formatCount, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { RankedBarChart } from "./charts/bar-chart";
import { TrendLineChart } from "./charts/line-chart";
import { HeatmapTable } from "./heatmap-table";
import { KpiValue } from "./kpi-card";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function SellThroughSectionView({ data }: { data: AnalyticsData }) {
  const { sellThrough } = data;
  const isEmpty = data.bookingsInPeriod === 0;

  return (
    <SectionShell
      id="sell-through"
      title="Sell-through"
      description="Measured against the inventory you made available on OpenBookings, not your whole property."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Sell-through"
          definition="Nights sold divided by nights available on OpenBookings."
          widget={sellThrough.pct}
        >
          {(v) => <KpiValue value={formatPercent(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Rooms sold"
          definition="Room-nights sold in the selected period."
          widget={sellThrough.roomsSold}
        >
          {(nights) => <KpiValue value={formatCount(nights)} />}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame title="Sell-through over time" widget={sellThrough.overTime} isEmpty={isEmpty}>
          {(points) => (
            <TrendLineChart
              points={points}
              label="Sell-through"
              format={(v) => formatPercent(v)}
            />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Sell-through by room type"
          widget={sellThrough.byRoomType}
          isEmpty={isEmpty}
        >
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Sell-through"
              format={(v) => formatPercent(v)}
              summary={`Sell-through by room type. ${rows
                .map((r) => `${r.label} ${formatPercent(r.value)}`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>
      </ChartGrid>

      <WidgetFrame
        title="Busiest days of the week"
        definition="Sell-through per weekday, one column per week in the period."
        widget={sellThrough.busiestDays}
        bookingsInPeriod={data.bookingsInPeriod}
        requiresDetail
      >
        {(heatmap) => <HeatmapTable heatmap={heatmap} />}
      </WidgetFrame>
    </SectionShell>
  );
}
```

- [ ] **Step 4: Write `bookings-section.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/bookings-section.tsx
import { formatCount, formatNights, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { RankedBarChart } from "./charts/bar-chart";
import { UpcomingStackedBar } from "./charts/stacked-bar";
import { KpiValue } from "./kpi-card";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function BookingsSectionView({ data }: { data: AnalyticsData }) {
  const { bookings } = data;

  return (
    <SectionShell
      id="bookings"
      title="Bookings"
      description="Bookings created in the selected period, cancelled ones included."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Number of bookings"
          definition="Bookings created in the period. Cancelled bookings are counted here."
          widget={bookings.count}
        >
          {(v) => <KpiValue value={formatCount(v.value)} delta={v.delta} />}
        </WidgetFrame>

        <WidgetFrame
          title="Average length of stay"
          definition="Average nights per booking. Cancelled bookings are excluded — they never stayed."
          widget={bookings.averageLengthOfStay}
        >
          {(nights) => <KpiValue value={formatNights(nights)} />}
        </WidgetFrame>

        <WidgetFrame
          title="Cancellations"
          definition="Bookings made in this period that were later cancelled, as a count and a share."
          widget={bookings.cancellations}
        >
          {(v) => (
            <KpiValue
              value={`${formatCount(v.count)} (${formatPercent(v.value)})`}
              delta={v.delta}
            />
          )}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame
          title="Lead time"
          definition="Days between a booking being made and its check-in date."
          widget={bookings.leadTime}
          bookingsInPeriod={data.bookingsInPeriod}
          requiresDetail
        >
          {(rows) => (
            <RankedBarChart
              rows={rows}
              label="Bookings"
              format={(v) => formatCount(v)}
              sorted={false}
              summary={`Lead time. ${rows
                .map((r) => `${r.label}: ${formatCount(r.value)} bookings`)
                .join(", ")}.`}
            />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Upcoming 30 / 60 / 90 days"
          definition="Always measured from today, whatever period is selected."
          widget={bookings.upcoming}
        >
          {(windows) => <UpcomingStackedBar windows={windows} />}
        </WidgetFrame>
      </ChartGrid>
    </SectionShell>
  );
}
```

- [ ] **Step 5: Write `pricing-section.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/pricing-section.tsx
import { formatCents, formatCount, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { DualLineChart } from "./charts/line-chart";
import { KpiValue } from "./kpi-card";
import { RankedList } from "./ranked-list";
import { ChartGrid, KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function PricingSectionView({ data }: { data: AnalyticsData }) {
  const { pricing } = data;
  const isEmpty = data.bookingsInPeriod === 0;

  return (
    <SectionShell
      id="pricing"
      title="Pricing"
      description="Base price is the rate plan's price for that night before modifiers. Achieved price is what was actually paid, net."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Average discount given"
          definition="The gap between base price and achieved price, weighted by nights sold. A surcharge shows as a negative discount."
          widget={pricing.averageDiscountPct}
        >
          {(value) => <KpiValue value={formatPercent(value)} />}
        </WidgetFrame>
      </KpiGrid>

      <ChartGrid>
        <WidgetFrame
          title="Achieved price vs. base price"
          widget={pricing.priceOverTime}
          isEmpty={isEmpty}
        >
          {(v) => (
            <DualLineChart
              series={[
                { key: "base", label: "Base price", points: v.base },
                { key: "achieved", label: "Achieved price", points: v.achieved },
              ]}
              format={formatCents}
              summary={buildPriceSummary(v)}
            />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Most-used discounts & modifiers"
          definition="Ranked by how much money each moved, in either direction."
          widget={pricing.topModifiers}
        >
          {(rows) => (
            <RankedList
              rows={rows}
              format={formatCents}
              countLabel={(count) => `applied ${formatCount(count)}×`}
            />
          )}
        </WidgetFrame>
      </ChartGrid>
    </SectionShell>
  );
}

/** Summarises both lines at once, since the point of the chart is the gap. */
function buildPriceSummary(v: {
  base: { value: number; label: string }[];
  achieved: { value: number; label: string }[];
}): string {
  if (v.base.length === 0) return "Base and achieved price have no data in this period.";
  const last = v.base.length - 1;
  return `Base against achieved price. Base moved from ${formatCents(v.base[0].value)} to ${formatCents(
    v.base[last].value,
  )}; achieved moved from ${formatCents(v.achieved[0].value)} to ${formatCents(
    v.achieved[last].value,
  )}.`;
}
```

- [ ] **Step 6: Write `guests-section.tsx`**

```tsx
// apps/business/app/(dashboard)/dashboard/analytics/_components/guests-section.tsx
import { formatCount, formatPercent } from "@/lib/analytics/format";
import type { AnalyticsData } from "@/lib/analytics/types";
import { KpiValue } from "./kpi-card";
import { RankedList } from "./ranked-list";
import { KpiGrid, SectionShell } from "./section-shell";
import { WidgetFrame } from "./widget-frame";

export function GuestsSectionView({ data }: { data: AnalyticsData }) {
  const { guests } = data;

  return (
    <SectionShell
      id="guests"
      title="Guests"
      description="Countries with fewer than five bookings are grouped as Other, so no single guest can be identified."
      data={data}
    >
      <KpiGrid>
        <WidgetFrame
          title="Average party size"
          definition="Average guests per booking, adults and children together."
          widget={guests.averagePartySize}
        >
          {(size) => (
            <KpiValue value={size === null ? "—" : size.toFixed(1)} />
          )}
        </WidgetFrame>

        <WidgetFrame
          title="Repeat guests"
          definition="Share of bookings from guests who had stayed with you before — measured across all your history, not just this period."
          widget={guests.repeatGuestPct}
        >
          {(pct) => <KpiValue value={formatPercent(pct)} />}
        </WidgetFrame>
      </KpiGrid>

      <WidgetFrame
        title="Country of origin"
        definition="Bookings per country. Countries with fewer than five bookings are grouped as Other."
        widget={guests.countries}
        bookingsInPeriod={data.bookingsInPeriod}
        requiresDetail
      >
        {(rows) => (
          <RankedList rows={rows} format={(count) => `${formatCount(count)} bookings`} />
        )}
      </WidgetFrame>
    </SectionShell>
  );
}
```

- [ ] **Step 7: Run every test and the typechecker**

```bash
bun test lib/analytics/
bun run typecheck
bun run lint
```

Expected: all suites pass, no type errors, no lint errors. The vocabulary test now walks the finished components as well as the library, so it is a real check rather than a trivially satisfied one.

- [ ] **Step 8: Walk the states table from Task 18 Step 4**

Every row must behave as written. Note in particular:
- Reload twice and confirm the figures are byte-identical.
- With `?demo=1&period=last-12-months`, the heatmap scrolls horizontally and the weekday column stays pinned.
- Tab through a section: heading, Export CSV, then the widgets, with the definition tooltips reachable.
- Export a CSV from each section and check the totals against the screen.

- [ ] **Step 9: Confirm the acceptance criteria**

Tick these off against the spec before opening the pull request:

- [ ] Only shadcn/ui components used; the only new package is recharts, via shadcn Chart
- [ ] All widgets in sections 1–5 render from the demo data
- [ ] The UI says "sell-through", never "occupancy" (the vocabulary test proves it)
- [ ] Numbers agree with each other (the reconciliation suite proves it)
- [ ] Numbers are identical across refreshes
- [ ] Countries under five bookings fold into "Other", on screen and in the CSV
- [ ] No component imports anything under `lib/analytics/demo/` or `lib/analytics/derive/` — verify with `grep -rn "analytics/demo\|analytics/derive" "app/(dashboard)/dashboard/analytics"`, which must return nothing but the import of `types` and `format`
- [ ] CSV export matches the screen for the same filters
- [ ] Filters persist in the URL
- [ ] Every row of the States table is reachable with the demo properties

- [ ] **Step 10: Commit**

```bash
git add "apps/business/app/(dashboard)/dashboard/analytics"
git commit -m "$(cat <<'MSG'
Assemble the five analytics sections

Each widget states its own definition in a tooltip, because a host reading
RevPAR beside ADR needs to know which denominator each one used before the
numbers mean anything.

The export button sits in the section heading, so tab order runs heading,
export, widgets rather than stranding the export after twenty charts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014coMQWksUm8bpHawZJo9Vw
MSG
)"
```

---

## Notes for whoever lands the real queries

The only file that changes is `lib/analytics/get-analytics.ts`. Replace the
`generateFacts` call with queries that return the same two arrays, over the same
window `factWindow()` computes. The spec's "The seam" table maps every field to
its source. Three things to carry over:

1. **Cents.** The schema stores whole euros; multiply by 100 where facts are
   built, which is where `generateFacts` does it today.
2. **`guestCountry` has no source.** It needs a column on `bookings`, or
   derivation from the payment method's country at the Stripe edge. Until then
   that one widget cannot light up.
3. **`Widget<T>` stops being defensive.** Wrap each aggregate query
   independently, so one failing query degrades one widget rather than the page.

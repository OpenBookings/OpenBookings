import { describe, expect, test } from "bun:test";
import { factsWindow, getPageData, isDemoParam } from "./get-analytics";
import { guestWindow } from "./guest-details";
import { addDays } from "./period";
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
      expect(data).toMatchObject({ page, isDemo: false, hasAnyBookings: false, periodHasBookings: false, comparison: null });
      expect(numbers(data).every(Number.isFinite)).toBe(true);
    }
  });

  test("demo fills every page", async () => {
    for (const page of PAGE_IDS) {
      const data = await getPageData(page, query());
      expect(data).toMatchObject({ page, isDemo: true, hasAnyBookings: true, periodHasBookings: true, compare: "previous" });
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
    expect(data.periodHasBookings).toBe(false);
    expect(data.comparison).toBeNull();
    expect(value(data.view.revenue)).toEqual({ value: 0, delta: null });
    expect(data.view.overTime).toMatchObject({ ok: true, sample: 0 });
  });

  test("a range entirely in the future: nothing booked in it yet, but nights already sold", async () => {
    const future = custom("2026-11-01", "2026-11-30");
    const revenue = await getPageData("revenue", query({ period: future }));
    expect(value(revenue.view.revenue).value).toBe(0);
    expect(revenue.view.revenue).toMatchObject({ sample: 0 });
    // Stays in the period count, so the page is not treated as filtered to nothing.
    expect(revenue.periodHasBookings).toBe(true);

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

describe("factsWindow", () => {
  test("covers period, comparison, 90 days ahead, and guest window only on guests", () => {
    const period = custom("2026-08-01", "2026-08-31");
    const base = factsWindow("revenue", query({ period, compare: "last-year" }));
    expect(base.from <= "2025-08-01").toBe(true);
    expect(base.to).toBe(addDays(TODAY, 90));
    const guests = factsWindow("guests", query({ period, compare: "none" }));
    expect(guests.from).toBe(guestWindow(TODAY).from);
    expect(factsWindow("booking-patterns", query({ period, compare: "none" })).from).toBe("2026-07-01"); // the previous period
  });

  test("revenue reaches back to year to date, and last year's when comparing", () => {
    const period = custom("2026-08-01", "2026-08-31");
    expect(factsWindow("revenue", query({ period, compare: "none" })).from).toBe("2026-01-01");
    expect(factsWindow("revenue", query({ period, compare: "previous" })).from).toBe("2025-01-01");
  });

  test("occupancy reaches back a year of weeks for pace", () => {
    const period = custom("2026-08-01", "2026-08-31");
    expect(factsWindow("occupancy", query({ period, compare: "none" })).from).toBe(addDays(TODAY, -364));
  });
});

describe("getPageData with a source", () => {
  const empty = { bookings: [], inventory: [], nights: [], roomTypeNames: {}, ratePlanNames: {} };
  test("never-booked uses whole-hotel facts", async () => {
    const data = await getPageData("revenue", query({ demo: false }), async () => ({
      facts: empty, earliest: "2024-01-01", hasAnyBookings: true, guestWindowStart: null,
    }));
    expect(data.hasAnyBookings).toBe(true);
    expect(data.periodHasBookings).toBe(false);
  });
  test("last-year comparison uses the source's earliest date", async () => {
    const src = (earliest: string | null) => async () => ({
      facts: empty, earliest, hasAnyBookings: true, guestWindowStart: null,
    });
    const yes = await getPageData("revenue", query({ demo: false, compare: "last-year" }), src("2024-01-01"));
    expect(yes.canCompareLastYear).toBe(true);
    const no = await getPageData("revenue", query({ demo: false, compare: "last-year" }), src("2026-09-01"));
    expect(no.canCompareLastYear).toBe(false);
  });
  test("demo ignores the source", async () => {
    let called = false;
    const data = await getPageData("revenue", query(), async () => {
      called = true;
      return { facts: empty, earliest: null, hasAnyBookings: false, guestWindowStart: null };
    });
    expect(called).toBe(false);
    expect(data.hasAnyBookings).toBe(true);
  });
});

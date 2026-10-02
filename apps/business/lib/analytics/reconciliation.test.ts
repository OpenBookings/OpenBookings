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

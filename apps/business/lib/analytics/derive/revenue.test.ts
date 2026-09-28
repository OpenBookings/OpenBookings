import { describe, expect, test } from "bun:test";
import type { Category, Facts, NightFact } from "../types";
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
  return (w as unknown as { value: T }).value;
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
    expect(value<Category[]>(section.byRoomType)).toEqual([
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

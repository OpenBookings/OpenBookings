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
  return (w as unknown as { value: T }).value;
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

import { describe, expect, test } from "bun:test";
import type { Facts, NightFact } from "../types";
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
  return (w as unknown as { value: T }).value;
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
    const rows = value<{ key: string; label: string; value: number }[]>(section.byRoomType);
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

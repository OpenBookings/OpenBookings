import { describe, expect, test } from "bun:test";
import { splitVat } from "./vat-split";

const base = {
  country: "NL",
  type: "hotel" as const,
  includesBreakfast: true,
  breakfastValueCents: 1800,
  people: 3,
};

describe("splitVat", () => {
  test("NL night €195, breakfast €18 × 3 people", () => {
    const split = splitVat({ ...base, nights: [{ date: "2026-12-11", priceCents: 19500 }] });
    expect(split?.nights).toEqual([
      {
        date: "2026-12-11",
        room: { grossCents: 14100, rate: 21, vatCents: 2447 },
        breakfast: { grossCents: 5400, rate: 9, vatCents: 446 },
      },
    ]);
    expect(split?.totals).toEqual([
      { part: "accommodation", grossCents: 14100, rate: 21, vatCents: 2447 },
      { part: "breakfast", grossCents: 5400, rate: 9, vatCents: 446 },
    ]);
    expect(split?.breakfastValueMissing).toBe(false);
  });

  test("breakfast capped at the night price", () => {
    const split = splitVat({ ...base, people: 4, nights: [{ date: "2026-12-11", priceCents: 4000 }] });
    expect(split?.nights[0].breakfast?.grossCents).toBe(4000);
    expect(split?.nights[0].room).toEqual({ grossCents: 0, rate: 21, vatCents: 0 });
  });

  test("stay across 1 Jan 2026", () => {
    const split = splitVat({
      ...base,
      includesBreakfast: false,
      nights: [
        { date: "2025-12-31", priceCents: 10000 },
        { date: "2026-01-01", priceCents: 10000 },
      ],
    });
    expect(split?.nights.map((night) => night.room.rate)).toEqual([9, 21]);
    expect(split?.totals.filter((total) => total.part === "accommodation")).toEqual([
      { part: "accommodation", grossCents: 10000, rate: 9, vatCents: 826 },
      { part: "accommodation", grossCents: 10000, rate: 21, vatCents: 1736 },
    ]);
  });

  test("rate without breakfast", () => {
    const split = splitVat({
      ...base,
      includesBreakfast: false,
      nights: [
        { date: "2026-12-11", priceCents: 12000 },
        { date: "2026-12-12", priceCents: 13000 },
      ],
    });
    expect(split?.nights.every((night) => night.breakfast === null)).toBe(true);
    expect(split?.nights.map((night) => night.room.grossCents)).toEqual([12000, 13000]);
    expect(split?.breakfastValueMissing).toBe(false);
  });

  test("breakfast rate, no value", () => {
    const split = splitVat({ ...base, breakfastValueCents: null, nights: [{ date: "2026-12-11", priceCents: 19500 }] });
    expect(split?.nights[0]).toEqual({
      date: "2026-12-11",
      room: { grossCents: 19500, rate: 21, vatCents: 3384 },
      breakfast: null,
    });
    expect(split?.breakfastValueMissing).toBe(true);
  });

  test("a free night still has a room part", () => {
    const split = splitVat({ ...base, includesBreakfast: false, nights: [{ date: "2026-12-11", priceCents: 0 }] });
    expect(split?.nights[0].room).toEqual({ grossCents: 0, rate: 21, vatCents: 0 });
  });

  test("unknown country", () => {
    expect(splitVat({ ...base, country: "US", nights: [{ date: "2026-12-11", priceCents: 19500 }] })).toBeNull();
  });

  test("a night before the table starts", () => {
    expect(
      splitVat({
        ...base,
        nights: [
          { date: "2018-12-31", priceCents: 10000 },
          { date: "2019-01-01", priceCents: 10000 },
        ],
      }),
    ).toBeNull();
  });

  test("totals equal the sum of the nights", () => {
    const split = splitVat({
      ...base,
      people: 2,
      breakfastValueCents: 1750,
      nights: [
        { date: "2025-12-30", priceCents: 13333 },
        { date: "2025-12-31", priceCents: 14999 },
        { date: "2026-01-01", priceCents: 18917 },
        { date: "2026-01-02", priceCents: 20101 },
      ],
    });
    expect(split).not.toBeNull();
    const parts = split!.nights.flatMap((night) => [
      { part: "accommodation", ...night.room },
      ...(night.breakfast ? [{ part: "breakfast", ...night.breakfast }] : []),
    ]);
    // NL: room 9 then 21; breakfast 9 throughout.
    expect(split!.totals.map((total) => `${total.part} ${total.rate}`)).toEqual([
      "accommodation 9",
      "accommodation 21",
      "breakfast 9",
    ]);
    for (const total of split!.totals) {
      const matching = parts.filter((p) => p.part === total.part && p.rate === total.rate);
      expect(total.grossCents).toBe(matching.reduce((sum, p) => sum + p.grossCents, 0));
      expect(total.vatCents).toBe(matching.reduce((sum, p) => sum + p.vatCents, 0));
    }
    const nightsGross = split!.nights.reduce((sum, n) => sum + n.room.grossCents + (n.breakfast?.grossCents ?? 0), 0);
    expect(nightsGross).toBe(13333 + 14999 + 18917 + 20101);
  });

  test("€186.50 at 9% sums back to 18650, every part in whole cents", () => {
    // NL in 2025: room and breakfast both 9%. Two nights at €93.25, breakfast €18 × 2.
    const split = splitVat({
      ...base,
      people: 2,
      nights: [
        { date: "2025-12-30", priceCents: 9325 },
        { date: "2025-12-31", priceCents: 9325 },
      ],
    });
    expect(split!.nights[0]).toEqual({
      date: "2025-12-30",
      room: { grossCents: 5725, rate: 9, vatCents: 473 },
      breakfast: { grossCents: 3600, rate: 9, vatCents: 297 },
    });
    expect(split!.totals.reduce((sum, t) => sum + t.grossCents, 0)).toBe(18650);
    for (const t of split!.totals) {
      expect(Number.isInteger(t.grossCents)).toBe(true);
      expect(Number.isInteger(t.vatCents)).toBe(true);
    }

    const whole = splitVat({ ...base, includesBreakfast: false, nights: [{ date: "2025-12-31", priceCents: 18650 }] });
    // 18650 × 9 / 109 = 1539.9…, rounded half up.
    expect(whole!.totals).toEqual([{ part: "accommodation", grossCents: 18650, rate: 9, vatCents: 1540 }]);
  });
});

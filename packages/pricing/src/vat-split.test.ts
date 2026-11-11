import { describe, expect, test } from "bun:test";
import { splitVat } from "./vat-split";

const base = {
  country: "NL",
  type: "hotel" as const,
  includesBreakfast: true,
  breakfastValue: 18,
  people: 3,
};

const round2 = (value: number) => Math.round(value * 100) / 100;

describe("splitVat", () => {
  test("NL night €195, breakfast €18 × 3 people", () => {
    const split = splitVat({ ...base, nights: [{ date: "2026-12-11", price: 195 }] });
    expect(split?.nights).toEqual([
      {
        date: "2026-12-11",
        room: { gross: 141, rate: 21, vat: 24.47 },
        breakfast: { gross: 54, rate: 9, vat: 4.46 },
      },
    ]);
    expect(split?.totals).toEqual([
      { part: "accommodation", gross: 141, rate: 21, vat: 24.47 },
      { part: "breakfast", gross: 54, rate: 9, vat: 4.46 },
    ]);
    expect(split?.breakfastValueMissing).toBe(false);
  });

  test("breakfast capped at the night price", () => {
    const split = splitVat({ ...base, people: 4, nights: [{ date: "2026-12-11", price: 40 }] });
    expect(split?.nights[0].breakfast?.gross).toBe(40);
    expect(split?.nights[0].room).toEqual({ gross: 0, rate: 21, vat: 0 });
  });

  test("stay across 1 Jan 2026", () => {
    const split = splitVat({
      ...base,
      includesBreakfast: false,
      nights: [
        { date: "2025-12-31", price: 100 },
        { date: "2026-01-01", price: 100 },
      ],
    });
    expect(split?.nights.map((night) => night.room.rate)).toEqual([9, 21]);
    expect(split?.totals.filter((total) => total.part === "accommodation")).toEqual([
      { part: "accommodation", gross: 100, rate: 9, vat: 8.26 },
      { part: "accommodation", gross: 100, rate: 21, vat: 17.36 },
    ]);
  });

  test("rate without breakfast", () => {
    const split = splitVat({
      ...base,
      includesBreakfast: false,
      nights: [
        { date: "2026-12-11", price: 120 },
        { date: "2026-12-12", price: 130 },
      ],
    });
    expect(split?.nights.every((night) => night.breakfast === null)).toBe(true);
    expect(split?.nights.map((night) => night.room.gross)).toEqual([120, 130]);
    expect(split?.breakfastValueMissing).toBe(false);
  });

  test("breakfast rate, no value", () => {
    const split = splitVat({ ...base, breakfastValue: null, nights: [{ date: "2026-12-11", price: 195 }] });
    expect(split?.nights[0]).toEqual({
      date: "2026-12-11",
      room: { gross: 195, rate: 21, vat: 33.84 },
      breakfast: null,
    });
    expect(split?.breakfastValueMissing).toBe(true);
  });

  test("a free night still has a room part", () => {
    const split = splitVat({ ...base, includesBreakfast: false, nights: [{ date: "2026-12-11", price: 0 }] });
    expect(split?.nights[0].room).toEqual({ gross: 0, rate: 21, vat: 0 });
  });

  test("unknown country", () => {
    expect(splitVat({ ...base, country: "US", nights: [{ date: "2026-12-11", price: 195 }] })).toBeNull();
  });

  test("a night before the table starts", () => {
    expect(
      splitVat({
        ...base,
        nights: [
          { date: "2018-12-31", price: 100 },
          { date: "2019-01-01", price: 100 },
        ],
      }),
    ).toBeNull();
  });

  test("totals equal the sum of the nights", () => {
    const split = splitVat({
      ...base,
      people: 2,
      breakfastValue: 17.5,
      nights: [
        { date: "2025-12-30", price: 133.33 },
        { date: "2025-12-31", price: 149.99 },
        { date: "2026-01-01", price: 189.17 },
        { date: "2026-01-02", price: 201.01 },
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
      expect(total.gross).toBe(round2(matching.reduce((sum, p) => sum + p.gross, 0)));
      expect(total.vat).toBe(round2(matching.reduce((sum, p) => sum + p.vat, 0)));
    }
    const nightsGross = round2(split!.nights.reduce((sum, n) => sum + n.room.gross + (n.breakfast?.gross ?? 0), 0));
    expect(nightsGross).toBe(round2(133.33 + 149.99 + 189.17 + 201.01));
  });
});

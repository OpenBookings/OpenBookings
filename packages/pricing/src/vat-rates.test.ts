import { describe, expect, test } from "bun:test";
import { EUROZONE, VAT_RATES, vatRatesFor } from "./vat-rates";

describe("VAT_RATES", () => {
  test("covers the 21 eurozone countries", () => {
    expect(EUROZONE).toHaveLength(21);
    for (const country of EUROZONE) {
      expect(VAT_RATES.some((row) => row.country === country)).toBe(true);
    }
  });

  test("every row cites an https source", () => {
    for (const row of VAT_RATES) {
      expect(row.source.startsWith("https://")).toBe(true);
    }
  });

  test("a country never has two rows from the same date", () => {
    const keys = VAT_RATES.map((row) => `${row.country}|${row.type}|${row.from}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("vatRatesFor", () => {
  test("NL before 2026: 9% room, 9% breakfast", () => {
    expect(vatRatesFor("NL", "hotel", "2025-12-31")).toEqual({ accommodation: 9, breakfast: 9 });
  });

  test("NL from 2026: 21% room, 9% breakfast", () => {
    expect(vatRatesFor("NL", "hotel", "2026-01-01")).toEqual({ accommodation: 21, breakfast: 9 });
  });

  test("picks up mid-year changes", () => {
    expect(vatRatesFor("IE", "hotel", "2026-06-30")).toEqual({ accommodation: 13.5, breakfast: 13.5 });
    expect(vatRatesFor("IE", "hotel", "2026-07-01")).toEqual({ accommodation: 13.5, breakfast: 9 });
    expect(vatRatesFor("BE", "hotel", "2026-03-01")).toEqual({ accommodation: 12, breakfast: 12 });
  });

  test("a country outside the eurozone has no rates", () => {
    expect(vatRatesFor("US", "hotel", "2026-06-01")).toBeNull();
  });

  test("a date before the first row has no rates", () => {
    expect(vatRatesFor("NL", "hotel", "2018-12-31")).toBeNull();
  });
});

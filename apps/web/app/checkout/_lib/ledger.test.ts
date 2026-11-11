import { describe, expect, test } from "bun:test";
import { buildLedger, formatMoney, type LedgerRoom } from "./ledger";

const nights = (prices: number[], start = "2031-11-07") =>
  prices.map((price, i) => ({ date: `2031-11-${String(7 + i).padStart(2, "0")}`, price }));

const concept: LedgerRoom = {
  roomName: "Garden Suite",
  rateNights: nights([185, 185, 185]),
  extraGuests: [{ kind: "child", count: 1, per_night: 15, nights: 3, amount: 45 }],
  discount: { label: "Stay 3 nights, save 10%", amount: 60 },
  touristTaxLines: [{ label: "€4.20 per person per night", amount: 37.8, effectiveFrom: "2026-01-01" }],
  payAtPropertyLines: [
    { label: "Extra beds", count: 1, fee_per_night: 25, nights: 3, amount: 75 },
    { label: "Cots", count: 1, fee_per_night: 0, nights: 3, amount: 0 },
  ],
};

describe("buildLedger", () => {
  test("concept example adds up", () => {
    const ledger = buildLedger([concept], "Hotel Rosa", 57780);
    expect(ledger).not.toBeNull();
    expect(ledger!.rows.map((r) => r.amount)).toEqual([555, 45, -60, 37.8]);
    expect(ledger!.rows.map((r) => r.kind)).toEqual(["stay", "extra", "discount", "tax"]);
    expect(ledger!.rows[0]).toMatchObject({ label: "Garden Suite · 3 nights", detail: "€185 × 3 nights" });
    expect(ledger!.rows[1]).toMatchObject({ label: "Extra child (2–12)", detail: "€15 × 3 nights" });
    expect(ledger!.rows[2]!.label).toBe("Stay 3 nights, save 10%");
    expect(ledger!.payNow).toBe(577.8);
    expect(ledger!.atProperty).toEqual({
      label: "At the property",
      detail: "Extra bed €25 × 3 nights · cot free",
      amount: 75,
    });
    expect(ledger!.totalForStay).toBe(652.8);
  });

  test("one cent off returns null", () => {
    expect(buildLedger([concept], "Hotel Rosa", 57781)).toBeNull();
  });

  test("empty rateNights returns null", () => {
    expect(buildLedger([{ ...concept, rateNights: [] }], "Hotel Rosa", 57780)).toBeNull();
  });

  test("no extras: atProperty null and total equals payNow", () => {
    const room: LedgerRoom = { ...concept, extraGuests: [], discount: null, touristTaxLines: [], payAtPropertyLines: [] };
    const ledger = buildLedger([room], "Hotel Rosa", 55500)!;
    expect(ledger.atProperty).toBeNull();
    expect(ledger.totalForStay).toBe(ledger.payNow);
    expect(ledger.rows).toHaveLength(1);
  });

  test("equal nights collapse, unequal nights list weekdays", () => {
    const equal = buildLedger([{ ...concept, extraGuests: [], discount: null, touristTaxLines: [], payAtPropertyLines: [] }], "H", 55500)!;
    expect(equal.rows[0]!.detail).toBe("€185 × 3 nights");
    // 2031-11-07 is a Friday
    const unequal = buildLedger(
      [{ ...concept, rateNights: nights([195, 195, 165]), extraGuests: [], discount: null, touristTaxLines: [], payAtPropertyLines: [] }],
      "H",
      55500,
    )!;
    expect(unequal.rows[0]!.detail).toBe("Fri €195 · Sat €195 · Sun €165");
  });

  test("two rooms list in pick order", () => {
    const attic: LedgerRoom = {
      roomName: "Attic",
      rateNights: nights([90, 90]),
      extraGuests: [],
      discount: null,
      touristTaxLines: [],
      payAtPropertyLines: [{ label: "Cots", count: 2, fee_per_night: 10, nights: 2, amount: 40 }],
    };
    const ledger = buildLedger([concept, attic], "H", 57780 + 18000)!;
    expect(ledger.rows.map((r) => r.label)).toEqual([
      "Garden Suite · 3 nights",
      "Extra child (2–12)",
      "Stay 3 nights, save 10%",
      "Tourist tax",
      "Attic · 2 nights",
    ]);
    expect(ledger.atProperty!.amount).toBe(115);
    expect(ledger.atProperty!.detail).toBe("Extra bed €25 × 3 nights · cot free · 2 cots €10 × 2 nights");
  });
});

describe("formatMoney", () => {
  test("euro, two decimals, real minus", () => {
    expect(formatMoney(555)).toBe("€555.00");
    expect(formatMoney(-60)).toBe("−€60.00");
  });
});

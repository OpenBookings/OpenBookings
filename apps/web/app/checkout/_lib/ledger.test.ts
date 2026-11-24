import { describe, expect, test } from "bun:test";
import { buildLedger, type LedgerRoom } from "./ledger";

const nights = (prices: number[]) =>
  prices.map((priceCents, i) => ({ date: `2031-11-${String(7 + i).padStart(2, "0")}`, priceCents }));

const concept: LedgerRoom = {
  roomName: "Garden Suite",
  rateNights: nights([18500, 18500, 18500]),
  extraGuests: [{ kind: "child", count: 1, perNightCents: 1500, nights: 3, amountCents: 4500 }],
  discount: { label: "Stay 3 nights, save 10%", amountCents: 6000 },
  touristTaxLines: [{ label: "€4.20 per person per night", amountCents: 3780, effectiveFrom: "2026-01-01" }],
  payAtPropertyLines: [
    { label: "Extra beds", count: 1, feePerNightCents: 2500, nights: 3, amountCents: 7500 },
    { label: "Cots", count: 1, feePerNightCents: 0, nights: 3, amountCents: 0 },
  ],
};

describe("buildLedger", () => {
  test("concept example adds up", () => {
    const ledger = buildLedger([concept], "Hotel Rosa", 57780);
    expect(ledger).not.toBeNull();
    expect(ledger!.rows.map((r) => r.amountCents)).toEqual([55500, 4500, -6000, 3780]);
    expect(ledger!.rows.map((r) => r.kind)).toEqual(["stay", "extra", "discount", "tax"]);
    expect(ledger!.rows[0]).toMatchObject({ label: "Garden Suite · 3 nights", detail: "€185 × 3 nights" });
    expect(ledger!.rows[1]).toMatchObject({ label: "Extra child (2–12)", detail: "€15 × 3 nights" });
    expect(ledger!.rows[2]!.label).toBe("Stay 3 nights, save 10%");
    expect(ledger!.payNowCents).toBe(57780);
    expect(ledger!.atProperty).toEqual({
      label: "At the property",
      detail: "Extra bed €25 × 3 nights · cot free",
      amountCents: 7500,
    });
    expect(ledger!.totalForStayCents).toBe(65280);
  });

  test("one cent off returns null", () => {
    expect(buildLedger([concept], "Hotel Rosa", 57781)).toBeNull();
    expect(buildLedger([concept], "Hotel Rosa", 57779)).toBeNull();
  });

  test("empty rateNights returns null", () => {
    expect(buildLedger([{ ...concept, rateNights: [] }], "Hotel Rosa", 57780)).toBeNull();
  });

  test("no extras: atProperty null and total equals payNow", () => {
    const room: LedgerRoom = { ...concept, extraGuests: [], discount: null, touristTaxLines: [], payAtPropertyLines: [] };
    const ledger = buildLedger([room], "Hotel Rosa", 55500)!;
    expect(ledger.atProperty).toBeNull();
    expect(ledger.totalForStayCents).toBe(ledger.payNowCents);
    expect(ledger.rows).toHaveLength(1);
  });

  test("equal nights collapse, unequal nights list weekdays", () => {
    const equal = buildLedger([{ ...concept, extraGuests: [], discount: null, touristTaxLines: [], payAtPropertyLines: [] }], "H", 55500)!;
    expect(equal.rows[0]!.detail).toBe("€185 × 3 nights");
    // 2031-11-07 is a Friday
    const unequal = buildLedger(
      [{ ...concept, rateNights: nights([19500, 19500, 16500]), extraGuests: [], discount: null, touristTaxLines: [], payAtPropertyLines: [] }],
      "H",
      55500,
    )!;
    expect(unequal.rows[0]!.detail).toBe("Fri €195 · Sat €195 · Sun €165");
  });

  test("unit prices with cents keep them", () => {
    const room: LedgerRoom = {
      ...concept,
      rateNights: nights([9325, 9325]),
      extraGuests: [{ kind: "adult", count: 1, perNightCents: 1250, nights: 2, amountCents: 2500 }],
      discount: null,
      touristTaxLines: [{ label: "6.5% of the room price", amountCents: 1212, effectiveFrom: "2026-01-01" }],
      payAtPropertyLines: [{ label: "Cots", count: 1, feePerNightCents: 750, nights: 2, amountCents: 1500 }],
    };
    const ledger = buildLedger([room], "H", 18650 + 2500 + 1212)!;
    expect(ledger.rows.map((r) => [r.detail, r.amountCents])).toEqual([
      ["€93.25 × 2 nights", 18650],
      ["€12.50 × 2 nights", 2500],
      ["6.5% of the room price", 1212],
    ]);
    expect(ledger.atProperty!.detail).toBe("Cot €7.50 × 2 nights");
    expect(ledger.totalForStayCents).toBe(22362 + 1500);
  });

  test("two rooms list in pick order", () => {
    const attic: LedgerRoom = {
      roomName: "Attic",
      rateNights: nights([9000, 9000]),
      extraGuests: [],
      discount: null,
      touristTaxLines: [],
      payAtPropertyLines: [{ label: "Cots", count: 2, feePerNightCents: 1000, nights: 2, amountCents: 4000 }],
    };
    const ledger = buildLedger([concept, attic], "H", 57780 + 18000)!;
    expect(ledger.rows.map((r) => r.label)).toEqual([
      "Garden Suite · 3 nights",
      "Extra child (2–12)",
      "Stay 3 nights, save 10%",
      "Tourist tax",
      "Attic · 2 nights",
    ]);
    expect(ledger.atProperty!.amountCents).toBe(11500);
    expect(ledger.atProperty!.detail).toBe("Extra bed €25 × 3 nights · cot free · 2 cots €10 × 2 nights");
  });
});

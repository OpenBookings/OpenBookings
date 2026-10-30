import { describe, expect, test } from "bun:test";
import {
  calculateTouristTax,
  ruleInForce,
  type TouristTaxCharge,
  type TouristTaxRule,
  type TouristTaxStay,
} from "./tourist-tax";

const fixed = (amount: number, per: Partial<TouristTaxCharge> = {}): TouristTaxCharge => ({
  kind: "fixed",
  amount,
  perPerson: false,
  perNight: false,
  perRoom: false,
  ...per,
});

const percent = (amount: number, extra: Partial<TouristTaxCharge> = {}): TouristTaxCharge => ({
  kind: "percent",
  amount,
  perPerson: false,
  perNight: false,
  perRoom: false,
  ...extra,
});

const rule = (charges: TouristTaxCharge[], extra: Partial<TouristTaxRule> = {}): TouristTaxRule => ({
  effectiveFrom: "2026-01-01",
  charges,
  childrenExempt: false,
  maxNights: null,
  ...extra,
});

/** Three nights from 1 July 2026 at €100 a night, two adults, one room. */
const stay = (extra: Partial<TouristTaxStay> = {}): TouristTaxStay => ({
  nights: [
    { date: "2026-07-01", price: 100 },
    { date: "2026-07-02", price: 100 },
    { date: "2026-07-03", price: 100 },
  ],
  adults: 2,
  children: 0,
  rooms: 1,
  ...extra,
});

describe("calculateTouristTax", () => {
  test("no rules means no tourist tax", () => {
    expect(calculateTouristTax([], stay())).toEqual({ total: 0, lines: [] });
  });

  test("a fixed amount with no 'per' is charged once per booking", () => {
    expect(calculateTouristTax([rule([fixed(5)])], stay()).total).toBe(5);
  });

  test("per person per night multiplies by guests and nights", () => {
    const result = calculateTouristTax(
      [rule([fixed(2.5, { perPerson: true, perNight: true })])],
      stay(),
    );
    // €2.50 × 2 guests × 3 nights
    expect(result.total).toBe(15);
  });

  test("per room per night multiplies by rooms and nights", () => {
    const result = calculateTouristTax(
      [rule([fixed(3, { perRoom: true, perNight: true })])],
      stay({ rooms: 2 }),
    );
    expect(result.total).toBe(18);
  });

  test("per person without per night is charged once per guest", () => {
    const result = calculateTouristTax([rule([fixed(4, { perPerson: true })])], stay());
    expect(result.total).toBe(8);
  });

  test("a percentage is taken of every night's room price", () => {
    const result = calculateTouristTax(
      [rule([percent(12.5)])],
      stay({ nights: [{ date: "2026-07-01", price: 100 }, { date: "2026-07-02", price: 140 }] }),
    );
    expect(result.total).toBe(30);
  });

  test("a percentage can leave VAT out of the room price first", () => {
    // €109 incl. 9% VAT is €100 before VAT; 10% of that is €10 a night.
    const result = calculateTouristTax(
      [rule([percent(10, { vatIncludedPercent: 9 })])],
      stay({ nights: [{ date: "2026-07-01", price: 109 }] }),
    );
    expect(result.total).toBe(10);
  });

  test("charges in one rule add up", () => {
    // Amsterdam-style: a percentage plus an amount per person per night.
    const result = calculateTouristTax(
      [rule([percent(7), fixed(3, { perPerson: true, perNight: true })])],
      stay(),
    );
    // 7% of €300 = €21, plus €3 × 2 × 3 = €18
    expect(result.total).toBe(39);
    expect(result.lines.map((l) => l.amount)).toEqual([21, 18]);
  });

  test("children can be exempt from per-person charges", () => {
    const result = calculateTouristTax(
      [rule([fixed(2, { perPerson: true, perNight: true })], { childrenExempt: true })],
      stay({ adults: 2, children: 2 }),
    );
    expect(result.total).toBe(12);
  });

  test("children pay per-person charges unless the rule exempts them", () => {
    const result = calculateTouristTax(
      [rule([fixed(2, { perPerson: true, perNight: true })])],
      stay({ adults: 2, children: 2 }),
    );
    expect(result.total).toBe(24);
  });

  test("a maximum number of nights caps per-night charges", () => {
    const result = calculateTouristTax(
      [rule([fixed(2, { perPerson: true, perNight: true }), percent(10)], { maxNights: 2 })],
      stay(),
    );
    // Only the first two nights: €2 × 2 × 2 = €8, plus 10% of €200 = €20
    expect(result.total).toBe(28);
  });

  test("each night uses the rule in force on that night", () => {
    const rules = [
      rule([fixed(2, { perPerson: true, perNight: true })], { effectiveFrom: "2026-01-01" }),
      rule([fixed(4, { perPerson: true, perNight: true })], { effectiveFrom: "2026-07-03" }),
    ];
    // 1 and 2 July at €2 × 2, 3 July at €4 × 2
    expect(calculateTouristTax(rules, stay()).total).toBe(16);
  });

  test("a per-booking charge uses the rule in force on arrival", () => {
    const rules = [
      rule([fixed(5)], { effectiveFrom: "2026-01-01" }),
      rule([fixed(9)], { effectiveFrom: "2026-07-02" }),
    ];
    expect(calculateTouristTax(rules, stay()).total).toBe(5);
  });

  test("nights before the first rule are not taxed", () => {
    const rules = [rule([fixed(2, { perNight: true })], { effectiveFrom: "2026-07-02" })];
    expect(calculateTouristTax(rules, stay()).total).toBe(4);
  });

  test("a rule with no charges stops tourist tax from its date", () => {
    const rules = [
      rule([fixed(2, { perNight: true })], { effectiveFrom: "2026-01-01" }),
      rule([], { effectiveFrom: "2026-07-02" }),
    ];
    expect(calculateTouristTax(rules, stay()).total).toBe(2);
  });

  test("amounts are rounded to cents, and the lines add up to the total", () => {
    const result = calculateTouristTax(
      [rule([percent(7.333), percent(1.111)])],
      stay({ nights: [{ date: "2026-07-01", price: 99.99 }] }),
    );
    for (const line of result.lines) {
      expect(line.amount).toBe(Math.round(line.amount * 100) / 100);
    }
    const sum = result.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(result.total * 100));
  });

  test("lines describe each charge in words", () => {
    const result = calculateTouristTax(
      [
        rule([
          percent(12.5, { vatIncludedPercent: 9 }),
          fixed(2.5, { perPerson: true, perNight: true }),
          fixed(3, { perRoom: true, perNight: true }),
          fixed(5),
        ]),
      ],
      stay(),
    );
    expect(result.lines.map((l) => l.label)).toEqual([
      "12.5% of the room price excl. 9% VAT",
      "€2.50 per person per night",
      "€3.00 per room per night",
      "€5.00 per booking",
    ]);
  });

  test("a charge that adds nothing leaves no line", () => {
    const rules = [rule([fixed(2, { perNight: true })], { effectiveFrom: "2026-08-01" })];
    expect(calculateTouristTax(rules, stay()).lines).toEqual([]);
  });
});

describe("ruleInForce", () => {
  const rules = [
    rule([], { effectiveFrom: "2026-07-01" }),
    rule([], { effectiveFrom: "2026-01-01" }),
    rule([], { effectiveFrom: "2027-01-01" }),
  ];

  test("picks the latest rule that has started", () => {
    expect(ruleInForce(rules, "2026-10-30")?.effectiveFrom).toBe("2026-07-01");
  });

  test("a rule is in force on its own start date", () => {
    expect(ruleInForce(rules, "2027-01-01")?.effectiveFrom).toBe("2027-01-01");
  });

  test("nothing is in force before the first rule", () => {
    expect(ruleInForce(rules, "2025-12-31")).toBeNull();
  });
});

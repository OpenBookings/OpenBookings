import { describe, expect, test } from "bun:test";
import {
  calculateTouristTax,
  infantsPayTouristTax,
  ruleInForce,
  touristTaxByNight,
  type TouristTaxCharge,
  type TouristTaxRule,
  type TouristTaxStay,
} from "./tourist-tax";

type Flags = Partial<Pick<TouristTaxCharge, "perPerson" | "perNight" | "perRoom" | "vatIncludedPercent">>;

const fixed = (amountCents: number, per: Flags = {}): TouristTaxCharge => ({
  kind: "fixed",
  amountCents,
  perPerson: false,
  perNight: false,
  perRoom: false,
  ...per,
});

const percent = (pct: number, extra: Flags = {}): TouristTaxCharge => ({
  kind: "percent",
  percent: pct,
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
    { date: "2026-07-01", priceCents: 10000 },
    { date: "2026-07-02", priceCents: 10000 },
    { date: "2026-07-03", priceCents: 10000 },
  ],
  adults: 2,
  children: 0,
  rooms: 1,
  ...extra,
});

describe("calculateTouristTax", () => {
  test("no rules means no tourist tax", () => {
    expect(calculateTouristTax([], stay())).toEqual({ totalCents: 0, lines: [] });
  });

  test("a fixed amount with no 'per' is charged once per booking", () => {
    expect(calculateTouristTax([rule([fixed(500)])], stay()).totalCents).toBe(500);
  });

  test("per person per night multiplies by guests and nights", () => {
    const result = calculateTouristTax(
      [rule([fixed(250, { perPerson: true, perNight: true })])],
      stay(),
    );
    // €2.50 × 2 guests × 3 nights
    expect(result.totalCents).toBe(1500);
  });

  test("per room per night multiplies by rooms and nights", () => {
    const result = calculateTouristTax(
      [rule([fixed(300, { perRoom: true, perNight: true })])],
      stay({ rooms: 2 }),
    );
    expect(result.totalCents).toBe(1800);
  });

  test("per person without per night is charged once per guest", () => {
    const result = calculateTouristTax([rule([fixed(400, { perPerson: true })])], stay());
    expect(result.totalCents).toBe(800);
  });

  test("a percentage is taken of every night's room price", () => {
    const result = calculateTouristTax(
      [rule([percent(12.5)])],
      stay({ nights: [{ date: "2026-07-01", priceCents: 10000 }, { date: "2026-07-02", priceCents: 14000 }] }),
    );
    expect(result.totalCents).toBe(3000);
  });

  test("a percentage can leave VAT out of the room price first", () => {
    // €109 incl. 9% VAT is €100 before VAT; 10% of that is €10 a night.
    const result = calculateTouristTax(
      [rule([percent(10, { vatIncludedPercent: 9 })])],
      stay({ nights: [{ date: "2026-07-01", priceCents: 10900 }] }),
    );
    expect(result.totalCents).toBe(1000);
  });

  test("charges in one rule add up", () => {
    // Amsterdam-style: a percentage plus an amount per person per night.
    const result = calculateTouristTax(
      [rule([percent(7), fixed(300, { perPerson: true, perNight: true })])],
      stay(),
    );
    // 7% of €300 = €21, plus €3 × 2 × 3 = €18
    expect(result.totalCents).toBe(3900);
    expect(result.lines.map((l) => l.amountCents)).toEqual([2100, 1800]);
  });

  test("children can be exempt from per-person charges", () => {
    const result = calculateTouristTax(
      [rule([fixed(200, { perPerson: true, perNight: true })], { childrenExempt: true })],
      stay({ adults: 2, children: 2 }),
    );
    expect(result.totalCents).toBe(1200);
  });

  test("children pay per-person charges unless the rule exempts them", () => {
    const result = calculateTouristTax(
      [rule([fixed(200, { perPerson: true, perNight: true })])],
      stay({ adults: 2, children: 2 }),
    );
    expect(result.totalCents).toBe(2400);
  });

  test("a maximum number of nights caps per-night charges", () => {
    const result = calculateTouristTax(
      [rule([fixed(200, { perPerson: true, perNight: true }), percent(10)], { maxNights: 2 })],
      stay(),
    );
    // Only the first two nights: €2 × 2 × 2 = €8, plus 10% of €200 = €20
    expect(result.totalCents).toBe(2800);
  });

  test("each night uses the rule in force on that night", () => {
    const rules = [
      rule([fixed(200, { perPerson: true, perNight: true })], { effectiveFrom: "2026-01-01" }),
      rule([fixed(400, { perPerson: true, perNight: true })], { effectiveFrom: "2026-07-03" }),
    ];
    // 1 and 2 July at €2 × 2, 3 July at €4 × 2
    expect(calculateTouristTax(rules, stay()).totalCents).toBe(1600);
  });

  test("a per-booking charge uses the rule in force on arrival", () => {
    const rules = [
      rule([fixed(500)], { effectiveFrom: "2026-01-01" }),
      rule([fixed(900)], { effectiveFrom: "2026-07-02" }),
    ];
    expect(calculateTouristTax(rules, stay()).totalCents).toBe(500);
  });

  test("nights before the first rule are not taxed", () => {
    const rules = [rule([fixed(200, { perNight: true })], { effectiveFrom: "2026-07-02" })];
    expect(calculateTouristTax(rules, stay()).totalCents).toBe(400);
  });

  test("a rule with no charges stops tourist tax from its date", () => {
    const rules = [
      rule([fixed(200, { perNight: true })], { effectiveFrom: "2026-01-01" }),
      rule([], { effectiveFrom: "2026-07-02" }),
    ];
    expect(calculateTouristTax(rules, stay()).totalCents).toBe(200);
  });

  test("amounts are rounded to cents, and the lines add up to the total", () => {
    const result = calculateTouristTax(
      [rule([percent(7.333), percent(1.111)])],
      stay({ nights: [{ date: "2026-07-01", priceCents: 9999 }] }),
    );
    // 733.23 and 111.09 cents, each rounded half up.
    expect(result.lines.map((l) => l.amountCents)).toEqual([733, 111]);
    const sum = result.lines.reduce((s, l) => s + l.amountCents, 0);
    expect(sum).toBe(result.totalCents);
  });

  test("6.5% of €186.50 is 1212 cents (1212.25 rounded half up)", () => {
    const result = calculateTouristTax(
      [rule([percent(6.5)])],
      stay({ nights: [{ date: "2026-07-01", priceCents: 18650 }] }),
    );
    expect(result.totalCents).toBe(1212);
    expect(result.lines).toEqual([
      { label: "6.5% of the room price", amountCents: 1212, effectiveFrom: "2026-01-01" },
    ]);
  });

  test("a percentage rounds per night, half up, and the nights add up to the total", () => {
    // 4.5% of 3333 = 149.985 a night: 150 each, so 450 — not 449.955 rounded once.
    const rules = [rule([percent(4.5)])];
    const s = stay({
      nights: [
        { date: "2026-07-01", priceCents: 3333 },
        { date: "2026-07-02", priceCents: 3333 },
        { date: "2026-07-03", priceCents: 3333 },
      ],
    });
    expect(touristTaxByNight(rules, s)).toEqual([150, 150, 150]);
    expect(calculateTouristTax(rules, s).totalCents).toBe(450);
  });

  test("lines describe each charge in words", () => {
    const result = calculateTouristTax(
      [
        rule([
          percent(12.5, { vatIncludedPercent: 9 }),
          fixed(250, { perPerson: true, perNight: true }),
          fixed(300, { perRoom: true, perNight: true }),
          fixed(500),
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
    const rules = [rule([fixed(200, { perNight: true })], { effectiveFrom: "2026-08-01" })];
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

describe("touristTaxByNight", () => {
  test("a per-person-per-night charge lands on each night", () => {
    const rules = [rule([fixed(300, { perPerson: true, perNight: true })])];
    expect(touristTaxByNight(rules, stay())).toEqual([600, 600, 600]);
  });

  test("a once-per-stay charge goes on the first night", () => {
    const rules = [rule([fixed(300, { perPerson: true, perNight: true }), fixed(500)])];
    expect(touristTaxByNight(rules, stay())).toEqual([1100, 600, 600]);
  });

  test("the nights add up to the stay's total to the cent", () => {
    const rules = [rule([percent(12.5)])];
    const s = stay({
      nights: [
        { date: "2026-07-01", priceCents: 9999 },
        { date: "2026-07-02", priceCents: 9999 },
        { date: "2026-07-03", priceCents: 9999 },
      ],
    });
    const perNight = touristTaxByNight(rules, s);
    for (const n of perNight) expect(Number.isInteger(n)).toBe(true);
    expect(perNight.reduce((sum, n) => sum + n, 0)).toBe(calculateTouristTax(rules, s).totalCents);
  });

  test("nights past the cap owe nothing", () => {
    const rules = [rule([fixed(300, { perPerson: true, perNight: true })], { maxNights: 2 })];
    expect(touristTaxByNight(rules, stay())).toEqual([600, 600, 0]);
  });
});

describe("infants", () => {
  const perPerson = [fixed(200, { perPerson: true, perNight: true })];

  test("don't pay unless the rule says so", () => {
    expect(calculateTouristTax([rule(perPerson)], stay({ infants: 1 })).totalCents).toBe(1200);
    expect(calculateTouristTax([rule(perPerson, { infantsTaxed: true })], stay({ infants: 1 })).totalCents).toBe(1800);
  });

  test("don't pay when children don't", () => {
    const r = rule(perPerson, { childrenExempt: true, infantsTaxed: true });
    expect(calculateTouristTax([r], stay({ children: 1, infants: 1 })).totalCents).toBe(1200);
  });

  test("are left out of per-night refunds the same way", () => {
    expect(touristTaxByNight([rule(perPerson)], stay({ infants: 1 }))).toEqual([400, 400, 400]);
    expect(touristTaxByNight([rule(perPerson, { infantsTaxed: true })], stay({ infants: 1 }))).toEqual([600, 600, 600]);
  });

  describe("infantsPayTouristTax", () => {
    test("false without a rule that taxes infants per person", () => {
      expect(infantsPayTouristTax([], "2026-07-01")).toBe(false);
      expect(infantsPayTouristTax([rule(perPerson)], "2026-07-01")).toBe(false);
      expect(infantsPayTouristTax([rule([percent(5)], { infantsTaxed: true })], "2026-07-01")).toBe(false);
      expect(infantsPayTouristTax([rule(perPerson, { infantsTaxed: true, childrenExempt: true })], "2026-07-01")).toBe(false);
    });

    test("true for the rule in force or one still to start, not an old one", () => {
      const old = rule(perPerson, { infantsTaxed: true });
      const now = rule(perPerson, { effectiveFrom: "2026-06-01" });
      const next = rule(perPerson, { effectiveFrom: "2027-01-01", infantsTaxed: true });
      expect(infantsPayTouristTax([old], "2026-07-01")).toBe(true);
      expect(infantsPayTouristTax([old, now], "2026-07-01")).toBe(false);
      expect(infantsPayTouristTax([old, now, next], "2026-07-01")).toBe(true);
    });
  });
});

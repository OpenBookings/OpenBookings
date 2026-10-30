import { describe, expect, test } from "bun:test";
import { touristTaxRuleSchema } from "./tourist-tax-schema";

const valid = {
  effectiveFrom: "2027-01-01",
  charges: [
    { kind: "percent", amount: 12.5, perPerson: false, perNight: false, perRoom: false, vatIncludedPercent: 9 },
    { kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false },
  ],
  childrenExempt: true,
  maxNights: 7,
};

const errorsOf = (input: unknown) => {
  const r = touristTaxRuleSchema.safeParse(input);
  if (r.success) throw new Error("expected the rule to be rejected");
  return r.error.issues.map((i) => i.message);
};

describe("touristTaxRuleSchema", () => {
  test("accepts a combined rule", () => {
    expect(touristTaxRuleSchema.safeParse(valid).success).toBe(true);
  });

  test("accepts a rule with no charges, meaning no tourist tax from that date", () => {
    expect(touristTaxRuleSchema.safeParse({ ...valid, charges: [] }).success).toBe(true);
  });

  test("requires an effective-from date", () => {
    expect(errorsOf({ ...valid, effectiveFrom: "" })).toContain("Choose the date this rule starts.");
  });

  test("rejects a charge of zero", () => {
    expect(errorsOf({ ...valid, charges: [{ ...valid.charges[1], amount: 0 }] })).toContain(
      "Enter an amount above zero.",
    );
  });

  test("rejects a percentage above 100", () => {
    expect(errorsOf({ ...valid, charges: [{ ...valid.charges[0], amount: 120 }] })).toContain(
      "A percentage cannot be more than 100.",
    );
  });

  test("rejects amounts with more than two decimals", () => {
    expect(errorsOf({ ...valid, charges: [{ ...valid.charges[1], amount: 2.555 }] })).toContain(
      "Use at most two decimals.",
    );
  });

  test("a percentage ignores the per-person, per-room and per-night ticks", () => {
    const r = touristTaxRuleSchema.parse({
      ...valid,
      charges: [{ ...valid.charges[0], perPerson: true, perNight: true, perRoom: true }],
    });
    expect(r.charges[0]).toMatchObject({ perPerson: false, perNight: false, perRoom: false });
  });

  test("a fixed amount drops the VAT setting, which only applies to percentages", () => {
    const r = touristTaxRuleSchema.parse({
      ...valid,
      charges: [{ ...valid.charges[1], vatIncludedPercent: 9 }],
    });
    expect(r.charges[0].vatIncludedPercent).toBeNull();
  });

  test("a maximum of nights must be a whole number of at least one", () => {
    expect(errorsOf({ ...valid, maxNights: 0 })).toContain("Enter at least 1 night, or leave it empty.");
    expect(errorsOf({ ...valid, maxNights: 2.5 })).toContain("Enter at least 1 night, or leave it empty.");
  });

  test("optional settings can be left empty", () => {
    const r = touristTaxRuleSchema.parse({ ...valid, maxNights: null });
    expect(r.maxNights).toBeNull();
  });

  test("allows at most eight charges in one rule", () => {
    const charges = Array.from({ length: 9 }, () => valid.charges[1]);
    expect(errorsOf({ ...valid, charges })).toContain("A rule can have at most 8 charges.");
  });
});

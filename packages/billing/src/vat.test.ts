import { describe, expect, test } from "bun:test";
import {
  NonEuCountryError,
  splitInclusive,
  splitRefund,
  vatRateBp,
  vatTreatmentFor,
} from "./vat";

const negate = (s: { net: bigint; vat: bigint }) => ({
  net: -s.net,
  vat: -s.vat,
});

describe("vatRateBp", () => {
  test("maps treatments to basis points", () => {
    expect(vatRateBp("NL_DOMESTIC")).toBe(2100n);
    expect(vatRateBp("EU_REVERSE_CHARGE")).toBe(0n);
  });
});

describe("vatTreatmentFor", () => {
  test("NL is domestic, other EU-27 is reverse charge", () => {
    expect(vatTreatmentFor("nl")).toBe("NL_DOMESTIC");
    expect(vatTreatmentFor("BE")).toBe("EU_REVERSE_CHARGE");
    expect(vatTreatmentFor("de")).toBe("EU_REVERSE_CHARGE");
  });

  test("non-EU throws NonEuCountryError", () => {
    expect(() => vatTreatmentFor("GB")).toThrow(NonEuCountryError);
    expect(() => vatTreatmentFor("")).toThrow(NonEuCountryError);
  });
});

describe("splitInclusive", () => {
  test("splits a VAT-inclusive gross", () => {
    expect(splitInclusive(12069n, 2100n)).toEqual({ net: 9974n, vat: 2095n });
    expect(splitInclusive(6930n, 0n)).toEqual({ net: 6930n, vat: 0n });
  });

  test("a negated gross splits to the negated result", () => {
    expect(splitInclusive(-12069n, 2100n)).toEqual(
      negate(splitInclusive(12069n, 2100n)),
    );
  });
});

describe("splitRefund", () => {
  const orig = { base: 24000n, gross: 1080n, rateBp: 2100n };

  test("every partial refund sums to the negated amount", () => {
    for (let r = 1n; r <= 1080n; r++) {
      const s = splitRefund(orig, r);
      expect(s.net + s.vat).toBe(-r);
      expect(s.base <= 0n).toBe(true);
      expect(-s.base <= orig.base).toBe(true);
    }
  });

  test("a full refund negates the original split exactly", () => {
    expect(splitRefund(orig, 1080n)).toEqual({
      base: -24000n,
      ...negate(splitInclusive(1080n, 2100n)),
    });
  });
});

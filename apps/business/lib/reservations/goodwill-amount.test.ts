import { describe, expect, test } from "bun:test";
import { goodwillAmount } from "./goodwill-amount";

describe("goodwillAmount", () => {
  test("reads what the host typed as cents", () => {
    expect(goodwillAmount.parse("12,50")).toBe(1250);
    expect(goodwillAmount.parse(" 12.5 ")).toBe(1250);
    expect(goodwillAmount.parse("186.50")).toBe(18650);
    expect(goodwillAmount.parse("0.01")).toBe(1);
  });

  test("rejects zero, negatives, three decimals, thousands separators and junk", () => {
    for (const bad of ["0", "0,00", "-1", "12.505", "1.234,50", "", "abc", "1e3", "NaN", "Infinity"]) {
      expect(goodwillAmount.safeParse(bad).success).toBe(false);
    }
  });

  test("rejects anything that isn't text: a number got past the type system", () => {
    for (const bad of [12.5, Number.NaN, Infinity, null, undefined, {}]) {
      expect(goodwillAmount.safeParse(bad).success).toBe(false);
    }
  });
});

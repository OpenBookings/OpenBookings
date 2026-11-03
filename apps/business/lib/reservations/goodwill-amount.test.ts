import { describe, expect, test } from "bun:test";
import { goodwillAmount } from "./goodwill-amount";

describe("goodwillAmount", () => {
  test("accepts a positive, finite euro amount", () => {
    expect(goodwillAmount.parse(12.5)).toBe(12.5);
    expect(goodwillAmount.safeParse(0.01).success).toBe(true);
  });

  test("rejects NaN, Infinity, zero, negatives and non-numbers", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, 0, -1, "10", null, undefined]) {
      expect(goodwillAmount.safeParse(bad).success).toBe(false);
    }
  });

  test("what the dialog sends for junk text is rejected", () => {
    expect(goodwillAmount.safeParse(Number("abc".replace(",", "."))).success).toBe(false);
    expect(goodwillAmount.safeParse(Number("".replace(",", "."))).success).toBe(false);
  });
});

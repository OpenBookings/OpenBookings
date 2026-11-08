import { describe, expect, test } from "bun:test";
import { formatEuro, roundHalfUp } from "./money";

describe("roundHalfUp", () => {
  test("rounds half away from zero", () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n);
    expect(roundHalfUp(-5n, 2n)).toBe(-3n);
    expect(roundHalfUp(4n, 3n)).toBe(1n);
    expect(roundHalfUp(-4n, 3n)).toBe(-1n);
    expect(roundHalfUp(0n, 7n)).toBe(0n);
    expect(roundHalfUp(1n, 3n)).toBe(0n);
  });

  test("rejects a non-positive denominator", () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow();
    expect(() => roundHalfUp(1n, -2n)).toThrow();
  });
});

describe("formatEuro", () => {
  test("formats with grouping and two decimals", () => {
    expect(formatEuro(123456n)).toBe("€1,234.56");
    expect(formatEuro(5n)).toBe("€0.05");
    expect(formatEuro(100000000n)).toBe("€1,000,000.00");
  });

  test("uses U+2212 for negatives and plain zero", () => {
    expect(formatEuro(-900n)).toBe("−€9.00");
    expect(formatEuro(0n)).toBe("€0.00");
  });
});

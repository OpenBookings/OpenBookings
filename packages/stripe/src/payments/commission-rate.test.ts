import { describe, expect, test } from "bun:test";
import { DEFAULT_COMMISSION_LABEL, DEFAULT_COMMISSION_RATE, formatCommissionRate } from "./commission-rate";

describe("commission rate", () => {
  test("the default is 4.5%", () => {
    expect(DEFAULT_COMMISSION_RATE).toBe(0.045);
    expect(DEFAULT_COMMISSION_LABEL).toBe("4.5%");
  });

  test("formats rates without float noise or trailing zeros", () => {
    expect(formatCommissionRate(0.05)).toBe("5%");
    expect(formatCommissionRate(0.035)).toBe("3.5%");
    expect(formatCommissionRate(0.0425)).toBe("4.25%");
    expect(formatCommissionRate(0.07)).toBe("7%");
  });
});

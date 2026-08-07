import { describe, expect, it } from "bun:test";
import { DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR, parseRefundThreshold } from "./env";

describe("parseRefundThreshold", () => {
  it("falls back to the default when unset", () => {
    expect(parseRefundThreshold(undefined)).toBe(DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR);
  });

  it("treats a blank value as unset rather than zero", () => {
    // `REFUND_ESCALATION_THRESHOLD_EUR=` in a .env file yields "" — Number("")
    // is 0, which would escalate every payment lookup.
    expect(parseRefundThreshold("")).toBe(DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR);
    expect(parseRefundThreshold("   ")).toBe(DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR);
  });

  it("parses a configured value, tolerating surrounding whitespace", () => {
    expect(parseRefundThreshold("500")).toBe(500);
    expect(parseRefundThreshold(" 125.50 ")).toBe(125.5);
  });

  it("allows an explicit zero (escalate every refund) when asked for", () => {
    expect(parseRefundThreshold("0")).toBe(0);
  });

  it("throws rather than degrading to 0 on a nonsense value", () => {
    expect(() => parseRefundThreshold("abc")).toThrow("non-negative number");
    expect(() => parseRefundThreshold("-10")).toThrow("non-negative number");
  });
});

import { describe, expect, test } from "bun:test";
import { DEPENDS_MESSAGE, NON_REFUNDABLE_MESSAGE, refundableGuardError, type GuardRate } from "./refundable-guard";

const rate = (id: string, barCents: number, isRefundable: boolean, isActive = true): GuardRate => ({
  id,
  barCents,
  isRefundable,
  isActive,
});

describe("refundableGuardError", () => {
  test("an active non-refundable rate with no refundable rate beside it is refused", () => {
    expect(refundableGuardError([], rate("nr", 9000, false))).toBe(NON_REFUNDABLE_MESSAGE);
  });

  test("exactly 10% cheaper than an active refundable rate is fine", () => {
    expect(refundableGuardError([rate("r", 10000, true)], rate("nr", 9000, false))).toBeNull();
  });

  test("less than 10% cheaper is refused", () => {
    expect(refundableGuardError([rate("r", 10000, true)], rate("nr", 9500, false))).toBe(NON_REFUNDABLE_MESSAGE);
  });

  test("an inactive refundable rate doesn't count", () => {
    expect(refundableGuardError([rate("r", 10000, true, false)], rate("nr", 9000, false))).toBe(NON_REFUNDABLE_MESSAGE);
  });

  test("an inactive non-refundable rate is never refused", () => {
    expect(refundableGuardError([], rate("nr", 9000, false, false))).toBeNull();
  });

  test("switching off the refundable rate a non-refundable one depends on is refused", () => {
    const rates = [rate("r", 10000, true), rate("nr", 9000, false)];
    expect(refundableGuardError(rates, rate("r", 10000, true, false))).toBe(DEPENDS_MESSAGE);
  });

  test("turning that refundable rate non-refundable is refused too", () => {
    const rates = [rate("r", 10000, true), rate("nr", 9000, false)];
    expect(refundableGuardError(rates, rate("r", 10000, false))).toBe(DEPENDS_MESSAGE);
  });

  test("switching it off is fine while another refundable rate still covers", () => {
    const rates = [rate("r", 10000, true), rate("r2", 12000, true), rate("nr", 9000, false)];
    expect(refundableGuardError(rates, rate("r", 10000, true, false))).toBeNull();
  });

  test("a refundable rate never trips the rule on its own", () => {
    expect(refundableGuardError([], rate("r", 10000, true))).toBeNull();
  });

  test("a non-refundable rate that was already out of line doesn't block an unrelated save", () => {
    const rates = [rate("r", 10000, true), rate("nr-old", 9800, false)];
    expect(refundableGuardError(rates, rate("r2", 15000, true))).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { DEPENDS_MESSAGE, NON_REFUNDABLE_MESSAGE, refundableGuardError, type GuardRate } from "./refundable-guard";

const rate = (id: string, bar: number, isRefundable: boolean, isActive = true): GuardRate => ({
  id,
  bar,
  isRefundable,
  isActive,
});

describe("refundableGuardError", () => {
  test("an active non-refundable rate with no refundable rate beside it is refused", () => {
    expect(refundableGuardError([], rate("nr", 90, false))).toBe(NON_REFUNDABLE_MESSAGE);
  });

  test("exactly 10% cheaper than an active refundable rate is fine", () => {
    expect(refundableGuardError([rate("r", 100, true)], rate("nr", 90, false))).toBeNull();
  });

  test("less than 10% cheaper is refused", () => {
    expect(refundableGuardError([rate("r", 100, true)], rate("nr", 95, false))).toBe(NON_REFUNDABLE_MESSAGE);
  });

  test("an inactive refundable rate doesn't count", () => {
    expect(refundableGuardError([rate("r", 100, true, false)], rate("nr", 90, false))).toBe(NON_REFUNDABLE_MESSAGE);
  });

  test("an inactive non-refundable rate is never refused", () => {
    expect(refundableGuardError([], rate("nr", 90, false, false))).toBeNull();
  });

  test("switching off the refundable rate a non-refundable one depends on is refused", () => {
    const rates = [rate("r", 100, true), rate("nr", 90, false)];
    expect(refundableGuardError(rates, rate("r", 100, true, false))).toBe(DEPENDS_MESSAGE);
  });

  test("turning that refundable rate non-refundable is refused too", () => {
    const rates = [rate("r", 100, true), rate("nr", 90, false)];
    expect(refundableGuardError(rates, rate("r", 100, false))).toBe(DEPENDS_MESSAGE);
  });

  test("switching it off is fine while another refundable rate still covers", () => {
    const rates = [rate("r", 100, true), rate("r2", 120, true), rate("nr", 90, false)];
    expect(refundableGuardError(rates, rate("r", 100, true, false))).toBeNull();
  });

  test("a refundable rate never trips the rule on its own", () => {
    expect(refundableGuardError([], rate("r", 100, true))).toBeNull();
  });

  test("a non-refundable rate that was already out of line doesn't block an unrelated save", () => {
    const rates = [rate("r", 100, true), rate("nr-old", 98, false)];
    expect(refundableGuardError(rates, rate("r2", 150, true))).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { outsideRefundKey, refundedSplit, validateSplit } from "./outside-refunds";

describe("validateSplit", () => {
  test("room price and tourist tax must add up to the refund exactly", () => {
    expect(validateSplit(10_000, { roomPriceCents: 9_400, touristTaxCents: 600 })).toEqual({ ok: true });
    expect(validateSplit(10_000, { roomPriceCents: 10_000, touristTaxCents: 0 })).toEqual({ ok: true });
    expect(validateSplit(10_000, { roomPriceCents: 9_400, touristTaxCents: 500 })).toEqual({ ok: false, error: "split_sum_mismatch" });
    expect(validateSplit(10_000, { roomPriceCents: 9_400, touristTaxCents: 700 })).toEqual({ ok: false, error: "split_sum_mismatch" });
  });

  test("no negative parts, no fractions of a cent, no NaN", () => {
    expect(validateSplit(10_000, { roomPriceCents: 10_600, touristTaxCents: -600 })).toEqual({ ok: false, error: "split_negative" });
    expect(validateSplit(10_000, { roomPriceCents: 9_999.5, touristTaxCents: 0.5 })).toEqual({ ok: false, error: "split_not_whole_cents" });
    expect(validateSplit(10_000, { roomPriceCents: Number.NaN, touristTaxCents: 10_000 })).toEqual({ ok: false, error: "split_not_whole_cents" });
  });
});

test("one key per Stripe refund or dispute", () => {
  expect(outsideRefundKey("stripe_dashboard", "re_1")).toBe("stripe_dashboard:re_1");
  expect(outsideRefundKey("dispute", "dp_1")).toBe("dispute:dp_1");
});

describe("refundedSplit", () => {
  const own = { source: "openbookings", status: "succeeded", accommodationCents: 30_000, touristTaxCents: 900, explained: false };

  test("an unexplained outside refund comes off the room price, and is reported as unexplained", () => {
    const outside = { source: "stripe_dashboard", status: "succeeded", accommodationCents: 10_000, touristTaxCents: 0, explained: false };
    expect(refundedSplit([own, outside])).toEqual({ roomPriceCents: 40_000, touristTaxCents: 900, unexplainedCents: 10_000 });
  });

  test("once explained, its tourist tax part comes off the tourist tax", () => {
    const outside = { source: "dispute", status: "succeeded", accommodationCents: 9_400, touristTaxCents: 600, explained: true };
    expect(refundedSplit([own, outside])).toEqual({ roomPriceCents: 39_400, touristTaxCents: 1_500, unexplainedCents: 0 });
  });

  test("refunds that have not gone through take nothing off", () => {
    expect(refundedSplit([{ ...own, status: "failed" }, { ...own, status: "pending" }])).toEqual({
      roomPriceCents: 0,
      touristTaxCents: 0,
      unexplainedCents: 0,
    });
  });
});

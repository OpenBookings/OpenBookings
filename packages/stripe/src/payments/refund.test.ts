import { describe, expect, test } from "bun:test";
import { buildRefundParams, isDefiniteRefundFailure, matchRefund } from "./refund";

describe("buildRefundParams", () => {
  test("refunds the payment on the host's account and returns our fee in proportion", () => {
    expect(buildRefundParams({ paymentIntentId: "pi_1", amountCents: 41_500, metadata: { bookingId: "b1" } })).toEqual({
      payment_intent: "pi_1",
      amount: 41_500,
      refund_application_fee: true,
      metadata: { bookingId: "b1" },
    });
  });

  test("never reverses a transfer: there is none on a direct charge", () => {
    const params = buildRefundParams({ paymentIntentId: "pi_1", amountCents: 100, metadata: {} });
    expect("reverse_transfer" in params).toBe(false);
  });

  test("refuses a refund of nothing or of part of a cent", () => {
    expect(() => buildRefundParams({ paymentIntentId: "pi_1", amountCents: 0, metadata: {} })).toThrow();
    expect(() => buildRefundParams({ paymentIntentId: "pi_1", amountCents: 10.5, metadata: {} })).toThrow();
  });
});

describe("isDefiniteRefundFailure", () => {
  test("Stripe refusing the request means no money moved", () => {
    expect(isDefiniteRefundFailure({ type: "StripeInvalidRequestError" })).toBe(true);
    expect(isDefiniteRefundFailure({ type: "StripeCardError" })).toBe(true);
  });

  test("a network error, timeout or Stripe-side 5xx might have gone through", () => {
    expect(isDefiniteRefundFailure({ type: "StripeConnectionError" })).toBe(false);
    expect(isDefiniteRefundFailure({ type: "StripeAPIError" })).toBe(false);
    expect(isDefiniteRefundFailure(new Error("socket hang up"))).toBe(false);
  });
});

describe("matchRefund", () => {
  test("finds the refund made for one of our rows, ignoring failed and other refunds", () => {
    const refunds = [
      { id: "re_other", status: "succeeded", metadata: { refundId: "row-2" } },
      { id: "re_failed", status: "failed", metadata: { refundId: "row-1" } },
      { id: "re_ok", status: "succeeded", metadata: { refundId: "row-1" } },
    ];
    expect(matchRefund(refunds, "row-1")).toEqual({ id: "re_ok" });
    expect(matchRefund(refunds, "row-3")).toBeNull();
  });
});

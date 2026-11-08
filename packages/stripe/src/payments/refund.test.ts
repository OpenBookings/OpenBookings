import { describe, expect, test } from "bun:test";
import {
  buildRefundParams,
  buildReturnUnexplainedRequest,
  isDefiniteRefundFailure,
  matchRefund,
  matchRefundByMetadata,
} from "./refund";

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

describe("buildReturnUnexplainedRequest", () => {
  test("refunds the whole charge on the host's account and hands back our fee", () => {
    expect(buildReturnUnexplainedRequest("ch_1", "acct_1")).toEqual({
      params: {
        charge: "ch_1",
        refund_application_fee: true,
        metadata: { reason: "unexplained", chargeId: "ch_1" },
      },
      options: { stripeAccount: "acct_1", idempotencyKey: "return-unexplained:ch_1" },
    });
  });

  test("names no amount, so the whole charge goes back, and never reverses a transfer", () => {
    const { params } = buildReturnUnexplainedRequest("ch_1", "acct_1");
    expect("amount" in params).toBe(false);
    expect("reverse_transfer" in params).toBe(false);
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

describe("matchRefundByMetadata", () => {
  test("finds a live refund carrying every given metadata value", () => {
    const refunds = [
      { id: "re_dup", status: "succeeded", metadata: { intentId: "i-1", reason: "duplicate" } },
      { id: "re_canceled", status: "canceled", metadata: { intentId: "i-1", reason: "oversold" } },
      { id: "re_ok", status: "pending", metadata: { intentId: "i-1", reason: "oversold" } },
    ];
    expect(matchRefundByMetadata(refunds, { intentId: "i-1", reason: "oversold" })).toEqual({ id: "re_ok" });
    expect(matchRefundByMetadata(refunds, { intentId: "i-2", reason: "oversold" })).toBeNull();
  });

  test("a refund without metadata never matches", () => {
    expect(matchRefundByMetadata([{ id: "re_1", status: "succeeded", metadata: null }], { reason: "oversold" })).toBeNull();
  });
});

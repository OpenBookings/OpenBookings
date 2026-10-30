import { describe, expect, test } from "bun:test";
import { buildRefundParams } from "./refund";

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

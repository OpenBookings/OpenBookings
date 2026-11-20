import { describe, expect, test } from "bun:test";
import { refundsOutsideOpenBookings } from "./commission-refund";
import { buildRefundParams, buildReturnUnexplainedRequest } from "./refund";
import { madeByOpenBookings } from "./refund-origin";

const meta = (params: { metadata?: unknown }) => params.metadata as Record<string, string>;

describe("madeByOpenBookings", () => {
  test("recognises every refund OpenBookings creates, from the builders themselves", () => {
    // A booking refund with a room price, and one from before the split (no room price).
    const withRoom = buildRefundParams({
      paymentIntentId: "pi_1",
      amountCents: 1000,
      metadata: { bookingId: "b1", refundId: "r1" },
      roomPrice: { refundCents: 800, totalCents: 8000 },
    });
    const withoutRoom = buildRefundParams({ paymentIntentId: "pi_1", amountCents: 1000, metadata: { bookingId: "b1", refundId: "r1" } });
    expect(madeByOpenBookings(meta(withRoom))).toBe(true);
    expect(madeByOpenBookings(meta(withoutRoom))).toBe(true);
    // A payment the ledger could not explain, returned in full.
    expect(madeByOpenBookings(meta(buildReturnUnexplainedRequest("ch_1", "acct_1").params))).toBe(true);
    // An oversold or duplicate checkout, refunded by the web app's confirmation.
    expect(madeByOpenBookings({ intentId: "i1", reason: "oversold" })).toBe(true);
    expect(madeByOpenBookings({ intentId: "i1", reason: "duplicate" })).toBe(true);
  });

  test("a refund made in the host's Stripe Dashboard carries none of it", () => {
    expect(madeByOpenBookings({})).toBe(false);
    expect(madeByOpenBookings(null)).toBe(false);
    expect(madeByOpenBookings(undefined)).toBe(false);
    expect(madeByOpenBookings({ note: "guest asked" })).toBe(false);
  });
});

describe("refundsOutsideOpenBookings", () => {
  const refund = (over: Partial<Parameters<typeof refundsOutsideOpenBookings>[0][number]> = {}) => ({
    id: "re_1",
    amount: 5000,
    created: 1_790_000_000,
    reason: null,
    status: "succeeded",
    metadata: {},
    payment_intent: "pi_1",
    ...over,
  });

  test("keeps the host's own refunds, with what staff need to ask about them", () => {
    expect(refundsOutsideOpenBookings([refund({ reason: "requested_by_customer" })])).toEqual([
      { id: "re_1", amount: 5000, created: 1_790_000_000, reason: "requested_by_customer", status: "succeeded", paymentIntentId: "pi_1" },
    ]);
  });

  test("leaves out OpenBookings' refunds and refunds that moved no money", () => {
    expect(
      refundsOutsideOpenBookings([
        refund({ id: "re_ob", metadata: { bookingId: "b1", refundId: "r1" } }),
        refund({ id: "re_unexplained", metadata: { reason: "unexplained", chargeId: "ch_1" } }),
        refund({ id: "re_failed", status: "failed" }),
        refund({ id: "re_canceled", status: "canceled" }),
        refund({ id: "re_pending", status: "pending", payment_intent: null }),
      ]).map((r) => [r.id, r.paymentIntentId]),
    ).toEqual([["re_pending", null]]);
  });
});

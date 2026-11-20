import { expect, test } from "bun:test";
import { outsideRefundFromFlag } from "./outside-refund";

const NOW = new Date("2031-01-01T00:00:00Z");

test("a Dashboard refund flag becomes a booking record dated by Stripe's refund", () => {
  expect(
    outsideRefundFromFlag(
      {
        action: "payment.refund-outside-openbookings",
        stripeAccountId: "acct_1",
        dedupeKey: "re_1",
        detail: { chargeId: "ch_1", refundId: "re_1", paymentIntentId: "pi_1", amount: 5000, created: 1_790_000_000, reason: null },
      },
      NOW,
    ),
  ).toEqual({
    source: "stripe_dashboard",
    stripeId: "re_1",
    paymentIntentId: "pi_1",
    chargeId: "ch_1",
    stripeAccountId: "acct_1",
    amountCents: 5000,
    occurredAt: new Date(1_790_000_000 * 1000),
    reason: null,
  });
});

test("a lost dispute is dated when it was lost, else when the webhook ran", () => {
  const entry = {
    action: "payment.dispute-lost",
    stripeAccountId: "acct_1",
    dedupeKey: "dp_1",
    detail: { chargeId: "ch_1", disputeId: "dp_1", paymentIntentId: "pi_1", amount: 10_000, reason: "fraudulent", created: 1_780_000_000 },
  };
  expect(outsideRefundFromFlag({ ...entry, detail: { ...entry.detail, lostAt: 1_790_000_000 } }, NOW)).toMatchObject({
    source: "dispute",
    stripeId: "dp_1",
    occurredAt: new Date(1_790_000_000 * 1000),
  });
  expect(outsideRefundFromFlag(entry, NOW)?.occurredAt).toEqual(NOW);
});

test("other audit entries, and flags missing an amount, make no record", () => {
  expect(outsideRefundFromFlag({ action: "commission.refunded", stripeAccountId: "a", dedupeKey: "fr_1", detail: { amount: 1 } })).toBeNull();
  expect(
    outsideRefundFromFlag({ action: "payment.dispute-lost", stripeAccountId: "a", dedupeKey: "dp_1", detail: { disputeId: "dp_1" } }),
  ).toBeNull();
});

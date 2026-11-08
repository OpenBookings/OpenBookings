import { describe, expect, test } from "bun:test";
import { buildStripeLedgerDeps, type LedgerStripe } from "./stripe-deps";

function fake(charge: unknown) {
  const calls: unknown[][] = [];
  const stripe: LedgerStripe = {
    charges: {
      retrieve: async (...args: unknown[]) => {
        calls.push(args);
        return charge as never;
      },
    },
  };
  const deps = buildStripeLedgerDeps({
    db: { query: async () => ({ rows: [] }) },
    stripe,
    report: () => {},
    audit: async () => {},
  });
  return { deps, calls };
}

describe("buildStripeLedgerDeps chargeInfo", () => {
  test("takes the metadata from the PaymentIntent, not the charge", async () => {
    const { deps, calls } = fake({
      id: "ch_1",
      amount: 10_000,
      amount_refunded: 250,
      metadata: { bookingIntentId: "from-the-charge" },
      payment_intent: { id: "pi_1", metadata: { bookingIntentId: "i1" } },
    });
    expect(await deps.chargeInfo("ch_1", "acct_1")).toEqual({
      paymentIntentId: "pi_1",
      metadata: { bookingIntentId: "i1" },
      amount: 10_000,
      amountRefunded: 250,
    });
    expect(calls).toEqual([["ch_1", { expand: ["payment_intent"] }, { stripeAccount: "acct_1" }]]);
  });

  test("a charge's own metadata is ignored when the PaymentIntent has none", async () => {
    const { deps } = fake({
      id: "ch_1",
      amount: 1,
      amount_refunded: 0,
      metadata: { bookingIntentId: "from-the-charge" },
      payment_intent: { id: "pi_1", metadata: {} },
    });
    expect((await deps.chargeInfo("ch_1", "acct_1")).metadata).toEqual({});
  });

  test("throws when the PaymentIntent is absent or not expanded", async () => {
    for (const payment_intent of [null, "pi_1"]) {
      const { deps } = fake({ id: "ch_1", amount: 1, amount_refunded: 0, metadata: { bookingIntentId: "x" }, payment_intent });
      await expect(deps.chargeInfo("ch_1", "acct_1")).rejects.toThrow(/payment intent/i);
    }
  });
});

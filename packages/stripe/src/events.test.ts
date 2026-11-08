import { describe, expect, test } from "bun:test";
import { handleStripeEvent, readPaidCheckout, type StripeEventDeps, type StripeEventLike } from "./events";

function setup(over: Partial<StripeEventDeps> = {}) {
  const calls: unknown[][] = [];
  const processed = new Set<string>();
  const deps: StripeEventDeps = {
    livemode: false,
    isProcessed: async (id) => processed.has(id),
    markProcessed: async (id) => void processed.add(id),
    refundCommission: async (charge, account, options) => {
      calls.push(["refund", charge, account, options]);
      return [{ id: "fr_1", amount: 100 }];
    },
    audit: async (entry) => void calls.push(["audit", entry.action, entry.stripeAccountId, entry.detail, entry.dedupeKey]),
    ...over,
  };
  return { deps, calls, processed };
}

const event = (type: string, object: Record<string, unknown>, account: string | null = "acct_1", id = "evt_1"): StripeEventLike => ({
  id,
  type,
  livemode: false,
  account: account ?? undefined,
  data: { object },
});

const readyAccount = { id: "acct_1", charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [] } };

describe("handleStripeEvent", () => {
  test("an account becoming ready completes nothing: only completeOnboarding() does, after provisioning", async () => {
    // Completing here could mark a host done before their organisation exists.
    const t = setup();
    expect(await handleStripeEvent(event("account.updated", readyAccount), t.deps)).toBe("handled");
    expect(t.calls).toEqual([]);
    expect(t.processed.has("evt_1")).toBe(true);
  });

  test("a refund returns the commission for that charge on that host's account", async () => {
    const t = setup();
    await handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps);
    expect(t.calls[0]).toEqual(["refund", "ch_1", "acct_1", {}]);
    expect(t.calls[1]).toEqual(["audit", "commission.refunded", "acct_1", { chargeId: "ch_1", feeRefundId: "fr_1", amount: 100 }, "fr_1"]);
  });

  test("a lost dispute returns the commission on the disputed amount; a won one returns nothing", async () => {
    const lost = setup();
    await handleStripeEvent(event("charge.dispute.closed", { id: "dp_1", charge: "ch_1", status: "lost", amount: 10_000 }), lost.deps);
    expect(lost.calls[0]).toEqual(["refund", "ch_1", "acct_1", { lostDisputeAmount: 10_000 }]);

    const won = setup();
    await handleStripeEvent(event("charge.dispute.closed", { id: "dp_1", charge: "ch_1", status: "won", amount: 10_000 }), won.deps);
    expect(won.calls).toEqual([]);
  });

  test("every commission refund on the charge is audited, keyed so none is recorded twice", async () => {
    // A retry after the money moved but the audit write failed: nothing more is
    // due, yet the earlier refund must still end up in the log.
    const t = setup({ refundCommission: async () => [{ id: "fr_1", amount: 1249 }, { id: "fr_2", amount: 1249 }] });
    await handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps);
    expect(t.calls.map((c) => c[4])).toEqual(["fr_1", "fr_2"]);
  });

  test("nothing is recorded when the charge carried no commission", async () => {
    const t = setup({ refundCommission: async () => [] });
    await handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps);
    expect(t.calls).toEqual([]);
  });

  test("a new dispute is recorded, and no money moves", async () => {
    const t = setup();
    await handleStripeEvent(event("charge.dispute.created", { id: "dp_1", charge: "ch_1", amount: 5000, reason: "fraudulent" }), t.deps);
    expect(t.calls).toEqual([["audit", "payment.dispute-opened", "acct_1", { disputeId: "dp_1", chargeId: "ch_1", amount: 5000, reason: "fraudulent" }, "dp_1"]]);
  });

  test("a charge event with no connected account is not ours to act on", async () => {
    const t = setup();
    expect(await handleStripeEvent(event("charge.refunded", { id: "ch_1" }, null), t.deps)).toBe("ignored");
    expect(t.calls).toEqual([]);
  });

  test("Stripe redelivering an event does nothing the second time", async () => {
    const t = setup();
    await handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps);
    expect(await handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps)).toBe("duplicate");
    expect(t.calls.filter((c) => c[0] === "refund").length).toBe(1);
  });

  test("an event is only marked done after its work succeeded, so a crash or failure is retried", async () => {
    let attempts = 0;
    const t = setup({
      refundCommission: async () => {
        if (attempts++ === 0) throw new Error("Stripe unreachable");
        return [{ id: "fr_1", amount: 100 }];
      },
    });
    await expect(handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps)).rejects.toThrow();
    expect(t.processed.size).toBe(0);
    expect(await handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps)).toBe("handled");
  });

  test("a test-mode event reaching the live deployment is ignored, not retried for days", async () => {
    const t = setup({ livemode: true });
    expect(await handleStripeEvent(event("charge.refunded", { id: "ch_1" }), t.deps)).toBe("ignored");
    expect(t.calls).toEqual([]);
  });


  test("events this app has no use for are acknowledged and ignored", async () => {
    const t = setup();
    expect(await handleStripeEvent(event("customer.created", { id: "cus_1" }), t.deps)).toBe("ignored");
    expect(t.calls).toEqual([]);
  });
});

describe("handleStripeEvent: booking checkouts", () => {
  const INTENT = "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a5b";
  const session = (over: Record<string, unknown> = {}) => ({
    id: "cs_test_1",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 48_250,
    metadata: { bookingIntentId: INTENT },
    ...over,
  });

  function checkoutSetup() {
    const t = setup();
    t.deps.onCheckoutPaid = async (i) => void t.calls.push(["paid", i]);
    t.deps.onCheckoutFailed = async (i) => void t.calls.push(["failed", i]);
    t.deps.onCheckoutExpired = async (i) => void t.calls.push(["expired", i]);
    return t;
  }

  const paid = { eventId: "evt_1", intentId: INTENT, sessionId: "cs_test_1", paymentIntentId: "pi_1", stripeAccountId: "acct_1", amountCents: 48_250 };

  test("a paid checkout confirms the intent it was opened for, with the payment as Stripe charged it", async () => {
    const t = checkoutSetup();
    expect(await handleStripeEvent(event("checkout.session.completed", session()), t.deps)).toBe("handled");
    expect(t.calls).toEqual([["paid", paid]]);
    expect(t.processed.has("evt_1")).toBe(true);
  });

  test("a completed checkout still waiting on a bank is left for async_payment_succeeded", async () => {
    const t = checkoutSetup();
    expect(await handleStripeEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })), t.deps)).toBe("ignored");
    expect(t.calls).toEqual([]);
    expect(t.processed.size).toBe(0);
  });

  test("a bank payment that clears later confirms the intent the same way", async () => {
    const t = checkoutSetup();
    expect(await handleStripeEvent(event("checkout.session.async_payment_succeeded", session()), t.deps)).toBe("handled");
    expect(t.calls).toEqual([["paid", paid]]);
  });

  test("a bank payment that fails releases the intent", async () => {
    const t = checkoutSetup();
    expect(await handleStripeEvent(event("checkout.session.async_payment_failed", session({ payment_status: "unpaid" })), t.deps)).toBe("handled");
    expect(t.calls).toEqual([["failed", { intentId: INTENT, sessionId: "cs_test_1" }]]);
  });

  test("an expired checkout ends the intent's hold", async () => {
    const t = checkoutSetup();
    const expired = session({ payment_status: "unpaid", payment_intent: null, amount_total: 48_250 });
    expect(await handleStripeEvent(event("checkout.session.expired", expired), t.deps)).toBe("handled");
    expect(t.calls).toEqual([["expired", { intentId: INTENT, sessionId: "cs_test_1" }]]);
  });

  test("a checkout that is not a booking intent's is not ours to act on", async () => {
    const t = checkoutSetup();
    for (const type of [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ]) {
      expect(await handleStripeEvent(event(type, session({ metadata: {} })), t.deps)).toBe("ignored");
    }
    expect(t.calls).toEqual([]);
    expect(t.processed.size).toBe(0);
  });

  test("a test-mode checkout reaching the live deployment is ignored", async () => {
    const t = checkoutSetup();
    t.deps.livemode = true;
    expect(await handleStripeEvent(event("checkout.session.completed", session()), t.deps)).toBe("ignored");
    expect(t.calls).toEqual([]);
  });
});

describe("handleStripeEvent: one endpoint per app", () => {
  test("an app without the commission handlers ignores refunds and disputes, and records nothing", async () => {
    // The booking endpoint wires only checkout handlers. Recording a refund it
    // cannot act on would make the host endpoint skip it as a duplicate.
    const t = setup({ refundCommission: undefined, audit: undefined });
    for (const [type, object] of [
      ["charge.refunded", { id: "ch_1" }],
      ["charge.dispute.closed", { id: "dp_1", charge: "ch_1", status: "lost", amount: 100 }],
      ["charge.dispute.created", { id: "dp_1", charge: "ch_1", amount: 100 }],
    ] as const) {
      expect(await handleStripeEvent(event(type, object), t.deps)).toBe("ignored");
    }
    expect(t.processed.size).toBe(0);
  });

  test("an app without the checkout handlers ignores checkouts, and records nothing", async () => {
    const t = setup();
    const paidSession = { id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 100, metadata: { bookingIntentId: "i1" } };
    expect(await handleStripeEvent(event("checkout.session.completed", paidSession), t.deps)).toBe("ignored");
    expect(t.processed.size).toBe(0);
  });
});

describe("application fee events (platform webhook)", () => {
  const fee = { id: "fee_1", amount: 1250, currency: "eur", created: 1_700_000_000, account: "acct_1", charge: "ch_1" };
  const refund = (id: string, amount: number) => ({ id, amount, created: 1_700_000_100, fee: "fee_1" });

  test("application_fee.created calls onApplicationFee with the fee", async () => {
    const seen: unknown[] = [];
    const t = setup({ onApplicationFee: async (input) => void seen.push(input) });
    const outcome = await handleStripeEvent(event("application_fee.created", fee, null), t.deps);
    expect(outcome).toBe("handled");
    expect(seen).toEqual([{ ...fee, eventId: "evt_1" }]);
    expect(t.processed.has("evt_1")).toBe(true);
  });

  test("application_fee.refunded passes every refund on the fee", async () => {
    const seen: unknown[] = [];
    const t = setup({ onApplicationFeeRefunded: async (input) => void seen.push(input) });
    const object = { ...fee, refunds: { data: [refund("fr_1", 300), refund("fr_2", 200)], has_more: true } };
    await handleStripeEvent(event("application_fee.refunded", object, null), t.deps);
    expect(seen).toEqual([
      { eventId: "evt_1", fee, refunds: [refund("fr_1", 300), refund("fr_2", 200)], hasMoreRefunds: true },
    ]);
  });

  test("a connected-account event of these types is ignored", async () => {
    const seen: unknown[] = [];
    const t = setup({
      onApplicationFee: async (i) => void seen.push(i),
      onApplicationFeeRefunded: async (i) => void seen.push(i),
    });
    expect(await handleStripeEvent(event("application_fee.created", fee, "acct_1"), t.deps)).toBe("ignored");
    expect(await handleStripeEvent(event("application_fee.refunded", { ...fee, refunds: { data: [] } }, "acct_1"), t.deps)).toBe("ignored");
    expect(seen).toEqual([]);
    expect(t.processed.size).toBe(0);
  });

  test("a malformed fee is ignored, never recorded", async () => {
    const seen: unknown[] = [];
    const t = setup({ onApplicationFee: async (i) => void seen.push(i) });
    expect(await handleStripeEvent(event("application_fee.created", { ...fee, charge: null }, null), t.deps)).toBe("ignored");
    expect(seen).toEqual([]);
  });
});

describe("readPaidCheckout", () => {
  const session = (over: Record<string, unknown> = {}) => ({
    id: "cs_1",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 48_250,
    metadata: { bookingIntentId: "i1" },
    ...over,
  });
  const expected = { intentId: "i1", sessionId: "cs_1", paymentIntentId: "pi_1", stripeAccountId: "acct_1", amountCents: 48_250 };

  test("reads a paid booking session, as an event carries it", () => {
    expect(readPaidCheckout(session(), "acct_1")).toEqual(expected);
  });

  test("reads a session retrieved with its payment intent expanded", () => {
    expect(readPaidCheckout(session({ payment_intent: { id: "pi_1", status: "succeeded" } }), "acct_1")).toEqual(expected);
  });

  test("is null for anything that is not a paid booking checkout", () => {
    expect(readPaidCheckout(session({ payment_status: "unpaid" }), "acct_1")).toBeNull();
    expect(readPaidCheckout(session({ metadata: {} }), "acct_1")).toBeNull();
    expect(readPaidCheckout(session({ payment_intent: null }), "acct_1")).toBeNull();
    expect(readPaidCheckout(session(), null)).toBeNull();
    expect(readPaidCheckout(null, "acct_1")).toBeNull();
  });
});

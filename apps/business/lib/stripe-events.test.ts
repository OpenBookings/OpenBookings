import { describe, expect, test } from "bun:test";
import { handleStripeEvent, type StripeEventDeps, type StripeEventLike } from "./stripe-events";

function setup(over: Partial<StripeEventDeps> = {}) {
  const calls: unknown[][] = [];
  const processed = new Set<string>();
  const deps: StripeEventDeps = {
    livemode: false,
    isProcessed: async (id) => processed.has(id),
    markProcessed: async (id) => void processed.add(id),
    markOnboardingComplete: async (account) => void calls.push(["complete", account]),
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
  test("an account that can take payments and be paid out completes onboarding", async () => {
    const t = setup();
    expect(await handleStripeEvent(event("account.updated", readyAccount), t.deps)).toBe("handled");
    expect(t.calls).toEqual([["complete", "acct_1"]]);
  });

  test("an account still missing something does not", async () => {
    for (const account of [
      { ...readyAccount, payouts_enabled: false },
      { ...readyAccount, charges_enabled: false },
      { ...readyAccount, requirements: { currently_due: ["external_account"] } },
    ]) {
      const t = setup();
      await handleStripeEvent(event("account.updated", account), t.deps);
      expect(t.calls).toEqual([]);
    }
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

  test("events with no work yet are left unmarked, so they can be replayed once there is some", async () => {
    const t = setup();
    expect(await handleStripeEvent(event("checkout.session.completed", { id: "cs_1" }), t.deps)).toBe("ignored");
    expect(t.processed.size).toBe(0);
  });

  test("events this app has no use for are acknowledged and ignored", async () => {
    const t = setup();
    expect(await handleStripeEvent(event("customer.created", { id: "cus_1" }), t.deps)).toBe("ignored");
    expect(t.calls).toEqual([]);
  });
});

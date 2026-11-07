import { describe, expect, spyOn, test } from "bun:test";
import { IntentNotFoundError, type ConvertResult } from "@openbookings/db";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";
import { confirmPaidCheckout, type ConfirmationDeps } from "./booking-confirmation";

const INTENT = "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a5b";
const NOW = new Date("2031-11-10T12:00:00Z");
const paid = {
  eventId: "evt_1",
  intentId: INTENT,
  sessionId: "cs_test_1",
  paymentIntentId: "pi_1",
  stripeAccountId: "acct_1",
  amountCents: 48_250,
};

const confirmed = (firstTime: boolean, paymentReference = "pi_1"): ConvertResult => ({
  outcome: "confirmed",
  bookingId: "b-1",
  firstTime,
  paymentReference,
});
const oversold = (firstTime: boolean, paymentIntentId = "pi_1"): ConvertResult => ({
  outcome: "oversold",
  firstTime,
  paymentIntentId,
  accountId: "acct_1",
  amountCents: 48_250,
});

/** Fakes for every dependency; `results` are what successive conversions return. */
function setup(results: (ConvertResult | Error)[], over: Partial<ConfirmationDeps> = {}) {
  const calls: unknown[][] = [];
  const db = {} as LifecycleDb;
  let intentStatus = "open";
  const deps: ConfirmationDeps = {
    db,
    now: () => NOW,
    convert: async (passedDb, i) => {
      calls.push(["convert", passedDb === db, i]);
      const next = results.shift();
      if (!next) throw new Error("no more results");
      if (next instanceof Error) throw next;
      if (next.outcome === "oversold" && intentStatus === "open") intentStatus = "oversold";
      return next;
    },
    markRefunded: async (_db, i) => {
      calls.push(["markRefunded", i]);
      if (intentStatus !== "oversold") return false;
      intentStatus = "refunded_oversold";
      return true;
    },
    refund: async (i) => {
      calls.push(["refund", i]);
      return { id: "re_1", status: "succeeded" };
    },
    findRefund: async (i) => {
      calls.push(["findRefund", i]);
      return null;
    },
    sendConfirmed: async (bookingId) => void calls.push(["sendConfirmed", bookingId]),
    sendOversold: async (intentId) => void calls.push(["sendOversold", intentId]),
    report: (error, context) =>
      void calls.push(["report", error instanceof Error ? error.message : error, context.level, context.tags]),
    ...over,
  };
  return { deps, calls, of: (name: string) => calls.filter((c) => c[0] === name) };
}

describe("confirmPaidCheckout", () => {
  test("converts the intent with the payment as charged", async () => {
    const t = setup([confirmed(true)]);
    await confirmPaidCheckout(paid, t.deps);
    expect(t.of("convert")).toEqual([
      ["convert", true, { intentId: INTENT, paymentIntentId: "pi_1", accountId: "acct_1", amountCents: 48_250, now: NOW }],
    ]);
  });

  test("a booking confirmed the first time sends the confirmation once", async () => {
    const t = setup([confirmed(true)]);
    await confirmPaidCheckout(paid, t.deps);
    expect(t.of("sendConfirmed")).toEqual([["sendConfirmed", "b-1"]]);
    expect(t.of("refund")).toEqual([]);
  });

  test("a booking already confirmed (a redelivered event) is not sent again", async () => {
    const t = setup([confirmed(false)]);
    await confirmPaidCheckout(paid, t.deps);
    expect(t.of("sendConfirmed")).toEqual([]);
    expect(t.of("refund")).toEqual([]);
  });

  test("a confirmation email that fails does not fail the webhook: the booking stands", async () => {
    const t = setup([confirmed(true)], {
      sendConfirmed: async () => {
        throw new Error("mail provider down");
      },
    });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(confirmPaidCheckout(paid, t.deps)).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
    expect(t.of("report").length).toBe(1);
  });

  test("oversold refunds once across retries", async () => {
    const t = setup([oversold(true), oversold(false)]);
    await confirmPaidCheckout(paid, t.deps);
    await confirmPaidCheckout(paid, t.deps);

    const refund = {
      paymentIntentId: "pi_1",
      stripeAccountId: "acct_1",
      amountCents: 48_250,
      idempotencyKey: `oversold:${INTENT}`,
      metadata: { intentId: INTENT, reason: "oversold" },
    };
    // Same key both times: Stripe answers the second with the first refund.
    expect(t.of("refund")).toEqual([["refund", refund], ["refund", refund]]);
    expect(t.of("markRefunded")).toEqual([
      ["markRefunded", { intentId: INTENT, refundId: "re_1" }],
      ["markRefunded", { intentId: INTENT, refundId: "re_1" }],
    ]);
    expect(t.of("sendOversold")).toEqual([["sendOversold", INTENT]]);
    expect(t.of("sendConfirmed")).toEqual([]);
  });

  test("a refund that fails is thrown, so Stripe retries the event", async () => {
    const t = setup([oversold(true)], {
      refund: async () => {
        throw new Error("Stripe unreachable");
      },
    });
    await expect(confirmPaidCheckout(paid, t.deps)).rejects.toThrow("Stripe unreachable");
    // Thrown for Stripe to retry, and reported: the route only logs a 500.
    expect(t.of("report")).toEqual([["report", "Stripe unreachable", "error", { reason: "oversold", intentId: INTENT }]]);
    expect(t.of("markRefunded")).toEqual([]);
    expect(t.of("sendOversold")).toEqual([]);
  });

  test("an oversold refund already on Stripe is found, not made again: idempotency keys expire after a day", async () => {
    const t = setup([oversold(true)], {
      findRefund: async (i) => {
        t.calls.push(["findRefund", i]);
        return { id: "re_earlier" };
      },
    });
    await confirmPaidCheckout(paid, t.deps);
    expect(t.of("findRefund")).toEqual([
      ["findRefund", { paymentIntentId: "pi_1", stripeAccountId: "acct_1", metadata: { intentId: INTENT, reason: "oversold" } }],
    ]);
    expect(t.of("refund")).toEqual([]);
    expect(t.of("markRefunded")).toEqual([["markRefunded", { intentId: INTENT, refundId: "re_earlier" }]]);
    expect(t.of("sendOversold")).toEqual([["sendOversold", INTENT]]);
  });

  test("a second payment for an already confirmed intent is refunded in full, and no confirmation is sent", async () => {
    const t = setup([confirmed(false, "pi_first")]);
    await confirmPaidCheckout(paid, t.deps);
    expect(t.of("refund")).toEqual([
      [
        "refund",
        {
          paymentIntentId: "pi_1",
          stripeAccountId: "acct_1",
          amountCents: 48_250,
          idempotencyKey: "duplicate:pi_1",
          metadata: { intentId: INTENT, reason: "duplicate" },
        },
      ],
    ]);
    expect(t.of("sendConfirmed")).toEqual([]);
    // Reported once, after the money went back.
    expect(t.calls.map((c) => c[0])).toEqual(["convert", "findRefund", "refund", "report"]);
    expect(t.of("report").map((c) => [c[2], c[3]])).toEqual([["error", { reason: "duplicate", intentId: INTENT }]]);
  });

  test("a duplicate refund already on Stripe is found, not made again", async () => {
    const t = setup([confirmed(false, "pi_first")], {
      findRefund: async (i) => {
        t.calls.push(["findRefund", i]);
        return { id: "re_earlier" };
      },
    });
    await confirmPaidCheckout(paid, t.deps);
    expect(t.of("findRefund")).toEqual([
      ["findRefund", { paymentIntentId: "pi_1", stripeAccountId: "acct_1", metadata: { intentId: INTENT, reason: "duplicate" } }],
    ]);
    expect(t.of("refund")).toEqual([]);
    expect(t.of("report").length).toBe(1);
  });

  test("a second payment for an oversold intent is refunded as a duplicate, not as the oversold payment", async () => {
    const t = setup([oversold(false, "pi_first")]);
    await confirmPaidCheckout(paid, t.deps);
    expect(t.of("refund").map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey)).toEqual(["duplicate:pi_1"]);
    expect(t.of("markRefunded")).toEqual([]);
    expect(t.of("sendOversold")).toEqual([]);
  });

  test("a duplicate refund that fails is reported and thrown, so Stripe retries the event", async () => {
    const t = setup([confirmed(false, "pi_first")], {
      refund: async () => {
        throw new Error("Stripe unreachable");
      },
    });
    await expect(confirmPaidCheckout(paid, t.deps)).rejects.toThrow("Stripe unreachable");
    expect(t.of("report")).toEqual([["report", "Stripe unreachable", "error", { reason: "duplicate", intentId: INTENT }]]);
  });

  test("a refund lookup that fails is reported and thrown too", async () => {
    const t = setup([oversold(true)], {
      findRefund: async () => {
        throw new Error("rate limited");
      },
    });
    await expect(confirmPaidCheckout(paid, t.deps)).rejects.toThrow("rate limited");
    expect(t.of("report").map((c) => c[1])).toEqual(["rate limited"]);
    expect(t.of("refund")).toEqual([]);
  });

  test("a payment for an intent that does not exist is reported, not retried", async () => {
    const t = setup([new IntentNotFoundError(INTENT)]);
    await expect(confirmPaidCheckout(paid, t.deps)).resolves.toBeUndefined();
    expect(t.of("report").map((c) => c[2])).toEqual(["error"]);
    expect(t.of("refund")).toEqual([]);
  });

  test("any other database failure is thrown, so Stripe retries the event", async () => {
    const t = setup([new Error("connection reset")]);
    await expect(confirmPaidCheckout(paid, t.deps)).rejects.toThrow("connection reset");
  });
});

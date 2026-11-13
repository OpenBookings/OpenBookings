import { describe, expect, test } from "bun:test";
import type { UnsettledPayment } from "@openbookings/db";
import type { ConfirmationOutcome } from "./booking-confirmation";
import { reconcilePayments, type ReconcileDeps } from "./reconcile";

const INTENT = "6f1c2b9e-3d4a-4e5f-8a7b-0c1d2e3f4a5b";
const unsettled = (intentId = INTENT, sessionId = "cs_test_1"): UnsettledPayment => ({
  intentId,
  sessionId,
  accountId: "acct_1",
});
const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  status: "complete",
  payment_status: "paid",
  // Retrieved sessions come back with the payment intent expanded.
  payment_intent: { id: "pi_1", status: "succeeded" },
  amount_total: 48_250,
  metadata: { bookingIntentId: INTENT },
  ...over,
});

function setup(
  payments: UnsettledPayment[],
  sessions: Record<string, unknown | Error>,
  outcomes: Record<string, ConfirmationOutcome> = {},
) {
  const calls: unknown[][] = [];
  const deps: ReconcileDeps = {
    list: async () => payments,
    retrieve: async (sessionId, accountId) => {
      calls.push(["retrieve", sessionId, accountId]);
      const found = sessions[sessionId];
      if (found instanceof Error) throw found;
      return found;
    },
    confirm: async (paid) => {
      calls.push(["confirm", paid]);
      return outcomes[paid.sessionId] ?? "confirmed";
    },
    expire: async (intentId) => void calls.push(["expire", intentId]),
    report: (error, extra) => void calls.push(["report", String(error), extra]),
  };
  return { deps, calls };
}

describe("reconcilePayments", () => {
  test("a session Stripe reports paid is confirmed exactly as the webhook would have", async () => {
    const t = setup([unsettled()], { cs_test_1: session() });
    expect(await reconcilePayments(t.deps)).toEqual({ checked: 1, paid: 1, refused: 0, expired: 0, waiting: 0, failed: 0 });
    expect(t.calls).toEqual([
      ["retrieve", "cs_test_1", "acct_1"],
      [
        "confirm",
        { eventId: null, intentId: INTENT, sessionId: "cs_test_1", paymentIntentId: "pi_1", stripeAccountId: "acct_1", amountCents: 48_250 },
      ],
    ]);
  });

  test("a paid session the confirmation refused is counted as refused, not paid", async () => {
    const t = setup([unsettled()], { cs_test_1: session() }, { cs_test_1: "refused" });
    expect(await reconcilePayments(t.deps)).toEqual({ checked: 1, paid: 0, refused: 1, expired: 0, waiting: 0, failed: 0 });
  });

  test("a payment refunded because the rooms were gone still counts as settled", async () => {
    const t = setup([unsettled()], { cs_test_1: session() }, { cs_test_1: "refunded" });
    expect(await reconcilePayments(t.deps)).toMatchObject({ paid: 1, refused: 0 });
  });

  test("a session that lapsed unpaid ends the intent's hold", async () => {
    const t = setup([unsettled()], { cs_test_1: session({ status: "expired", payment_status: "unpaid", payment_intent: null }) });
    expect(await reconcilePayments(t.deps)).toMatchObject({ expired: 1, paid: 0 });
    expect(t.calls[1]).toEqual(["expire", INTENT]);
  });

  test("a session still open, or a bank payment still clearing, is left for a later run", async () => {
    const t = setup([unsettled(INTENT, "cs_open"), unsettled(INTENT, "cs_clearing")], {
      cs_open: session({ id: "cs_open", status: "open", payment_status: "unpaid", payment_intent: null }),
      cs_clearing: session({ id: "cs_clearing", status: "complete", payment_status: "unpaid" }),
    });
    expect(await reconcilePayments(t.deps)).toEqual({ checked: 2, paid: 0, refused: 0, expired: 0, waiting: 2, failed: 0 });
    expect(t.calls.filter((c) => c[0] !== "retrieve")).toEqual([]);
  });

  test("a paid session naming a different intent is reported, never confirmed", async () => {
    const other = "11111111-2222-4333-8444-555555555555";
    const t = setup([unsettled()], { cs_test_1: session({ metadata: { bookingIntentId: other } }) });
    expect(await reconcilePayments(t.deps)).toMatchObject({ paid: 0, failed: 1 });
    expect(t.calls.some((c) => c[0] === "confirm")).toBe(false);
    expect(t.calls.some((c) => c[0] === "report")).toBe(true);
  });

  test("one payment failing is reported and the rest are still checked", async () => {
    const second = "22222222-3333-4444-8555-666666666666";
    const t = setup([unsettled(INTENT, "cs_broken"), unsettled(second, "cs_test_2")], {
      cs_broken: new Error("Stripe unreachable"),
      cs_test_2: session({ id: "cs_test_2", metadata: { bookingIntentId: second } }),
    });
    expect(await reconcilePayments(t.deps)).toEqual({ checked: 2, paid: 1, refused: 0, expired: 0, waiting: 0, failed: 1 });
    const report = t.calls.find((c) => c[0] === "report");
    expect(report?.[2]).toEqual({ intentId: INTENT, sessionId: "cs_broken", accountId: "acct_1" });
  });
});

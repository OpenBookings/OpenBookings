import type { UnsettledPayment } from "@openbookings/db";
import { readPaidCheckout } from "@openbookings/stripe";
import type { PaidCheckout } from "./booking-confirmation";

/**
 * The safety net under the Stripe webhook: asks Stripe how each unsettled
 * payment session ended, and settles it the way the webhook would have.
 *
 * The webhook can miss a payment for good: an outage longer than Stripe's
 * three days of retries, a wrong signing secret, an endpoint nobody set up.
 * Without this, a guest who paid would have no booking and nobody would know.
 *
 * Safe to run at any time, as often as wanted, and at the same moment as the
 * webhook: a paid session goes through `confirmPaidCheckout`, which turns an
 * intent into one booking (or one refund) however often it is called.
 */
export type ReconcileDeps = {
  list: () => Promise<UnsettledPayment[]>;
  /** The Checkout Session as Stripe has it now, on the host's account. */
  retrieve: (sessionId: string, accountId: string) => Promise<unknown>;
  confirm: (paid: PaidCheckout) => Promise<void>;
  /** The session lapsed unpaid: an intent still open stops holding its rooms. */
  expire: (intentId: string) => Promise<void>;
  /** Something a person must look at (Sentry). */
  report: (error: unknown, extra: UnsettledPayment) => void;
};

export type ReconcileSummary = {
  checked: number;
  /** Turned into a booking, or refunded because the rooms were gone. */
  paid: number;
  expired: number;
  /** Still open at Stripe, or a bank payment still clearing: next run. */
  waiting: number;
  failed: number;
};

export async function reconcilePayments(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, paid: 0, expired: 0, waiting: 0, failed: 0 };

  // One at a time: a backlog after an outage should not burst Stripe's rate limit.
  for (const payment of await deps.list()) {
    summary.checked++;
    try {
      summary[await settle(payment, deps)]++;
    } catch (error) {
      deps.report(error, payment);
      summary.failed++;
    }
  }
  return summary;
}

async function settle(payment: UnsettledPayment, deps: ReconcileDeps): Promise<"paid" | "expired" | "waiting"> {
  const session = await deps.retrieve(payment.sessionId, payment.accountId);

  const paid = readPaidCheckout(session, payment.accountId);
  if (paid) {
    // The session was found through this intent's row; metadata naming another
    // intent means something is badly wrong, and guessing could book the wrong guest.
    if (paid.intentId !== payment.intentId) {
      throw new Error(`Session ${payment.sessionId} names intent ${paid.intentId}, not ${payment.intentId}`);
    }
    await deps.confirm({ ...paid, eventId: null });
    return "paid";
  }

  if ((session as { status?: unknown } | null)?.status === "expired") {
    await deps.expire(payment.intentId);
    return "expired";
  }
  return "waiting";
}

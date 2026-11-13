import { convertIntentToBooking, IntentNotFoundError, markIntentRefundedOversold, PaymentMismatchError } from "@openbookings/db";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";
import type { findRefundByMetadata, PaidCheckout as StripePaidCheckout, refundPayment } from "@openbookings/stripe";

/**
 * What a paid booking checkout becomes: a confirmed booking, or — when the
 * rooms were gone by the time the money arrived — a full refund.
 *
 * Runs once per Stripe delivery, and Stripe delivers at least once, and the
 * payment reconciliation may run it again for a payment the webhook already
 * settled (or is settling at that moment), so every step is safe to repeat: the conversion returns what an earlier call did, and
 * each refund carries an idempotency key, so a retry never pays out twice. A
 * failed refund is thrown for that reason: Stripe retries the event, and the
 * guest is not left without their money. Stripe forgets idempotency keys
 * after about a day, so a refund is looked up on Stripe before it is made: a
 * replay days later finds the first refund instead of being refused for good.
 */
export type ConfirmationDeps = {
  db: LifecycleDb;
  refund: typeof refundPayment;
  /** A refund this module already made for the payment, recognised by its metadata. */
  findRefund: typeof findRefundByMetadata;
  now: () => Date;
  /** Never allowed to fail the webhook: the booking stands without its email. */
  sendConfirmed: (bookingId: string) => Promise<void>;
  sendOversold: (intentId: string) => Promise<void>;
  /** Something a person must look at (Sentry). */
  report: (
    error: unknown,
    context: { level: "error" | "warning"; tags?: Record<string, string>; extra: Record<string, unknown> },
  ) => void;
  /** Tests replace these; the app uses the real ones. */
  convert?: typeof convertIntentToBooking;
  markRefunded?: typeof markIntentRefundedOversold;
};

/**
 * A paid checkout, from the webhook (`eventId`) or found by the payment
 * reconciliation (`eventId: null`). Either way the same steps run.
 */
export type PaidCheckout = StripePaidCheckout & { eventId: string | null };

export async function confirmPaidCheckout(i: PaidCheckout, deps: ConfirmationDeps): Promise<void> {
  const convert = deps.convert ?? convertIntentToBooking;
  const markRefunded = deps.markRefunded ?? markIntentRefundedOversold;
  const extra = { intentId: i.intentId, sessionId: i.sessionId, paymentIntentId: i.paymentIntentId, eventId: i.eventId };

  let result;
  try {
    result = await convert(deps.db, {
      intentId: i.intentId,
      sessionId: i.sessionId,
      paymentIntentId: i.paymentIntentId,
      accountId: i.stripeAccountId,
      amountCents: i.amountCents,
      now: deps.now(),
    });
  } catch (error) {
    // Our own metadata names an intent we do not have. A retry cannot fix
    // that, so the event is acknowledged and a person is told: the guest paid
    // for something, and someone has to find out what.
    if (error instanceof IntentNotFoundError) {
      deps.report(error, { level: "error", extra });
      return;
    }
    // Paid, but not on a session the platform made for this intent, or on
    // another account, or for another amount: it confirms nothing. Never
    // refunded automatically either: a person looks at it and decides.
    if (error instanceof PaymentMismatchError) {
      deps.report(error, {
        level: "error",
        tags: { reason: "payment_mismatch", mismatch: error.reason, intentId: i.intentId },
        extra: { ...extra, stripeAccountId: i.stripeAccountId, amountCents: i.amountCents },
      });
      return;
    }
    throw error;
  }

  // The intent was already paid with another payment (a second session, a
  // second tab). This one bought nothing: all of it goes back.
  const stored = result.outcome === "confirmed" ? result.paymentReference : result.paymentIntentId;
  if (stored !== i.paymentIntentId) {
    const refund = await refundInFull(i, deps, "duplicate");
    deps.report(new Error(`Second payment for booking intent ${i.intentId} refunded in full`), {
      level: "error",
      tags: { reason: "duplicate", intentId: i.intentId },
      extra: { ...extra, keptPaymentIntentId: stored, refundId: refund.id },
    });
    return;
  }

  if (result.outcome === "confirmed") {
    if (!result.firstTime) return;
    await deps.sendConfirmed(result.bookingId).catch((error: unknown) => {
      console.error("[booking-confirmation] confirmation email failed:", error instanceof Error ? error.message : error);
      deps.report(error, { level: "warning", extra: { ...extra, bookingId: result.bookingId } });
    });
    return;
  }

  // Oversold: the rooms went to someone else between the hold and the payment.
  const refund = await refundInFull(i, deps, "oversold");
  // Only the call that moves the intent to refunded tells the guest, so a
  // redelivered event does not email them twice.
  if (!(await markRefunded(deps.db, { intentId: i.intentId, refundId: refund.id }))) return;
  // Not thrown either: a retry would find the intent already refunded and
  // never send it.
  await deps.sendOversold(i.intentId).catch((error: unknown) => {
    console.error("[booking-confirmation] oversold email failed:", error instanceof Error ? error.message : error);
    deps.report(error, { level: "warning", extra });
  });
}

/**
 * This call's payment, back to the guest in full: the refund already made for
 * it if Stripe has one, else a new one. A failure is reported (the route only
 * logs a 500) and thrown, so Stripe retries the event.
 */
async function refundInFull(
  i: PaidCheckout,
  deps: ConfirmationDeps,
  reason: "oversold" | "duplicate",
): Promise<{ id: string }> {
  const metadata = { intentId: i.intentId, reason };
  try {
    const existing = await deps.findRefund({
      paymentIntentId: i.paymentIntentId,
      stripeAccountId: i.stripeAccountId,
      metadata,
    });
    if (existing) return existing;
    return await deps.refund({
      paymentIntentId: i.paymentIntentId,
      stripeAccountId: i.stripeAccountId,
      amountCents: i.amountCents,
      // Oversold: one refund per intent. Duplicate: one per extra payment.
      idempotencyKey: reason === "oversold" ? `oversold:${i.intentId}` : `duplicate:${i.paymentIntentId}`,
      metadata,
    });
  } catch (error) {
    deps.report(error, {
      level: "error",
      tags: { reason, intentId: i.intentId },
      extra: { sessionId: i.sessionId, paymentIntentId: i.paymentIntentId, eventId: i.eventId },
    });
    throw error;
  }
}

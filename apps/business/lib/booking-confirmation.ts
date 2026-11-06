import { convertIntentToBooking, IntentNotFoundError, markIntentRefundedOversold } from "@openbookings/db";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";
import type { refundPayment } from "@openbookings/stripe";
import type { StripeEventDeps } from "./stripe-events";

/**
 * What a paid booking checkout becomes: a confirmed booking, or — when the
 * rooms were gone by the time the money arrived — a full refund.
 *
 * Runs once per Stripe delivery, and Stripe delivers at least once, so every
 * step is safe to repeat: the conversion returns what an earlier call did, and
 * each refund carries an idempotency key, so a retry never pays out twice. A
 * failed refund is thrown for that reason: Stripe retries the event, and the
 * guest is not left without their money.
 */
export type ConfirmationDeps = {
  db: LifecycleDb;
  refund: typeof refundPayment;
  now: () => Date;
  /** Never allowed to fail the webhook: the booking stands without its email. */
  sendConfirmed: (bookingId: string) => Promise<void>;
  sendOversold: (intentId: string) => Promise<void>;
  /** Something a person must look at (Sentry). */
  report: (error: unknown, context: { level: "error" | "warning"; extra: Record<string, unknown> }) => void;
  /** Tests replace these; the app uses the real ones. */
  convert?: typeof convertIntentToBooking;
  markRefunded?: typeof markIntentRefundedOversold;
};

export type PaidCheckout = Parameters<NonNullable<StripeEventDeps["onCheckoutPaid"]>>[0];

export async function confirmPaidCheckout(i: PaidCheckout, deps: ConfirmationDeps): Promise<void> {
  const convert = deps.convert ?? convertIntentToBooking;
  const markRefunded = deps.markRefunded ?? markIntentRefundedOversold;
  const extra = { intentId: i.intentId, sessionId: i.sessionId, paymentIntentId: i.paymentIntentId, eventId: i.eventId };

  let result;
  try {
    result = await convert(deps.db, {
      intentId: i.intentId,
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
    throw error;
  }

  // The intent was already paid with another payment (a second session, a
  // second tab). This one bought nothing: all of it goes back.
  const stored = result.outcome === "confirmed" ? result.paymentReference : result.paymentIntentId;
  if (stored !== i.paymentIntentId) {
    deps.report(new Error(`Second payment for booking intent ${i.intentId}; refunding it in full`), {
      level: "error",
      extra: { ...extra, keptPaymentIntentId: stored },
    });
    await deps.refund({
      paymentIntentId: i.paymentIntentId,
      stripeAccountId: i.stripeAccountId,
      amountCents: i.amountCents,
      idempotencyKey: `duplicate:${i.paymentIntentId}`,
      metadata: { intentId: i.intentId, reason: "duplicate" },
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
  const refund = await deps.refund({
    paymentIntentId: i.paymentIntentId,
    stripeAccountId: i.stripeAccountId,
    amountCents: i.amountCents,
    idempotencyKey: `oversold:${i.intentId}`,
    metadata: { intentId: i.intentId, reason: "oversold" },
  });
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

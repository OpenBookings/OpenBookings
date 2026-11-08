import * as Sentry from '@sentry/nextjs';
import {
  expireIntent,
  getPool,
  isCurrentPaymentSession,
  isStripeEventProcessed,
  listUnsettledPayments,
  markIntentFailed,
  markStripeEventProcessed,
  withTransaction,
} from '@openbookings/db';
import type { LifecycleDb } from '@openbookings/db/booking-lifecycle';
import {
  findRefundByMetadata,
  refundPayment,
  retrieveBookingCheckout,
  type StripeEventDeps,
} from '@openbookings/stripe';
import { sendConfirmed, sendOversold } from '@/lib/mailing/booking-mail';
import { confirmPaidCheckout, type ConfirmationDeps } from './booking-confirmation';
import type { ReconcileDeps } from './reconcile';

/**
 * The real dependencies behind the booking webhook and the payment
 * reconciliation, so the two settle a payment through the same code.
 */

const poolDb: LifecycleDb = {
  query: (text, values) => getPool().query(text, values),
  transaction: (fn) => withTransaction((client) => fn(client)),
};

const confirmation: ConfirmationDeps = {
  db: poolDb,
  refund: refundPayment,
  findRefund: findRefundByMetadata,
  now: () => new Date(),
  sendConfirmed,
  sendOversold,
  report: (error, { level, tags, extra }) =>
    Sentry.captureException(error, { level, tags: { area: 'booking-confirmation', ...tags }, extra }),
};

/**
 * The booking endpoint: checkout events only. Refunds, disputes and the host's
 * account go to the business app's endpoint, which must not be subscribed to
 * these, nor this one to those (see `@openbookings/stripe` events).
 */
export const bookingWebhookDeps: StripeEventDeps = {
  livemode: (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_'),
  isProcessed: isStripeEventProcessed,
  markProcessed: markStripeEventProcessed,
  onCheckoutPaid: (input) => confirmPaidCheckout(input, confirmation),
  // An intent whose unusable session was replaced also hears about the old
  // one, and that must not end the hold the new session is paying against.
  onCheckoutFailed: async ({ intentId, sessionId }) => {
    if (await isCurrentPaymentSession(poolDb, { intentId, sessionId })) await markIntentFailed(poolDb, { intentId });
  },
  // Stripe's session outlives the hold, so the hold has normally lapsed by now;
  // `force` ends it either way: an expired session can no longer be paid.
  onCheckoutExpired: async ({ intentId, sessionId }) => {
    if (await isCurrentPaymentSession(poolDb, { intentId, sessionId })) {
      await expireIntent(poolDb, { intentId, now: new Date(), force: true });
    }
  },
};

/** How long the webhook gets before a session is checked with Stripe directly. */
const GRACE_MINUTES = 10;
/** Past a Checkout Session's lifetime (31 minutes), with room to spare. */
const WINDOW_MINUTES = 120;
/** Per run; a backlog drains over the next runs. */
const BATCH = 100;

export const reconcileDeps: ReconcileDeps = {
  list: () =>
    listUnsettledPayments(poolDb, {
      now: new Date(),
      graceMinutes: GRACE_MINUTES,
      windowMinutes: WINDOW_MINUTES,
      limit: BATCH,
    }),
  retrieve: (sessionId, accountId) => retrieveBookingCheckout(sessionId, accountId),
  confirm: (paid) => confirmPaidCheckout(paid, confirmation),
  // Only the intent's current session is ever listed, so no session check here.
  expire: async (intentId) => {
    await expireIntent(poolDb, { intentId, now: new Date(), force: true });
  },
  report: (error, payment) =>
    Sentry.captureException(error, { level: 'error', tags: { area: 'payment-reconciliation' }, extra: payment }),
};

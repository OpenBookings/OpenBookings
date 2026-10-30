import type Stripe from 'stripe';
import { stripe } from '../client';

/**
 * A refund OpenBookings makes on the host's behalf (Annex B B.5.8): created on
 * the host's connected account, from the host's balance, because the booking
 * was a direct charge there. `refund_application_fee` hands back OpenBookings'
 * commission in the same proportion (B.5.7), so the `charge.refunded` webhook
 * then finds nothing left to return.
 */
export function buildRefundParams(i: {
  paymentIntentId: string;
  amountCents: number;
  metadata: Record<string, string>;
}): Stripe.RefundCreateParams {
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) {
    throw new Error(`A refund must be a whole, positive number of cents (got ${i.amountCents})`);
  }
  return {
    payment_intent: i.paymentIntentId,
    amount: i.amountCents,
    refund_application_fee: true,
    metadata: i.metadata,
  };
}

export type RefundPaymentInput = {
  paymentIntentId: string;
  stripeAccountId: string;
  amountCents: number;
  /** Same key, same refund: a retry after a timeout never pays out twice. */
  idempotencyKey: string;
  metadata: Record<string, string>;
};

export async function refundPayment(i: RefundPaymentInput): Promise<{ id: string; status: string }> {
  const refund = await stripe.refunds.create(buildRefundParams(i), {
    stripeAccount: i.stripeAccountId,
    idempotencyKey: i.idempotencyKey,
  });
  return { id: refund.id, status: refund.status ?? 'pending' };
}

/**
 * Stripe errors that mean the refund was refused, so no money moved. Anything
 * else (a dropped connection, a timeout, a Stripe-side 5xx, a rate limit)
 * might have gone through, and must be checked before it is sent again.
 */
const DEFINITE = new Set([
  'StripeInvalidRequestError',
  'StripeCardError',
  'StripePermissionError',
  'StripeAuthenticationError',
  'StripeIdempotencyError',
]);

export function isDefiniteRefundFailure(error: unknown): boolean {
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' && DEFINITE.has(type);
}

/** The live refund made for our refund row `refundId`, if any. */
export function matchRefund(
  refunds: { id: string; status: string | null; metadata?: Record<string, string> | null }[],
  refundId: string,
): { id: string } | null {
  const found = refunds.find((r) => r.metadata?.refundId === refundId && r.status !== 'failed' && r.status !== 'canceled');
  return found ? { id: found.id } : null;
}

/**
 * Look on the host's account for a refund already made for our row. Run
 * before resending, because Stripe forgets idempotency keys after about a day:
 * a retry the next day would otherwise pay out twice if the first attempt
 * did go through.
 */
export async function findRefundForRow(i: {
  paymentIntentId: string;
  stripeAccountId: string;
  refundRowId: string;
}): Promise<{ id: string } | null> {
  const list = await stripe.refunds.list(
    { payment_intent: i.paymentIntentId, limit: 100 },
    { stripeAccount: i.stripeAccountId },
  );
  return matchRefund(list.data, i.refundRowId);
}

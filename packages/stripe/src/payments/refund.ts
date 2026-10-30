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

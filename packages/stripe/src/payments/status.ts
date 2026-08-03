import Stripe from 'stripe';
import { stripe } from '../client';

export type PaymentRefund = {
  id: string;
  status: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  created: string;
};

export type PaymentSummary = {
  paymentIntentId: string;
  status: Stripe.PaymentIntent.Status;
  amount: number;
  currency: string;
  amountRefunded: number;
  fullyRefunded: boolean;
  /** True when the underlying charge has an open or lost dispute/chargeback. */
  disputed: boolean;
  refunds: PaymentRefund[];
};

/**
 * Read-only payment/refund summary for a payment intent, for support lookups.
 * Amounts are in the smallest currency unit (cents), matching how bookings
 * store totals.
 */
export async function getPaymentSummary(paymentIntentId: string): Promise<PaymentSummary | null> {
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError && err.code === 'resource_missing') {
      return null;
    }
    throw err;
  }

  const charge = intent.latest_charge as Stripe.Charge | null;
  const { data: refunds } = await stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 20,
  });

  const amountRefunded = charge?.amount_refunded ?? 0;
  return {
    paymentIntentId: intent.id,
    status: intent.status,
    amount: intent.amount,
    currency: intent.currency,
    amountRefunded,
    fullyRefunded: charge?.refunded ?? false,
    disputed: charge?.disputed ?? false,
    refunds: refunds.map((r) => ({
      id: r.id,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
      reason: r.reason,
      created: new Date(r.created * 1000).toISOString(),
    })),
  };
}

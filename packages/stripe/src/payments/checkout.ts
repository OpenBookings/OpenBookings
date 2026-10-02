import type Stripe from 'stripe';
import { stripe } from '../client';

export type BookingCheckoutLine = {
  name: string;
  description: string;
  /** What one unit costs, in minor units. */
  unitAmountCents: number;
  quantity: number;
};

export type BookingCheckoutInput = {
  /** The host's connected account. The charge is made on it, not on the platform. */
  stripeAccountId: string;
  customerEmail: string;
  currency: string;
  lines: BookingCheckoutLine[];
  /** OpenBookings' commission in minor units; null or 0 sends no fee at all. */
  applicationFeeCents: number | null;
  metadata: Record<string, string>;
  returnUrl: string;
  /** Unix seconds. */
  expiresAt: number;
  paymentMethodConfiguration?: string;
};

/**
 * Checkout Session parameters for a booking, as a direct charge.
 *
 * Direct means the payment is created on the host's own Stripe account: the
 * host is the merchant, sees the payment in their dashboard, and the money
 * never sits on the platform balance. OpenBookings' share is an application
 * fee. There is deliberately no `transfer_data` and no `on_behalf_of` — those
 * belong to charges made on the platform.
 */
export function buildBookingCheckoutParams(
  input: BookingCheckoutInput,
): Stripe.Checkout.SessionCreateParams {
  if (!input.stripeAccountId) {
    throw new Error('A booking cannot be charged without a connected account');
  }

  const fee = input.applicationFeeCents;

  return {
    mode: 'payment',
    ui_mode: 'form',
    // Prefills the contact block and locks it: the booking is attached to this
    // account, so the confirmation must not go to a different address.
    customer_email: input.customerEmail,
    line_items: input.lines.map((line) => ({
      price_data: {
        currency: input.currency,
        unit_amount: line.unitAmountCents,
        product_data: { name: line.name, description: line.description },
      },
      quantity: line.quantity,
    })),
    // Hosts need a number to reach the guest about arrival.
    phone_number_collection: { enabled: true },
    // Collects the guest's name and address; without it the booking reaches
    // the host anonymous.
    billing_address_collection: 'required',
    ...(input.paymentMethodConfiguration
      ? { payment_method_configuration: input.paymentMethodConfiguration }
      : {}),
    // Absent rather than zero when there is no fee: a present-but-zero fee is
    // still an application fee object on Stripe's side.
    ...(fee && fee > 0 ? { payment_intent_data: { application_fee_amount: fee } } : {}),
    metadata: input.metadata,
    return_url: input.returnUrl,
    expires_at: input.expiresAt,
  };
}

/** Creates the Session on the host's connected account. */
export async function createBookingCheckout(
  input: BookingCheckoutInput,
): Promise<{ id: string; clientSecret: string | null; expiresAt: number }> {
  const session = await stripe.checkout.sessions.create(buildBookingCheckoutParams(input), {
    stripeAccount: input.stripeAccountId,
  });
  return { id: session.id, clientSecret: session.client_secret, expiresAt: session.expires_at };
}

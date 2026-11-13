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
  const intentId = input.metadata.bookingIntentId;

  return {
    mode: 'payment',
    // Stripe's separate elements: the page draws the guest's details itself
    // (from their account) and its own Pay button, and mounts only Stripe's
    // wallet buttons and payment box.
    ui_mode: 'elements',
    // Locked to the account: the booking is attached to it, so the
    // confirmation must not go to a different address.
    customer_email: input.customerEmail,
    line_items: input.lines.map((line) => ({
      price_data: {
        currency: input.currency,
        unit_amount: line.unitAmountCents,
        product_data: { name: line.name, description: line.description },
      },
      quantity: line.quantity,
    })),
    // The page saves the guest's phone to their account (where hosts read
    // it) and sends it on confirm. Stripe.js refuses a phone on confirm
    // unless collection is on, so it stays on; no Stripe element draws a
    // phone field on this page.
    phone_number_collection: { enabled: true },
    // The name and address arrive on confirm too; requiring them here makes
    // Stripe refuse a confirm that leaves them out.
    billing_address_collection: 'required',
    ...(input.paymentMethodConfiguration
      ? { payment_method_configuration: input.paymentMethodConfiguration }
      : {}),
    // Absent rather than zero when there is no fee: a present-but-zero fee is
    // still an application fee object on Stripe's side.
    // The PaymentIntent carries the intent id too, so a payment can be traced
    // to its booking intent from the PaymentIntent alone.
    ...((fee && fee > 0) || intentId
      ? {
          payment_intent_data: {
            ...(fee && fee > 0 ? { application_fee_amount: fee } : {}),
            ...(intentId ? { metadata: { bookingIntentId: intentId } } : {}),
          },
        }
      : {}),
    metadata: input.metadata,
    return_url: input.returnUrl,
    expires_at: input.expiresAt,
  };
}

/**
 * Creates the Session on the host's connected account. `amountTotal` is what
 * Stripe will charge, in cents: the amount a paid session must match.
 */
export async function createBookingCheckout(
  input: BookingCheckoutInput,
): Promise<{ id: string; clientSecret: string | null; expiresAt: number; amountTotal: number }> {
  const session = await stripe.checkout.sessions.create(buildBookingCheckoutParams(input), {
    stripeAccount: input.stripeAccountId,
  });
  if (session.amount_total === null) throw new Error(`Checkout Session ${session.id} has no amount_total`);
  return { id: session.id, clientSecret: session.client_secret, expiresAt: session.expires_at, amountTotal: session.amount_total };
}

/**
 * Read a booking's Checkout Session back, with its PaymentIntent — which
 * carries `last_payment_error`, the only place a decline reason survives.
 *
 * The Session lives on the host's connected account (direct charge), so it
 * can only be found there.
 */
export function retrieveBookingCheckout(
  sessionId: string,
  stripeAccountId: string,
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.retrieve(
    sessionId,
    { expand: ['payment_intent'] },
    { stripeAccount: stripeAccountId },
  );
}

/**
 * Stripe's refusal to expire a Session that is no longer `open`: it already
 * expired, or the guest completed it. Either way there is nothing left to stop.
 */
const NOT_OPEN = /only checkout sessions with a status in .*open.* can be expired/i;

function isNotOpenError(error: unknown): boolean {
  const e = error as { type?: unknown; message?: unknown } | null;
  return e?.type === 'StripeInvalidRequestError' && typeof e.message === 'string' && NOT_OPEN.test(e.message);
}

/**
 * Stop a booking's Checkout Session from taking payment, on the host's
 * connected account where it lives. A Session that is already expired or
 * complete is left alone; every other error is the caller's to handle.
 */
export async function expireBookingCheckout(sessionId: string, stripeAccountId: string): Promise<void> {
  try {
    await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: stripeAccountId });
  } catch (error) {
    if (isNotOpenError(error)) return;
    throw error;
  }
}

import type Stripe from 'stripe';
import { stripe } from './client';

/**
 * Verify and parse a Stripe webhook. Throws when the signature does not match
 * the raw body, which is the only proof the event came from Stripe.
 *
 * Events for connected accounts carry `event.account`: the host's account the
 * object belongs to.
 */
export function constructWebhookEvent(rawBody: string, signature: string, secret: string): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

export type StripeEvent = Stripe.Event;

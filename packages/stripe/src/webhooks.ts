import type Stripe from 'stripe';
import { stripe } from './client';
import { handleStripeEvent, type StripeEventDeps, type StripeEventLike } from './events';

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

export type WebhookRequestOptions = {
  /** The endpoint's signing secret (`whsec_…`), one per endpoint. */
  secret: string | undefined;
  deps: StripeEventDeps;
  /** Prefixes log lines, e.g. "web" or "business", to tell the two endpoints apart. */
  name: string;
  /** Something a person must look at (Sentry). */
  report: (error: unknown) => void;
  /**
   * A failure that is expected to clear on its own (a fee that arrived before
   * the payment it belongs to was confirmed). Answered with 503 so Stripe
   * retries, and not reported: it is a wait, not a fault.
   */
  retryable?: (error: unknown) => boolean;
  /** Tests replace this; the app uses the real check. */
  verify?: (rawBody: string, signature: string, secret: string) => StripeEventLike;
};

/**
 * One Stripe webhook request, start to finish: prove it came from Stripe, then
 * hand the event to `handleStripeEvent`. Both apps' webhook routes are this.
 *
 * Any answer other than 2xx makes Stripe retry the event for up to three days,
 * so a missing secret is a 500 and reported, not a quiet 400: the events wait
 * at Stripe until the deployment is fixed, instead of reading as forgeries.
 */
export async function handleWebhookRequest(req: Request, options: WebhookRequestOptions): Promise<Response> {
  const tag = `[stripe-webhook:${options.name}]`;

  if (!options.secret) {
    const error = new Error(`STRIPE_WEBHOOK_SECRET is not set for the ${options.name} webhook`);
    console.error(tag, error.message);
    options.report(error);
    return Response.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return Response.json({ error: 'Missing signature' }, { status: 400 });

  const body = await req.text();
  let event: StripeEventLike;
  try {
    event = (options.verify ?? constructWebhookEvent)(body, signature, options.secret);
  } catch {
    // Logged, because a secret from the wrong endpoint looks exactly like this.
    console.warn(tag, 'signature did not verify');
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event, options.deps);
    return Response.json({ received: true, outcome });
  } catch (error) {
    if (options.retryable?.(error)) {
      console.warn(tag, event.type, event.id, 'not ready, Stripe will retry');
      return Response.json({ error: 'Not ready, retry' }, { status: 503 });
    }
    // A 500 makes Stripe retry; the event was not marked done, so the retry runs.
    // The event type and id only: never the body.
    console.error(tag, event.type, event.id, error instanceof Error ? error.message : 'unknown error');
    return Response.json({ error: 'Handler failed' }, { status: 500 });
  }
}

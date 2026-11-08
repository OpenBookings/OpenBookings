import * as Sentry from '@sentry/nextjs';
import { handleWebhookRequest } from '@openbookings/stripe';
import { bookingWebhookDeps } from '@/lib/payments/stripe-deps';

export const dynamic = 'force-dynamic';

/**
 * Stripe's webhook for guests' booking checkouts: a paid checkout becomes a
 * booking (or a refund), a failed or lapsed one releases its rooms.
 *
 * Its own Connect endpoint in Stripe, with its own signing secret, subscribed
 * to the `checkout.session.*` events only:
 *   completed, async_payment_succeeded, async_payment_failed, expired.
 * Everything else about payments goes to the business app's endpoint.
 *
 * Locally: `stripe listen --forward-connect-to localhost:3002/api/stripe/webhook`,
 * and put the `whsec_…` it prints in this app's STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  return handleWebhookRequest(req, {
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    deps: bookingWebhookDeps,
    name: 'web',
    report: (error) => Sentry.captureException(error, { level: 'fatal', tags: { area: 'stripe-webhook' } }),
  });
}

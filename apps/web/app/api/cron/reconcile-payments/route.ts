import * as Sentry from '@sentry/nextjs';
import { bearerAuthorized } from '@openbookings/messaging/cron-auth';
import { reconcilePayments } from '@/lib/payments/reconcile';
import { reconcileDeps } from '@/lib/payments/stripe-deps';

export const dynamic = 'force-dynamic';

/**
 * Settles payments the Stripe webhook missed: asks Stripe about every unsettled
 * checkout and books, refunds or releases it as the webhook would have.
 * Safe to run at any time, as often as wanted.
 *
 * POST /api/cron/reconcile-payments (Authorization: Bearer $CRON_SECRET)
 * → 200 { checked, paid, expired, waiting, failed }
 *
 * Cloud Scheduler target, every 15 minutes:
 *
 *   gcloud scheduler jobs create http reconcile-payments \
 *     --schedule="0,15,30,45 * * * *" \
 *     --uri="https://<web-app-url>/api/cron/reconcile-payments" \
 *     --http-method=POST \
 *     --headers="Authorization=Bearer ${CRON_SECRET}"
 *
 * By hand: the same request with curl.
 */
export async function POST(request: Request) {
  // Constant-time: `!==` would leak the secret's prefix through response timing.
  if (!bearerAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await reconcilePayments(reconcileDeps);
    if (summary.paid > 0) {
      // Each one is a payment the webhook did not settle: worth knowing why.
      Sentry.captureMessage(`Payment reconciliation settled ${summary.paid} payment(s) the webhook missed`, {
        level: 'warning',
        tags: { area: 'payment-reconciliation' },
        extra: summary,
      });
    }
    return Response.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'payment-reconciliation' } });
    console.error('[reconcile-payments]', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Reconciliation failed' }, { status: 500 });
  }
}

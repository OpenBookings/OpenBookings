import * as Sentry from '@sentry/nextjs';
import { getPool } from '@openbookings/db';
import { runReviewInvitations } from '@openbookings/db/reviews';
import { isTestingMode } from '@openbookings/demo';
import { bearerAuthorized } from '@openbookings/messaging/cron-auth';
import { sendReviewMail } from '@openbookings/mailing/review-send';

export const dynamic = 'force-dynamic';

/**
 * Review emails, keyed off each stay's projected check-out (not off
 * check-in/check-out marking, which a sync or PMS will do later and can fail):
 * the host's heads-up at check-out, the guest's invitation 24 hours later, one
 * reminder six days after that. Safe to run at any time, as often as wanted:
 * every send is claimed first.
 *
 * POST /api/cron/review-invitations (Authorization: Bearer $CRON_SECRET)
 * → 200 { hostWarnings, invitations, reminders, failed }
 *
 * Run hourly, on the same scheduler as reconcile-payments.
 */
export async function POST(request: Request) {
  if (!bearerAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runReviewInvitations({
      db: getPool(),
      now: new Date(),
      testing: isTestingMode(),
      send: (mail) => sendReviewMail(mail),
      onError: (error, context) =>
        Sentry.captureException(error, { tags: { area: 'review-invitations', mail: context.kind }, extra: context }),
    });
    return Response.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'review-invitations' } });
    console.error('[review-invitations]', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Review invitations failed' }, { status: 500 });
  }
}

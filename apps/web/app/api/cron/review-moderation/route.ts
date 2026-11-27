import * as Sentry from '@sentry/nextjs';
import { getPool } from '@openbookings/db';
import { runModerationSweep } from '@openbookings/db/reviews';
import { sendMaskedPublicationNotices } from '@openbookings/mailing/review-send';
import { bearerAuthorized } from '@openbookings/messaging/cron-auth';
import { checkText } from '@openbookings/moderation';
import { refreshPropertyReviewPages } from '@/lib/property-reviews';

export const dynamic = 'force-dynamic';

/**
 * Review moderation's clock: rechecks the reviews and replies the automatic
 * check missed (the model failed or timed out), publishes held ones 72 hours
 * after they were written with their flagged parts masked, and deletes
 * moderation records 12 months after the decision. Then the pages of the
 * properties whose public reviews changed are refreshed. Safe to run at any
 * time, as often as wanted: every write is compare-and-set.
 *
 * POST /api/cron/review-moderation (Authorization: Bearer $CRON_SECRET)
 * → 200 { rechecked, published, purged: { reports, texts } }
 *
 * Run every 15 minutes, on the same scheduler as review-invitations.
 */
export async function POST(request: Request) {
  if (!bearerAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { propertyIds, ...summary } = await runModerationSweep({
      db: getPool(),
      now: new Date(),
      check: (text) => checkText(text),
      notify: (items) =>
        sendMaskedPublicationNotices(items, {
          report: (error) => Sentry.captureException(error, { tags: { area: 'review-moderation', phase: 'masked-notice' } }),
        }),
      onError: (error, item) =>
        Sentry.captureException(error, { tags: { area: 'review-moderation', phase: 'recheck' }, extra: { ...item } }),
    });
    await refreshPropertyReviewPages(propertyIds);
    return Response.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'review-moderation' } });
    console.error('[review-moderation]', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Review moderation failed' }, { status: 500 });
  }
}

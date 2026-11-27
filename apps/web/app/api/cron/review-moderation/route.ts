import * as Sentry from '@sentry/nextjs';
import { getPool } from '@openbookings/db';
import { NeedsAPerson, runModerationSweep } from '@openbookings/db/reviews';
import { sendMaskedPublicationNotices } from '@openbookings/mailing/review-send';
import { bearerAuthorized } from '@openbookings/messaging/cron-auth';
import { checkText } from '@openbookings/moderation';
import { refreshPropertyReviewPages } from '@/lib/property-reviews';

export const dynamic = 'force-dynamic';

/**
 * Review moderation's clock: rechecks the reviews and replies the automatic
 * check missed (the model failed or timed out), publishes held ones 72 hours
 * after they were written with their flagged parts masked (one whose flagged
 * words couldn't be pinpointed waits for a person instead, and each run
 * raises it in Sentry as a warning), and deletes moderation records 12 months
 * after the decision. Then the pages of the
 * properties whose public reviews changed are refreshed. Safe to run at any
 * time, as often as wanted: every write is compare-and-set.
 *
 * POST /api/cron/review-moderation (Authorization: Bearer $CRON_SECRET)
 * → 200 { rechecked, published, waiting, purged: { reports, texts } }
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
      // The item's kind and id only, never its text.
      onError: (error, item) =>
        error instanceof NeedsAPerson
          ? Sentry.captureException(error, {
              level: 'warning',
              tags: { area: 'review-moderation', phase: 'deadline' },
              extra: { kind: item.kind, id: item.id },
            })
          : Sentry.captureException(error, {
              tags: { area: 'review-moderation', phase: 'recheck' },
              extra: { kind: item.kind, id: item.id },
            }),
    });
    await refreshPropertyReviewPages(propertyIds);
    return Response.json(summary);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'review-moderation' } });
    console.error('[review-moderation]', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Review moderation failed' }, { status: 500 });
  }
}

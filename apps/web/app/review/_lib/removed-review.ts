import { REVIEW_WINDOW_DAYS, type ReviewEligibility } from '@openbookings/pricing';
import type { ReviewStatus } from '@openbookings/db/reviews';

/**
 * What the guest's review pages say about a review a moderator removed. It
 * may be written once more while the review window is open (getReviewContext
 * then reports the stay as reviewable); after that rewrite, or once the window
 * has closed, the page says so instead.
 */
export type RemovedReview = { canRewrite: boolean; message: string };

const REMOVED = 'Your review was removed because it broke our review rules.';

export function removedReview(context: {
  review: { status: ReviewStatus } | null;
  eligibility: ReviewEligibility;
}): RemovedReview | null {
  if (context.review?.status !== 'removed') return null;
  const { eligibility } = context;
  if (eligibility.ok) {
    return {
      canRewrite: true,
      message: 'Your earlier review was removed because it broke our review rules. You can write it once more.',
    };
  }
  switch (eligibility.reason) {
    // A removed review counts as written only once its one rewrite is used.
    case 'already_reviewed':
      return { canRewrite: false, message: `${REMOVED} It was already written once more, so this stay can't be reviewed again.` };
    case 'window_closed':
      return {
        canRewrite: false,
        message: `${REMOVED} Reviews can be written up to ${REVIEW_WINDOW_DAYS} days after check-out, so it can't be written again.`,
      };
    default:
      return { canRewrite: false, message: `${REMOVED} This stay can't be reviewed again.` };
  }
}

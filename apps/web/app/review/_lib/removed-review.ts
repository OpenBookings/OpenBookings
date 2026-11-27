import { REVIEW_WINDOW_DAYS, type ReviewEligibility } from '@openbookings/pricing';
import type { ReviewStatus } from '@openbookings/db/reviews';

/**
 * What the guest's review pages say about a review a moderator removed. It
 * may be written once more while the review window is open (getReviewContext
 * then reports the stay as reviewable); after that rewrite, or once the window
 * has closed, the page says so instead.
 */
export type RemovedReview = { canRewrite: boolean; message: string };

/** Whether a removed review may be written once more: until when, or why not. */
export type Rewrite = { open: true; until: Date } | { open: false; reason: string };

export function rewriteOf(eligibility: ReviewEligibility): Rewrite {
  if (eligibility.ok) return { open: true, until: eligibility.closesAt };
  switch (eligibility.reason) {
    // A removed review counts as written only once its one rewrite is used.
    case 'already_reviewed':
      return { open: false, reason: "It was already written once more, so this stay can't be reviewed again." };
    case 'window_closed':
      return {
        open: false,
        reason: `Reviews can be written up to ${REVIEW_WINDOW_DAYS} days after check-out, so it can't be written again.`,
      };
    default:
      return { open: false, reason: "This stay can't be reviewed again." };
  }
}

const REMOVED = 'Your review was removed because it broke our review rules.';

export function removedReview(context: {
  review: { status: ReviewStatus } | null;
  eligibility: ReviewEligibility;
}): RemovedReview | null {
  if (context.review?.status !== 'removed') return null;
  const rewrite = rewriteOf(context.eligibility);
  return rewrite.open
    ? {
        canRewrite: true,
        message: 'Your earlier review was removed because it broke our review rules. You can write it once more.',
      }
    : { canRewrite: false, message: `${REMOVED} ${rewrite.reason}` };
}

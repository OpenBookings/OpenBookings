import { nextReplyRole, type ReplyRole } from '@openbookings/pricing';

/**
 * Whether the guest may answer the property's reply now. The turn follows the
 * server's rule (postReviewReply: every reply that isn't deleted counts, a
 * removed or held host reply included), and there must be a published host
 * reply in the guest's view to answer: a host reply they can't see isn't one
 * to answer. So the form never shows when the server would refuse.
 */
export function guestAnswerTurn(review: {
  /** Every reply that isn't deleted, oldest first. */
  threadRoles: readonly ReplyRole[];
  /** The thread as the guest sees it. */
  replies: ReadonlyArray<{ role: ReplyRole; status: string }>;
}): 'answer' | 'wait' | 'closed' {
  const turn = nextReplyRole(review.threadRoles);
  if (turn === null) return 'closed';
  const last = review.replies.at(-1);
  return turn === 'guest' && last?.role === 'host' && last.status === 'published' ? 'answer' : 'wait';
}

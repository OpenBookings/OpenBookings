import { userCan as realUserCan, type SessionLike } from "@openbookings/authz";
import { queryOne as realQueryOne } from "@openbookings/db";
import type { ReplyError } from "@openbookings/db/reviews";

/**
 * Who may reply to a review, and the words for every way a reply can fail.
 * Kept out of ./actions so it can be tested without Next.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewActorDeps = {
  queryOne?: <T>(sql: string, values?: unknown[]) => Promise<T | null>;
  userCan?: (session: SessionLike, propertyId: string, permission: { booking: ["read"] }) => Promise<boolean>;
};

/**
 * The signed-in member acting on a review (or on one reply to it), or null
 * when the review doesn't exist or they can't see its property's bookings.
 * Both look the same to the caller.
 */
export async function reviewActor(
  session: SessionLike | null,
  target: { reviewId: string } | { replyId: string },
  deps: ReviewActorDeps = {},
): Promise<{ userId: string; propertyId: string; reviewId: string } | null> {
  if (!session) return null;
  const id = "reviewId" in target ? target.reviewId : target.replyId;
  if (!UUID.test(id)) return null;
  const queryOne = deps.queryOne ?? realQueryOne;
  const userCan = deps.userCan ?? ((s, p, perm) => realUserCan(s, p, perm));
  const row =
    "reviewId" in target
      ? await queryOne<{ property_id: string; review_id: string }>(
          `SELECT property_id, id AS review_id FROM reviews WHERE id = $1::uuid`,
          [id],
        )
      : await queryOne<{ property_id: string; review_id: string }>(
          `SELECT rv.property_id, rv.id AS review_id
             FROM review_replies rr JOIN reviews rv ON rv.id = rr.review_id
            WHERE rr.id = $1::uuid`,
          [id],
        );
  if (!row) return null;
  if (!(await userCan(session, row.property_id, { booking: ["read"] }))) return null;
  return { userId: session.user.id, propertyId: row.property_id, reviewId: row.review_id };
}

const MESSAGES: Record<ReplyError | "rate_limited", string> = {
  not_found: "We couldn't find this review.",
  invalid: "Write between 1 and 1,000 characters.",
  not_your_turn: "It's the guest's turn to answer. You can reply again after they do.",
  thread_closed: "This thread is closed. Carry on in Messages.",
  review_deleted: "The guest deleted this review.",
  not_last: "Only the latest reply can be deleted.",
  no_thread_host: "This property has no account to send messages from yet. Contact support.",
  rate_limited: "You're going a bit fast. Wait a few minutes and try again.",
};

export function messageFor(error: ReplyError | "rate_limited"): string {
  return MESSAGES[error];
}

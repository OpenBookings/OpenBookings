"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { purge, propertyReviewsKey } from "@openbookings/cache";
import { getPool, withTransaction } from "@openbookings/db";
import {
  deleteHostReply,
  editHostReply,
  insertPrivateReviewReply,
  normalizeReviewBody,
  postReviewReply,
  setReplySkipped,
} from "@openbookings/db/reviews";
import { sendReviewReplied } from "@openbookings/mailing/review-send";
import { deliverMessageToRecipient, detectCircumvention } from "@openbookings/messaging";
import { checkText } from "@openbookings/moderation";
import { REPLY_BODY_MAX, type TextCheck } from "@openbookings/pricing";
import { getServerSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { messageFor, reviewActor } from "./actor";

/**
 * The Reviews page's actions. Each one re-checks on the server that the
 * signed-in member can see the review's property's bookings (./actor); the
 * ids come from the browser and are trusted for nothing else. Whose turn it
 * is, and what a reply may say, is decided in @openbookings/db/reviews.
 */

export type ReplyActionResult = { ok: true; status: "published" | "pending" | "sent" } | { ok: false; message: string };

const REVIEWS = "/dashboard/bookings/reviews";
const MESSAGES = "/dashboard/bookings/messages";

const fail = (error: Parameters<typeof messageFor>[0]): ReplyActionResult => ({ ok: false, message: messageFor(error) });

/**
 * The moderation check of a public reply: clean publishes, flagged or
 * unchecked is held for a person. The text is normalised once, as the db
 * layer stores it, so the check's fragments are found in the stored text and
 * mask. Null for a text the db layer refuses (empty or too long) anyway, so it
 * never costs a model call. Run before the transaction: the model call
 * shouldn't hold a connection open.
 */
async function checkReply(raw: string): Promise<{ body: string; check: TextCheck } | null> {
  const body = normalizeReviewBody(raw);
  return body && body.length <= REPLY_BODY_MAX ? { body, check: await checkText(body) } : null;
}

function rateLimited(userId: string): boolean {
  return !checkRateLimit(`review-reply:${userId}`, 20, 10 * 60 * 1000).allowed;
}

/** The property page caches reviews for a day; a reply shows up now instead. */
async function refreshPropertyPage(propertyId: string) {
  await purge([propertyReviewsKey(propertyId)], {
    onError: (error) => Sentry.captureException(error, { tags: { area: "reviews", phase: "purge" }, extra: { propertyId } }),
  });
}

export async function replyToReview(
  reviewId: string,
  input: { mode: "public" | "private"; body: string },
): Promise<ReplyActionResult> {
  const actor = await reviewActor(await getServerSession(), { reviewId });
  if (!actor) return fail("not_found");
  if (rateLimited(actor.userId)) return fail("rate_limited");
  const body = typeof input.body === "string" ? input.body : "";
  const now = new Date();

  if (input.mode === "private") {
    const result = await withTransaction((tx) =>
      insertPrivateReviewReply(tx, {
        reviewId,
        senderUserId: actor.userId,
        body,
        flaggedReason: detectCircumvention(body),
        now,
      }),
    );
    if (!result.ok) return fail(result.error);
    await deliverMessageToRecipient({ recipientId: result.guestUserId, threadId: result.threadId, message: result.message });
    revalidatePath(REVIEWS);
    revalidatePath(MESSAGES);
    return { ok: true, status: "sent" };
  }

  const checked = await checkReply(body);
  if (!checked) return fail("invalid");
  const result = await withTransaction((tx) =>
    postReviewReply(tx, { reviewId, role: "host", authorUserId: actor.userId, body: checked.body, check: checked.check, now }),
  );
  if (!result.ok) return fail(result.error);
  if (result.status === "published") {
    await refreshPropertyPage(result.propertyId);
    // Once per published reply. Edits, held replies and private ones don't email.
    await sendReviewReplied(reviewId, {
      report: (error) => Sentry.captureException(error, { tags: { area: "reviews", mail: "review_replied" } }),
    });
  }
  revalidatePath(REVIEWS);
  return { ok: true, status: result.status };
}

export async function editReviewReply(replyId: string, body: string): Promise<ReplyActionResult> {
  const actor = await reviewActor(await getServerSession(), { replyId });
  if (!actor) return fail("not_found");
  if (rateLimited(actor.userId)) return fail("rate_limited");
  const checked = await checkReply(typeof body === "string" ? body : "");
  if (!checked) return fail("invalid");
  const result = await withTransaction((tx) =>
    editHostReply(tx, { replyId, authorUserId: actor.userId, body: checked.body, check: checked.check, now: new Date() }),
  );
  if (!result.ok) return fail(result.error);
  await refreshPropertyPage(result.propertyId);
  revalidatePath(REVIEWS);
  return { ok: true, status: result.status };
}

export async function deleteReviewReply(replyId: string): Promise<ReplyActionResult> {
  const actor = await reviewActor(await getServerSession(), { replyId });
  if (!actor) return fail("not_found");
  const result = await withTransaction((tx) => deleteHostReply(tx, { replyId, now: new Date() }));
  if (!result.ok) return fail(result.error);
  await refreshPropertyPage(result.propertyId);
  revalidatePath(REVIEWS);
  return { ok: true, status: "published" };
}

/** "No reply needed", or taking that back. Nothing is sent to anyone. */
export async function skipReviewReply(reviewId: string, skipped: boolean): Promise<ReplyActionResult> {
  const actor = await reviewActor(await getServerSession(), { reviewId });
  if (!actor) return fail("not_found");
  const result = await setReplySkipped(getPool(), { reviewId, userId: actor.userId, skipped: skipped === true, now: new Date() });
  if (!result.ok) return fail(result.error);
  revalidatePath(REVIEWS);
  return { ok: true, status: "published" };
}

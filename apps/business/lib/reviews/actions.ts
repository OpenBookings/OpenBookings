"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { purge, propertyReviewsKey } from "@openbookings/cache";
import { withTransaction } from "@openbookings/db";
import {
  deleteHostReply,
  editHostReply,
  insertPrivateReviewReply,
  postReviewReply,
} from "@openbookings/db/reviews";
import { sendReviewReplied } from "@openbookings/mailing/review-send";
import { deliverMessageToRecipient, detectCircumvention, screenReview } from "@openbookings/messaging";
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

  const result = await withTransaction((tx) =>
    postReviewReply(tx, { reviewId, role: "host", authorUserId: actor.userId, body, flaggedReason: screenReview(body), now }),
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
  const text = typeof body === "string" ? body : "";
  const result = await withTransaction((tx) =>
    editHostReply(tx, { replyId, authorUserId: actor.userId, body: text, flaggedReason: screenReview(text), now: new Date() }),
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

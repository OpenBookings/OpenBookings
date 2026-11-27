"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { purge, propertyReviewsKey } from "@openbookings/cache";
import { getPool, withTransaction } from "@openbookings/db";
import {
  createReviewReport,
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

export type ReportActionResult = { ok: true } | { ok: false; message: string };

const REPORT_MESSAGES = {
  not_found: "This can't be reported. It may be held for a check, taken down, or deleted by the guest.",
  already_open: "You've already reported this. We'll email you the outcome.",
  invalid: "Choose the rule it breaks, and keep your note under 1,000 characters. Your own replies can't be reported.",
  rate_limited: "You're going a bit fast. Wait a few minutes and try again.",
} as const;

/**
 * Report a published review of the current hotel, or a guest's published
 * answer under one, against one rule. Only a member who can see the
 * property's bookings (./actor, as for replies), never a property's own reply
 * (createReviewReport refuses it), and one open report per organization per
 * item. It stays on the page until a person at OpenBookings decides; the
 * outcome is emailed to the member and shows on the Reviews page.
 */
async function reportAs(target: { reviewId: string } | { replyId: string }, input: { rule: string; note: string }): Promise<ReportActionResult> {
  const actor = await reviewActor(await getServerSession(), target);
  if (!actor) return { ok: false, message: REPORT_MESSAGES.not_found };
  if (!checkRateLimit(`review-report:${actor.userId}`, 20, 60 * 60 * 1000).allowed) return { ok: false, message: REPORT_MESSAGES.rate_limited };
  const result = await createReviewReport(getPool(), {
    item: "replyId" in target ? { kind: "reply", id: target.replyId } : { kind: "review", id: actor.reviewId },
    reporter: { kind: "host", userId: actor.userId },
    rule: input?.rule,
    note: input?.note,
    now: new Date(),
  });
  if (!result.ok) return { ok: false, message: REPORT_MESSAGES[result.error] };
  revalidatePath(REVIEWS);
  return { ok: true };
}

export async function reportReview(reviewId: string, input: { rule: string; note: string }): Promise<ReportActionResult> {
  return reportAs({ reviewId }, input);
}

/** A guest's answer to the property's reply. */
export async function reportGuestAnswer(replyId: string, input: { rule: string; note: string }): Promise<ReportActionResult> {
  return reportAs({ replyId }, input);
}

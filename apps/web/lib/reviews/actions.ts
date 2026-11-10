'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { getPool, withTransaction } from '@openbookings/db';
import {
  bookingForReviewToken,
  deleteGuestReview,
  getReviewContext,
  postReviewReply,
  setReviewEmails,
  submitReview,
  type SubmitReviewResult,
} from '@openbookings/db/reviews';
import { sendReviewPosted } from '@openbookings/mailing/review-send';
import { getServerSession } from '@/lib/auth';
import { purgePropertyReviews } from '@/lib/property-reviews';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';
import { screenReview } from '@openbookings/messaging';

/**
 * The review form's actions. Two ways to prove the booking, one rule for
 * whether it can be reviewed (getReviewContext / submitReview):
 *
 *   session  the signed-in guest owns the booking (Account tab)
 *   token    the emailed link points at it. It only allows this one review:
 *            no session is created, nobody is signed in.
 */

export type ReviewActionResult = { ok: true; status: 'published' | 'pending' } | { ok: false; message: string };

const MESSAGES: Record<Exclude<SubmitReviewResult, { ok: true }>['error'] | 'wrong_account' | 'rate_limited', string> = {
  not_found: "We couldn't find this stay.",
  invalid: 'Choose a score from 1 to 10, and keep your text under 2,000 characters.',
  not_stayed: 'Only stays that took place can be reviewed.',
  no_show: 'Only stays that took place can be reviewed.',
  too_early: 'You can review this stay from 24 hours after check-out.',
  window_closed: 'Reviews can be written up to 30 days after check-out. This one has closed.',
  already_reviewed: 'This stay already has a review.',
  wrong_account: "You're signed in with a different account than the one that booked this stay. Sign out first.",
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
};

const fail = (key: keyof typeof MESSAGES): ReviewActionResult => ({ ok: false, message: MESSAGES[key] });

/** Per-IP limit on everything a token can do, so links can't be guessed at speed. */
async function tokenRateLimited(): Promise<boolean> {
  const request = new Request('http://localhost', { headers: await headers() });
  return !checkRateLimit(`review-token:${getClientIP(request)}`, 20, 10 * 60 * 1000).allowed;
}

function parseScore(score: unknown): number {
  const n = typeof score === 'number' ? score : Number(score);
  return Number.isInteger(n) ? n : NaN;
}

async function store(bookingId: string, via: 'session' | 'token', input: { score: unknown; body: unknown }): Promise<SubmitReviewResult> {
  const body = typeof input.body === 'string' ? input.body : null;
  return submitReview(getPool(), {
    bookingId,
    via,
    score: parseScore(input.score),
    body,
    flaggedReason: screenReview(body),
    now: new Date(),
  });
}

function refresh(bookingId: string, slug: string) {
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath(`/bookings/${bookingId}/review`);
  revalidatePath('/account/bookings');
  revalidatePath(`/p/${slug}`);
}

/** Account tab: the signed-in guest reviews their own booking. */
export async function submitReviewAsGuest(bookingId: string, input: { score: number; body: string }): Promise<ReviewActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, message: 'Your session ended. Sign in again.' };
  const context = await getReviewContext(getPool(), bookingId, new Date());
  // Someone else's booking looks exactly like a missing one.
  if (!context || context.guestUserId !== session.user.id) return fail('not_found');
  const result = await store(bookingId, 'session', input);
  if (!result.ok) return fail(result.error);
  refresh(bookingId, result.context.propertySlug);
  return { ok: true, status: result.status };
}

/** Emailed link: the token is the proof. Blocked when signed in as somebody else. */
export async function submitReviewWithToken(token: string, input: { score: number; body: string }): Promise<ReviewActionResult> {
  if (await tokenRateLimited()) return fail('rate_limited');
  const now = new Date();
  const bookingId = await bookingForReviewToken(getPool(), token, now);
  if (!bookingId) return { ok: false, message: 'This link has expired or was already used.' };
  const context = await getReviewContext(getPool(), bookingId, now);
  if (!context) return fail('not_found');
  const session = await getServerSession();
  if (session && session.user.id !== context.guestUserId) return fail('wrong_account');

  const result = await store(bookingId, 'token', input);
  if (!result.ok) return fail(result.error);
  // To the account's own address: a review written from a forwarded email gets noticed.
  await sendReviewPosted(bookingId, {
    pending: result.status === 'pending',
    report: (error) => Sentry.captureException(error, { tags: { area: 'reviews', mail: 'review_posted' } }),
  });
  refresh(bookingId, result.context.propertySlug);
  return { ok: true, status: result.status };
}

/** The author deletes their review. It can't be written again. */
export async function deleteMyReview(bookingId: string): Promise<ReviewActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, message: 'Your session ended. Sign in again.' };
  const context = await getReviewContext(getPool(), bookingId, new Date());
  if (!context || context.guestUserId !== session.user.id) return fail('not_found');
  const deleted = await deleteGuestReview(getPool(), { bookingId, guestUserId: session.user.id, now: new Date() });
  if (!deleted) return { ok: false, message: 'This review was already deleted.' };
  // Deleting is the one change that doesn't wait for the 24-hour cache.
  await purgePropertyReviews(context.propertyId);
  refresh(bookingId, context.propertySlug);
  return { ok: true, status: 'published' };
}

const ANSWER_ERRORS: Record<string, string> = {
  invalid: 'Write between 1 and 1,000 characters.',
  not_your_turn: 'You can answer once the property has replied.',
  thread_closed: 'You already answered this reply.',
  review_deleted: 'This review was deleted.',
};

/** The review's author answers the property's public reply, once. */
export async function answerHostReply(bookingId: string, body: string): Promise<ReviewActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, message: 'Your session ended. Sign in again.' };
  const context = await getReviewContext(getPool(), bookingId, new Date());
  if (!context?.review || context.guestUserId !== session.user.id) return fail('not_found');
  const text = typeof body === 'string' ? body : '';
  const reviewId = context.review.id;
  const result = await withTransaction((tx) =>
    postReviewReply(tx, {
      reviewId,
      role: 'guest',
      authorUserId: session.user.id,
      body: text,
      flaggedReason: screenReview(text),
      now: new Date(),
    }),
  );
  if (!result.ok) return { ok: false, message: ANSWER_ERRORS[result.error] ?? MESSAGES.not_found };
  if (result.status === 'published') await purgePropertyReviews(context.propertyId);
  refresh(bookingId, context.propertySlug);
  return { ok: true, status: result.status };
}

/** "Don't send me review requests", from the emailed link. */
export async function stopReviewEmailsWithToken(token: string): Promise<{ ok: boolean; message?: string }> {
  if (await tokenRateLimited()) return { ok: false, message: MESSAGES.rate_limited };
  const now = new Date();
  const bookingId = await bookingForReviewToken(getPool(), token, now);
  const context = bookingId ? await getReviewContext(getPool(), bookingId, now) : null;
  if (!context) return { ok: false, message: 'This link has expired. You can turn review emails off in your account.' };
  await setReviewEmails(getPool(), context.guestUserId, false, now);
  return { ok: true };
}

/** The switch in Account → Privacy & data. */
export async function setMyReviewEmails(enabled: boolean): Promise<{ ok: boolean }> {
  const session = await getServerSession();
  if (!session) return { ok: false };
  await setReviewEmails(getPool(), session.user.id, enabled, new Date());
  revalidatePath('/account/privacy');
  return { ok: true };
}

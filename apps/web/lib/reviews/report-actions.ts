'use server';

import { headers } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import { getPool } from '@openbookings/db';
import { createReviewReport, type ModerationItem } from '@openbookings/db/reviews';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';
import { TURNSTILE_ACTIONS, verifyTurnstile } from '@/lib/turnstile';

/**
 * The public "Report this review" form (/p/[hotel_slug]/reviews/[reviewId]/report).
 * Anyone may report a published review or reply; nobody is identified by it.
 * In this order, each refusal before the next costs anything:
 *
 *   1. Turnstile (invisible): the token must be for this form.
 *   2. At most REPORTS_PER_HOUR reports per IP per hour (in memory, per instance).
 *   3. createReviewReport: one open report per reporter per item.
 *
 * Updates by email are opt-in and only for a signed-in reporter: the address
 * is the account's, read from the session here, never from the form. Signed
 * out, or not ticked, nobody is told the outcome.
 */

export type ReportReviewInput = {
  item: { kind: unknown; id: unknown };
  rule: unknown;
  note: unknown;
  /** "Receive updates by email": honoured only when signed in. */
  updates: unknown;
  turnstileToken: unknown;
};

export type ReportReviewResult = { ok: true } | { ok: false; message: string };

const REPORTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const MESSAGES = {
  verification: "We couldn't check that you're a person. Reload the page and try again.",
  rate_limited: "You've sent several reports in the last hour. Try again later.",
  not_found: "This review can't be reported. It may have been taken down or changed.",
  already_open: "You've already reported this. A person will check it.",
  invalid: 'Choose a rule, and keep your note under 1,000 characters.',
} as const;

const fail = (key: keyof typeof MESSAGES): ReportReviewResult => ({ ok: false, message: MESSAGES[key] });

function parseItem(item: ReportReviewInput['item']): ModerationItem | null {
  if (typeof item !== 'object' || item === null) return null;
  const { kind, id } = item;
  return (kind === 'review' || kind === 'reply') && typeof id === 'string' ? { kind, id } : null;
}

export async function reportReviewPublic(input: ReportReviewInput): Promise<ReportReviewResult> {
  const ip = getClientIP(new Request('http://localhost', { headers: await headers() }));
  if (!(await verifyTurnstile(input?.turnstileToken, ip, TURNSTILE_ACTIONS.reviewReport))) return fail('verification');
  if (!checkRateLimit(`review-report:${ip}`, REPORTS_PER_HOUR, HOUR_MS).allowed) return fail('rate_limited');

  const item = parseItem(input.item);
  if (!item) return fail('not_found');
  const session = await getServerSession().catch(() => null);
  const userId = session?.user?.id ?? null;
  const email = input.updates === true && userId ? (session?.user?.email ?? null) : null;

  try {
    const result = await createReviewReport(getPool(), {
      item,
      reporter: { kind: 'public', userId, email },
      rule: input.rule,
      note: input.note,
      now: new Date(),
    });
    return result.ok ? { ok: true } : fail(result.error);
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'reviews', action: 'report' } });
    return { ok: false, message: 'Something went wrong. Try again in a moment.' };
  }
}

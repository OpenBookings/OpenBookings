import { localTimeToUtc, type BookingStatus } from "./cancellation";

/**
 * Guest reviews (roadmap 6.3). The booking is the key: one review per booking
 * that actually took place. These rules are shared by the Account tab, the
 * emailed link, the invitation job and the host's no-show deadline, so they
 * can never disagree.
 *
 * Everything keys off the *projected* check-out (booked date + the property's
 * check-out time), never off check-in/check-out marking: that will come from a
 * calendar sync or PMS later and can lag or fail.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How long after check-out a review opens: time for the host to mark a no-show first. */
export const REVIEW_OPENS_AFTER_MS = DAY;
/** How long after check-out a review can still be written. */
export const REVIEW_WINDOW_DAYS = 30;
/** The one reminder goes out this long after the invitation, if there's still no review. */
export const REVIEW_REMINDER_AFTER_MS = 6 * DAY;
/** Invitations and reminders are only sent between these hours, property time. */
export const REVIEW_SEND_HOURS = { from: 9, until: 20 } as const;

/** Statuses of a booking that may have been stayed. `completed` is not set by anything yet. */
export const REVIEWABLE_STATUSES: readonly BookingStatus[] = ["confirmed", "checked_in", "completed"];

/** The booked check-out moment. A missing check-out time falls back to noon. */
export function projectedCheckOutAt(i: { checkOutDate: string; checkOutTime: string | null; timeZone: string }): Date {
  return localTimeToUtc(i.checkOutDate, (i.checkOutTime ?? "12:00").slice(0, 5), i.timeZone);
}

/** When a booking can be reviewed: from check-out + 24h until check-out + 30 days. */
export function reviewWindow(checkOutAt: Date): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: new Date(checkOutAt.getTime() + REVIEW_OPENS_AFTER_MS),
    closesAt: new Date(checkOutAt.getTime() + REVIEW_WINDOW_DAYS * DAY),
  };
}

/**
 * Until when a host may mark a no-show themselves: the moment the review
 * opens. After that a no-show would block a review the guest may already be
 * writing, so only an admin can change it.
 */
export function hostNoShowDeadline(i: { checkOutDate: string; checkOutTime: string | null; timeZone: string }): Date {
  return reviewWindow(projectedCheckOutAt(i)).opensAt;
}

export type ReviewIneligibleReason =
  | "not_stayed" // pending or cancelled: there was no stay
  | "no_show"
  | "too_early"
  | "window_closed"
  | "already_reviewed";

export type ReviewEligibility = { ok: true; closesAt: Date } | { ok: false; reason: ReviewIneligibleReason };

/**
 * Whether a booking can be reviewed at `now`. Who is asking (session owner or
 * token holder) is checked by the caller; this is only about the booking.
 */
export function reviewEligibility(i: {
  status: BookingStatus;
  noShowReportedAt: Date | null;
  checkOutAt: Date;
  hasReview: boolean;
  now: Date;
}): ReviewEligibility {
  if (i.status === "no_show" || i.noShowReportedAt) return { ok: false, reason: "no_show" };
  if (!REVIEWABLE_STATUSES.includes(i.status)) return { ok: false, reason: "not_stayed" };
  if (i.hasReview) return { ok: false, reason: "already_reviewed" };
  const { opensAt, closesAt } = reviewWindow(i.checkOutAt);
  const now = i.now.getTime();
  if (now < opensAt.getTime()) return { ok: false, reason: "too_early" };
  if (now > closesAt.getTime()) return { ok: false, reason: "window_closed" };
  return { ok: true, closesAt };
}

/** The hour of `at` on the property's clock, 0–23. */
export function localHour(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(at);
  return Number(hour);
}

/** Whether an invitation or reminder may go out at `at`: daytime on the property's clock. */
export function isReviewSendHour(at: Date, timeZone: string): boolean {
  const h = localHour(at, timeZone);
  return h >= REVIEW_SEND_HOURS.from && h < REVIEW_SEND_HOURS.until;
}

/** The first day of the check-out month, `YYYY-MM-01`: all a review shows of when the stay was. */
export function stayMonth(checkOutDate: string): string {
  return `${checkOutDate.slice(0, 7)}-01`;
}

/**
 * The average shown on a property page: one decimal, only from 3 reviews up
 * (fewer is noise), over the last 24 months. Null = show the list only.
 */
export const MIN_REVIEWS_FOR_AVERAGE = 3;
export const AVERAGE_WINDOW_MONTHS = 24;

export function displayedAverage(scores: number[]): number | null {
  if (scores.length < MIN_REVIEWS_FOR_AVERAGE) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round((sum / scores.length) * 10) / 10;
}

/**
 * Score words, from best to worst. A review's score (1–10) and a property's
 * average both map onto them; the reviews card filters by them.
 */
export const REVIEW_BANDS = [
  { id: "terrific", label: "Terrific", min: 9 },
  { id: "great", label: "Great", min: 8 },
  { id: "good", label: "Good", min: 7 },
  { id: "okay", label: "Okay", min: 5 },
  { id: "bad", label: "Bad", min: 0 },
] as const;

export type ReviewBand = (typeof REVIEW_BANDS)[number]["id"];

/** The band a score (whole or an average with one decimal) falls in. */
export function reviewBand(score: number): (typeof REVIEW_BANDS)[number] {
  return REVIEW_BANDS.find((b) => score >= b.min) ?? REVIEW_BANDS[REVIEW_BANDS.length - 1]!;
}

// ── Replies ───────────────────────────────────────────────────────────────────

/** A reply's text, after trimming. */
export const REPLY_BODY_MAX = 1000;
/** The public thread under a review: host, guest, host. Then it closes. */
export const REPLY_THREAD_MAX = 3;

export type ReplyRole = "host" | "guest";

/**
 * Whose turn it is in a review's public thread, given the roles of its
 * replies so far (oldest first, deleted ones left out). The host opens, the
 * review's guest may answer once, the host has the last word. Null = closed.
 */
export function nextReplyRole(thread: readonly ReplyRole[]): ReplyRole | null {
  if (thread.length >= REPLY_THREAD_MAX) return null;
  return thread.length % 2 === 0 ? "host" : "guest";
}

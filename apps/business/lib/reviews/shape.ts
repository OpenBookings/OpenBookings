import {
  AVERAGE_WINDOW_MONTHS,
  displayedAverage,
  MASKED_TEXT,
  maskFragments,
  REVIEW_BANDS,
  reviewBand,
  type ReplyRole,
  type ReviewBand,
} from "@openbookings/pricing";
import type { ReviewReply } from "@openbookings/db/reviews";

/**
 * The host Reviews page's data, and the pure rules on top of it: what needs
 * a reply, which tab a review is in, and the summary card's numbers.
 */

export type HostReview = {
  id: string;
  bookingId: string;
  propertyId: string;
  propertyName: string;
  /** The property's IANA time zone: moderation dates are its local dates. */
  timeZone: string;
  score: number;
  body: string | null;
  authorName: string;
  authorCountry: string | null;
  /** `YYYY-MM-01` */
  stayMonth: string;
  roomLabel: string | null;
  /** Removed only when the property reported it and the report was upheld. */
  status: "published" | "pending" | "removed";
  flaggedReason: string | null;
  /** The property's own report on it: open, or the outcome of the current decision. */
  report: HostReportStatus | null;
  /**
   * The property's reports on guests' answers under it, by reply id: open, or
   * the outcome of the answer's current decision. An upheld one's answer was
   * removed, so it isn't in `replies`.
   */
  replyReports: Record<string, HostReportStatus>;
  /** ISO: published_at, or created_at while it is being checked. */
  postedAt: string;
  /** Published and held replies, oldest first, and the host's own removed ones (with `moderation`, without their words). */
  replies: ReviewReply[];
  /** ISO time of the latest private reply in Messages, if any. */
  privateReplyAt: string | null;
  /** ISO time the host marked it as needing no reply, if they did. */
  skippedAt: string | null;
  /** Whose turn it is in the public thread (every reply that isn't deleted counts); null when it is closed. */
  nextRole: ReplyRole | null;
  /** How many replies count for the turn: every one that isn't deleted, the ones the host can't see included. */
  threadLength: number;
};

/**
 * A guest's held review or answer as the host may see it: the parts the
 * check flagged replaced by "[removed]", never the words it held it for.
 * When it flagged a rule but none of its fragments is in the text (nobody
 * could say which words), the whole text is withheld. Held for no rule (the
 * check couldn't run and found nothing) it shows as written.
 */
export function heldTextForHost(i: { body: string; flaggedReason: string | null; fragments: unknown }): string {
  if (!i.flaggedReason) return i.body;
  const fragments = Array.isArray(i.fragments) ? i.fragments.filter((f): f is string => typeof f === "string") : [];
  const masked = maskFragments(i.body, fragments);
  return masked !== i.body ? masked : MASKED_TEXT;
}

/** A property's report on a review: being checked, upheld (removed) or not upheld (kept). */
export type HostReportStatus = "open" | "upheld" | "dismissed";

export type ReviewTab = "reply" | "all" | "checking";
export type HostReviewSort = "newest" | "oldest" | "highest" | "lowest";

/** The property has a public reply on it that wasn't removed. */
export function hasHostReply(r: Pick<HostReview, "replies">): boolean {
  return r.replies.some((x) => x.role === "host" && x.status !== "removed");
}

/**
 * Published, the host's turn, something to reply to (the review itself, or a
 * guest's answer the host can see: a removed one isn't), and not handled since
 * the thread's last reply: a private message or "no reply needed" both count
 * as handled.
 */
export function needsReply(r: HostReview): boolean {
  if (r.status !== "published" || r.nextRole !== "host") return false;
  if (r.threadLength > 0 && r.replies.at(-1)?.role !== "guest") return false;
  const handled = [r.privateReplyAt, r.skippedAt].filter((t): t is string => t !== null).map(Date.parse);
  if (handled.length === 0) return true;
  const last = r.replies.at(-1)?.createdAt;
  return last !== undefined && Math.max(...handled) < Date.parse(last);
}

export function inTab(r: HostReview, tab: ReviewTab): boolean {
  if (tab === "reply") return needsReply(r);
  // A review removed on the property's report stays in All, with the outcome.
  if (tab === "all") return r.status === "published" || r.status === "removed";
  return r.status === "pending";
}

export function filterHostReviews(
  list: HostReview[],
  f: { tab: ReviewTab; propertyId: string | "all"; band: ReviewBand | "all"; sort: HostReviewSort },
): HostReview[] {
  const out = list.filter(
    (r) =>
      inTab(r, f.tab) &&
      (f.propertyId === "all" || r.propertyId === f.propertyId) &&
      (f.band === "all" || reviewBand(r.score).id === f.band),
  );
  const time = (r: HostReview) => Date.parse(r.postedAt);
  const by: Record<HostReviewSort, (a: HostReview, b: HostReview) => number> = {
    newest: (a, b) => time(b) - time(a),
    oldest: (a, b) => time(a) - time(b),
    highest: (a, b) => b.score - a.score || time(b) - time(a),
    lowest: (a, b) => a.score - b.score || time(b) - time(a),
  };
  return out.sort(by[f.sort]);
}

export type ReviewSummary = {
  /** One decimal, or null below 3 recent reviews (as on the property page). */
  average: number | null;
  band: string | null;
  /** Published reviews of the last 24 months. */
  recentCount: number;
  bands: { id: ReviewBand; label: string; count: number }[];
  /** Reviews waiting for a reply. */
  waiting: number;
};

export function summarize(list: HostReview[], propertyId: string | "all", now: Date): ReviewSummary {
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - AVERAGE_WINDOW_MONTHS);
  const scoped = list.filter((r) => propertyId === "all" || r.propertyId === propertyId);
  const recent = scoped.filter((r) => r.status === "published" && Date.parse(r.postedAt) >= since.getTime());
  const average = displayedAverage(recent.map((r) => r.score));
  return {
    average,
    band: average === null ? null : reviewBand(average).label,
    recentCount: recent.length,
    bands: REVIEW_BANDS.map((b) => ({
      id: b.id,
      label: b.label,
      count: recent.filter((r) => reviewBand(r.score).id === b.id).length,
    })),
    waiting: scoped.filter(needsReply).length,
  };
}

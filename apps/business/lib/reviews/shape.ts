import {
  AVERAGE_WINDOW_MONTHS,
  displayedAverage,
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
  score: number;
  body: string | null;
  authorName: string;
  authorCountry: string | null;
  /** `YYYY-MM-01` */
  stayMonth: string;
  roomLabel: string | null;
  status: "published" | "pending";
  flaggedReason: string | null;
  /** ISO: published_at, or created_at while it is being checked. */
  postedAt: string;
  /** Published and held replies, oldest first. */
  replies: ReviewReply[];
  /** ISO time of the latest private reply in Messages, if any. */
  privateReplyAt: string | null;
  /** Whose turn it is in the public thread; null when it is closed. */
  nextRole: ReplyRole | null;
};

export type ReviewTab = "reply" | "all" | "checking";
export type HostReviewSort = "newest" | "oldest" | "highest" | "lowest";

/** Published, the host's turn, and not answered privately since the thread's last reply. */
export function needsReply(r: HostReview): boolean {
  if (r.status !== "published" || r.nextRole !== "host") return false;
  if (r.privateReplyAt === null) return true;
  const last = r.replies.at(-1)?.createdAt;
  return last !== undefined && Date.parse(r.privateReplyAt) < Date.parse(last);
}

export function inTab(r: HostReview, tab: ReviewTab): boolean {
  if (tab === "reply") return needsReply(r);
  if (tab === "all") return r.status === "published";
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

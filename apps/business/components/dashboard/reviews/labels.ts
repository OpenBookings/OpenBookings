import type { HostReview } from "@/lib/reviews/shape";

const month = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Oct 2026" from `YYYY-MM-01`. */
export function stayMonthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return month.format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/** "Anna, DE" */
export function byline(r: Pick<HostReview, "authorName" | "authorCountry">): string {
  return r.authorCountry ? `${r.authorName}, ${r.authorCountry}` : r.authorName;
}

/** A review's own score: neutral, colour is for state only. */
export const SCORE_CHIP =
  "inline-flex shrink-0 items-center justify-center rounded-md border bg-muted/40 font-semibold tabular-nums";

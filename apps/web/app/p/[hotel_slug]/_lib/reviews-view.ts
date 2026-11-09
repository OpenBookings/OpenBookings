import { REVIEW_BANDS, reviewBand, type ReviewBand } from "@openbookings/pricing";
import type { PublicReview } from "@openbookings/db/reviews";

/** How the reviews card can order its list. */
export const REVIEW_SORTS = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "highest", label: "Highest score" },
  { id: "lowest", label: "Lowest score" },
] as const;

export type ReviewSort = (typeof REVIEW_SORTS)[number]["id"];

const time = (r: PublicReview) => Date.parse(r.publishedAt);

/** The reviews in one score band (or all), in the chosen order. */
export function filterAndSort(reviews: PublicReview[], band: ReviewBand | "all", sort: ReviewSort): PublicReview[] {
  const list = band === "all" ? [...reviews] : reviews.filter((r) => reviewBand(r.score).id === band);
  return list.sort((a, b) => {
    switch (sort) {
      case "oldest":
        return time(a) - time(b);
      case "highest":
        return b.score - a.score || time(b) - time(a);
      case "lowest":
        return a.score - b.score || time(b) - time(a);
      default:
        return time(b) - time(a);
    }
  });
}

/** How many reviews fall in each band, best first. Bands without any are kept, with 0. */
export function bandCounts(reviews: PublicReview[]): { id: ReviewBand; label: string; count: number }[] {
  return REVIEW_BANDS.map((b) => ({ id: b.id, label: b.label, count: reviews.filter((r) => reviewBand(r.score).id === b.id).length }));
}

/** The review the card shows by default: the newest with text, else the newest. */
export function featuredReview(reviews: PublicReview[]): PublicReview | null {
  const newest = filterAndSort(reviews, "all", "newest");
  return newest.find((r) => r.body) ?? newest[0] ?? null;
}

const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "October 2026" from `YYYY-MM-01`. */
export const stayMonthLabel = (iso: string, short = false) =>
  (short ? monthShort : month).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** "3 November 2026" from an ISO timestamp. */
export const postedLabel = (iso: string) => day.format(new Date(iso));

const regions = new Intl.DisplayNames(["en"], { type: "region" });

/** "Netherlands" from "NL"; the code itself when the name is unknown. */
export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return regions.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

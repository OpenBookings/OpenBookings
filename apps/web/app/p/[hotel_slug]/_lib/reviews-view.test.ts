import { describe, expect, test } from "bun:test";
import type { PublicReview } from "@openbookings/db/reviews";
import { bandCounts, countryName, featuredReview, filterAndSort, stayMonthLabel } from "./reviews-view";

const review = (id: string, score: number, publishedAt: string, body: string | null = "Text"): PublicReview => ({
  id,
  score,
  body,
  authorName: "Anna",
  authorCountry: "NL",
  stayMonth: "2026-10-01",
  roomLabel: null,
  publishedAt,
});

const reviews = [
  review("a", 9, "2026-11-03T10:00:00Z"),
  review("b", 4, "2026-11-05T10:00:00Z", null),
  review("c", 7, "2026-10-01T10:00:00Z"),
  review("d", 10, "2026-09-01T10:00:00Z"),
];

const ids = (list: PublicReview[]) => list.map((r) => r.id);

describe("filterAndSort", () => {
  test("sorts by date either way, and by score with the newest first on a tie", () => {
    expect(ids(filterAndSort(reviews, "all", "newest"))).toEqual(["b", "a", "c", "d"]);
    expect(ids(filterAndSort(reviews, "all", "oldest"))).toEqual(["d", "c", "a", "b"]);
    expect(ids(filterAndSort(reviews, "all", "highest"))).toEqual(["d", "a", "c", "b"]);
    expect(ids(filterAndSort(reviews, "all", "lowest"))).toEqual(["b", "c", "a", "d"]);
  });

  test("filters by score word", () => {
    expect(ids(filterAndSort(reviews, "terrific", "newest"))).toEqual(["a", "d"]);
    expect(ids(filterAndSort(reviews, "bad", "newest"))).toEqual(["b"]);
    expect(ids(filterAndSort(reviews, "great", "newest"))).toEqual([]);
  });

  test("does not reorder the list it was given", () => {
    filterAndSort(reviews, "all", "lowest");
    expect(ids(reviews)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("bandCounts", () => {
  test("counts every band, best first, empty ones included", () => {
    expect(bandCounts(reviews)).toEqual([
      { id: "terrific", label: "Terrific", count: 2 },
      { id: "great", label: "Great", count: 0 },
      { id: "good", label: "Good", count: 1 },
      { id: "okay", label: "Okay", count: 0 },
      { id: "bad", label: "Bad", count: 1 },
    ]);
  });
});

describe("featuredReview", () => {
  test("is the newest review with text", () => {
    expect(featuredReview(reviews)?.id).toBe("a");
    expect(featuredReview([review("x", 8, "2026-11-01T00:00:00Z", null)])?.id).toBe("x");
    expect(featuredReview([])).toBeNull();
  });
});

describe("labels", () => {
  test("month and country", () => {
    expect(stayMonthLabel("2026-10-01")).toBe("October 2026");
    expect(stayMonthLabel("2026-10-01", true)).toBe("Oct 2026");
    expect(countryName("nl")).toBe("Netherlands");
    expect(countryName(null)).toBeNull();
  });
});

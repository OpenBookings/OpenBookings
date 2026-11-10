import { describe, expect, test } from "bun:test";
import type { ReviewReply } from "@openbookings/db/reviews";
import { filterHostReviews, needsReply, summarize, type HostReview } from "./shape";

const NOW = new Date("2031-11-20T12:00:00Z");

let n = 0;
function review(extra: Partial<HostReview> = {}): HostReview {
  n += 1;
  return {
    id: `r${n}`,
    bookingId: `b${n}`,
    propertyId: "p1",
    propertyName: "Canal House",
    score: 8,
    body: "Nice.",
    authorName: "Anna",
    authorCountry: "NL",
    stayMonth: "2031-11-01",
    roomLabel: "Double",
    status: "published",
    flaggedReason: null,
    postedAt: "2031-11-15T10:00:00.000Z",
    replies: [],
    privateReplyAt: null,
    nextRole: "host",
    ...extra,
  };
}

const reply = (role: "host" | "guest"): ReviewReply => ({
  id: `x${role}`,
  role,
  body: "Thanks",
  status: "published",
  publishedAt: "2031-11-16T10:00:00.000Z",
  editedAt: null,
  createdAt: "2031-11-16T10:00:00.000Z",
});

describe("needsReply", () => {
  test("a fresh published review needs a reply", () => {
    expect(needsReply(review())).toBe(true);
  });
  test("not after a host reply", () => {
    expect(needsReply(review({ replies: [reply("host")], nextRole: "guest" }))).toBe(false);
  });
  test("again after the guest answered", () => {
    expect(needsReply(review({ replies: [reply("host"), reply("guest")], nextRole: "host" }))).toBe(true);
  });
  test("not after a private reply with no public thread", () => {
    expect(needsReply(review({ privateReplyAt: "2031-11-16T10:00:00.000Z" }))).toBe(false);
  });
  test("not while the review is being checked", () => {
    expect(needsReply(review({ status: "pending" }))).toBe(false);
  });
});

describe("summarize", () => {
  test("no average below 3 recent reviews", () => {
    expect(summarize([review(), review()], "all", NOW).average).toBeNull();
  });
  test("averages the last 24 months and names the band", () => {
    const list = [
      review({ score: 9 }),
      review({ score: 8 }),
      review({ score: 9 }),
      review({ score: 1, postedAt: "2029-10-01T10:00:00.000Z" }),
    ];
    const s = summarize(list, "all", NOW);
    expect(s.average).toBe(8.7);
    expect(s.band).toBe("Great");
    expect(s.recentCount).toBe(3);
    expect(s.waiting).toBe(4);
    expect(s.bands.find((b) => b.id === "terrific")?.count).toBe(2);
  });
  test("one property only", () => {
    const list = [review({ propertyId: "p2" }), review()];
    expect(summarize(list, "p2", NOW).recentCount).toBe(1);
  });
  test("reviews being checked don't count", () => {
    expect(summarize([review({ status: "pending" })], "all", NOW)).toMatchObject({ recentCount: 0, waiting: 0 });
  });
});

describe("filterHostReviews", () => {
  const list = [review({ score: 9 }), review({ score: 5 }), review({ score: 6, status: "pending" }), review({ score: 7, nextRole: "guest" })];
  test("tabs", () => {
    expect(filterHostReviews(list, { tab: "reply", propertyId: "all", band: "all", sort: "newest" })).toHaveLength(2);
    expect(filterHostReviews(list, { tab: "all", propertyId: "all", band: "all", sort: "newest" })).toHaveLength(3);
    expect(filterHostReviews(list, { tab: "checking", propertyId: "all", band: "all", sort: "newest" })).toHaveLength(1);
  });
  test("lowest first, and the okay band is 5 and 6", () => {
    const sorted = filterHostReviews(list, { tab: "all", propertyId: "all", band: "all", sort: "lowest" });
    expect(sorted.map((r) => r.score)).toEqual([5, 7, 9]);
    const okay = filterHostReviews(list, { tab: "all", propertyId: "all", band: "okay", sort: "newest" });
    expect(okay.map((r) => r.score)).toEqual([5]);
  });
});

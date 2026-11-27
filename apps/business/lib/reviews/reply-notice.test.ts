import { describe, expect, test } from "bun:test";
import { REVIEW_RULES, type AuthorModeration } from "@openbookings/pricing";
import { bookingReference } from "@openbookings/db/booking-reference";
import { hostReplyNotice } from "./reply-notice";

const BOOKING = "3f1c2a9e-5b7d-4c11-9a2e-7d1f0b6c8e42";
const NOW = new Date("2026-11-21T09:00:00Z");
const OBJECTION = `mailto:support@openbookings.co?subject=${encodeURIComponent(`Reply decision, booking ${bookingReference(BOOKING)}`)}`;

const base: AuthorModeration = {
  written: "We spoke to Jan Jansen about it.",
  flaggedRules: ["personal_details"],
  decision: null,
  decisionRules: [],
  decisionNote: null,
  decidedAt: null,
  publishedByDeadline: false,
  maskedBody: null,
  textPurged: false,
  heldSince: "2026-11-20T10:00:00.000Z",
};

const notice = (status: "pending" | "published" | "removed", moderation: AuthorModeration, now = NOW) =>
  hostReplyNotice({ status, moderation, bookingId: BOOKING, timeZone: "Europe/Amsterdam", now });

describe("hostReplyNotice", () => {
  test("held: being checked, and when it publishes masked if nobody has, in the property's time", () => {
    expect(notice("pending", base)).toEqual({
      state: "held",
      pill: "Being checked",
      tone: "attention",
      line: "Waiting for a person to check it. If nobody has by 23 Nov 2026, 11:00 CET, it publishes with the flagged parts replaced by [removed].",
    });
    expect(notice("pending", base, new Date("2026-11-24T09:00:00Z"))).toMatchObject({
      line: "Waiting for a person to check it. It isn't shown yet.",
    });
  });

  test("removed: by a person, when, the rules, the note, and how to object", () => {
    const removed = { ...base, decision: "removed" as const, decisionRules: ["personal_details" as const], decisionNote: "First names only.", decidedAt: "2026-11-22T10:00:00.000Z" };
    expect(notice("removed", removed)).toEqual({
      state: "removed",
      pill: "Removed",
      tone: "stopped",
      line: "Removed by a person at OpenBookings on 22 Nov 2026. It's no longer on your page.",
      lead: "It broke these",
      rules: [REVIEW_RULES.personal_details],
      note: "First names only.",
      written: { text: "We spoke to Jan Jansen about it.", purged: false },
      objection: OBJECTION,
    });
    expect(notice("removed", { ...removed, decisionNote: null })).toMatchObject({ note: null });
    // After the purge: a line saying so instead of the words.
    expect(notice("removed", { ...removed, written: null })).toMatchObject({
      written: { text: "The text was deleted after 12 months.", purged: true },
    });
  });

  test("published with parts removed: automatic, the check's rules, and what was written", () => {
    expect(notice("published", { ...base, publishedByDeadline: true, maskedBody: "We spoke to [removed] about it." })).toEqual({
      state: "masked",
      pill: "Published with parts removed",
      tone: "attention",
      line: "This happened automatically after 72 hours because nobody had checked it yet.",
      lead: "The parts replaced by [removed] seemed to break these",
      rules: [REVIEW_RULES.personal_details],
      note: null,
      written: { text: "We spoke to Jan Jansen about it.", purged: false },
      objection: OBJECTION,
    });
  });

  test("published as written, or kept: nothing", () => {
    expect(notice("published", base)).toBeNull();
    expect(notice("published", { ...base, decision: "kept", publishedByDeadline: true })).toBeNull();
  });
});

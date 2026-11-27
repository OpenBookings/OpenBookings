import { describe, expect, test } from "bun:test";
import type { QueueRow } from "./moderation";
import { highlightSegments, itemView } from "./moderation-view";

const HOUR = 3_600_000;
const WRITTEN = new Date("2031-11-15T12:00:00Z");

const row = (over: Partial<QueueRow> = {}): QueueRow => ({
  kind: "review",
  id: "b7b02a1c-52c4-4c3e-9d1f-0a5b2c3d4e5f",
  replyAuthor: null,
  version: "1",
  propertyId: "p",
  propertyName: "Canal Lantern Hotel",
  bookingId: "b7b02a1c-52c4-4c3e-9d1f-0a5b2c3d4e5f",
  authorName: "Anna",
  authorCountry: "NL",
  stayMonth: "2031-11-01",
  score: 3,
  body: "The night man was a useless idiot. Text +31 6 12345678.",
  maskedBody: null,
  fragments: ["useless idiot", "+31 6 12345678"],
  rules: ["abuse", "links_contact"],
  otherReasons: [],
  checkSource: "mistral",
  status: "pending",
  writtenAt: WRITTEN,
  deadline: new Date(WRITTEN.getTime() + 72 * HOUR),
  publishedAt: null,
  publishedByDeadline: false,
  reviewStatus: null,
  authorReachable: true,
  rewriteUntil: new Date("2031-12-26T12:00:00Z"),
  rewriteUsed: false,
  reports: [],
  decision: null,
  ...over,
});

describe("highlightSegments", () => {
  test("marks every occurrence, merging overlaps, ignoring what isn't there", () => {
    expect(highlightSegments("Jan Jansen and Jan Jansen", ["Jan Jansen", "Jansen and", "Piet"])).toEqual([
      { text: "Jan Jansen and", flagged: true },
      { text: " ", flagged: false },
      { text: "Jan Jansen", flagged: true },
    ]);
    expect(highlightSegments("Clean text.", [])).toEqual([{ text: "Clean text.", flagged: false }]);
    expect(highlightSegments("", ["x"])).toEqual([{ text: "", flagged: false }]);
  });
});

describe("itemView", () => {
  test("a held review: countdown, rules, the score aside, the removal spelled out", () => {
    const view = itemView(row(), new Date(WRITTEN.getTime() + 31 * HOUR));
    expect(view.kindLabel).toBe("Review");
    expect(view.context).toEqual({ before: "Canal Lantern Hotel · ", after: " · Anna, NL · stayed Nov 2031" });
    expect(view.bookingRef).toBe("OB-B7B0-2A1C");
    expect(view.badge).toEqual({ text: "Publishes masked in 41 h", tone: "amber" });
    expect(view.rules.map((r) => r.id)).toEqual(["abuse", "links_contact"]);
    expect(view.foundBy).toBe("Found by the contact check and Mistral");
    expect(view.text?.filter((s) => s.flagged).map((s) => s.text)).toEqual(["useless idiot", "+31 6 12345678"]);
    expect(view.footnote).toBe("Score 3/10 · not part of the decision");
    expect(view.actions?.remove).toMatchObject({
      title: "Remove Anna's review of Canal Lantern Hotel?",
      removing: "Removing Anna's review of Canal Lantern Hotel",
      preselected: ["abuse", "links_contact"],
    });
    expect(view.actions?.remove.summary).toBe(
      "It never appears on the property page. Anna gets a short email that it was removed; the review page shows the rules it broke and your note. Anna can write it once more before 26 Dec.",
    );
  });

  test("red under 12 hours; past the deadline it waits", () => {
    expect(itemView(row(), new Date(WRITTEN.getTime() + 66 * HOUR)).badge).toEqual({ text: "Publishes masked in 6 h", tone: "red" });
    expect(itemView(row({ checkSource: null }), new Date(WRITTEN.getTime() + 80 * HOUR)).badge?.text).toBe("Past the deadline · waits for you");
  });

  test("an unchecked item says so", () => {
    const view = itemView(row({ checkSource: "unchecked", rules: [], fragments: [] }), WRITTEN);
    expect(view.badge).toEqual({ text: "Not checked yet · retrying every 15 min", tone: "grey" });
    expect(view.explanation).toContain("Nothing was found by the contact check.");
    expect(view.explanation).toContain("as written in 72 h");
  });

  test("a reported reply from the property", () => {
    const view = itemView(
      row({
        kind: "reply",
        replyAuthor: "host",
        status: "published",
        score: null,
        reviewStatus: "published",
        rules: [],
        fragments: [],
        checkSource: "regex",
        reports: [
          { id: "r1", reporterKind: "public", rule: "personal_details", note: null, emailLeft: true, status: "open", createdAt: WRITTEN },
        ],
      }),
      WRITTEN,
    );
    expect(view.kindLabel).toBe("Reply from the property");
    expect(view.badge).toEqual({ text: "Live while you look", tone: "blue" });
    expect(view.footnote).toBe("Reply · the review it answers is live");
    expect(view.reports).toEqual([{ who: "Public", rule: "No personal details", note: null, extra: "no note, email left for the outcome" }]);
    expect(view.actions).toMatchObject({ keepLabel: "Keep · dismiss reports", removeLabel: "Remove · uphold…" });
    expect(view.actions?.remove.title).toBe("Remove Canal Lantern Hotel's reply to Anna's review?");
    expect(view.actions?.remove.summary).toBe(
      "It disappears from the review's thread. The property gets a short email that it was removed; its Reviews page shows the rules it broke and your note. Its open report closes as upheld.",
    );
    expect(view.actions?.remove.preselected).toEqual(["personal_details"]);
  });

  test("a decided item has no actions", () => {
    const view = itemView(
      row({
        status: "removed",
        decision: { decision: "removed", rules: ["abuse"], note: "No insults.", decidedAt: WRITTEN, decidedBy: "staff@example.test" },
      }),
      WRITTEN,
    );
    expect(view.actions).toBeNull();
    expect(view.badge).toEqual({ text: "Removed", tone: "red" });
    expect(view.decision).toMatchObject({ label: "Removed", note: "No insults.", rules: [{ id: "abuse", title: "No abuse or hate" }] });
    expect(view.text).toEqual([{ text: row().body!, flagged: false }]);
  });
});

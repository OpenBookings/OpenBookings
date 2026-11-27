import { describe, expect, test } from "bun:test";
import {
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  REVIEW_RULES,
  REVIEW_RULE_IDS,
  fragmentRanges,
  isReviewRuleId,
  maskFragments,
  authorNotice,
  type AuthorModeration,
  type ReviewRuleId,
} from "./moderation";

describe("fragmentRanges", () => {
  test("every occurrence, overlapping and touching ones merged, in order", () => {
    expect(fragmentRanges("ab cd ab", ["ab", "b c", "d"])).toEqual([
      [0, 5],
      [6, 8],
    ]);
  });

  test("empty fragments and ones that aren't in the text are ignored", () => {
    expect(fragmentRanges("lovely stay", ["", "rude"])).toEqual([]);
  });
});

describe("maskFragments", () => {
  test("masks every occurrence of a fragment", () => {
    expect(maskFragments("call 0612345678 or 0612345678", ["0612345678"])).toBe(
      `call ${MASKED_TEXT} or ${MASKED_TEXT}`,
    );
  });

  test("masks the longer of two overlapping fragments in one piece", () => {
    expect(maskFragments("call 0612345678", ["0612345678", "call 0612345678"])).toBe(MASKED_TEXT);
    expect(maskFragments("call 0612345678", ["call 0612345678", "0612345678"])).toBe(MASKED_TEXT);
  });

  test("ignores a fragment that is not in the text", () => {
    expect(maskFragments("lovely stay", ["rude"])).toBe("lovely stay");
  });

  test("leaves the text unchanged with no fragments", () => {
    expect(maskFragments("lovely stay", [])).toBe("lovely stay");
  });

  test("a short fragment never matches inside an earlier mask", () => {
    expect(maskFragments("rude man, they moved my bags", ["rude man", "move"])).toBe(
      "[removed], they [removed]d my bags",
    );
  });

  test("a fragment that is part of the mask text is harmless", () => {
    expect(maskFragments("rude man", ["rude man", "removed"])).toBe("[removed]");
    expect(maskFragments("a removed b", ["[removed]", "removed"])).toBe("a [removed] b");
    expect(maskFragments("x [removed] y", ["[removed]"])).toBe("x [removed] y");
  });

  test("partially overlapping fragments mask in one piece", () => {
    expect(maskFragments("call 0612 x", ["call 06", "612 x"])).toBe("[removed]");
  });

  test("treats metacharacters literally", () => {
    expect(maskFragments("a.b axb (x) $1 foo", ["a.b", "(x)", "$1", ".*"])).toBe(
      "[removed] axb [removed] [removed] foo",
    );
  });

  test("ignores empty fragments", () => {
    expect(maskFragments("lovely stay", [""])).toBe("lovely stay");
  });
});

describe("review rules", () => {
  test("every rule has a title and description", () => {
    for (const id of REVIEW_RULE_IDS) {
      expect(REVIEW_RULES[id].title.length).toBeGreaterThan(0);
      expect(REVIEW_RULES[id].description.length).toBeGreaterThan(0);
    }
  });

  test("personal_details allows first names and bans surnames and accusations", () => {
    const text = REVIEW_RULES.personal_details.description.toLowerCase();
    expect(text).toContain("first name");
    expect(text).toContain("surname");
    expect(text).toContain("crime or misconduct");
  });

  test("no rule mentions the score", () => {
    for (const id of REVIEW_RULE_IDS) {
      expect(JSON.stringify(REVIEW_RULES[id]).toLowerCase()).not.toMatch(/score|rating|stars/);
    }
  });

  test("isReviewRuleId accepts known ids only", () => {
    expect(isReviewRuleId("abuse")).toBe(true);
    expect(isReviewRuleId("score")).toBe(false);
    expect(isReviewRuleId(3)).toBe(false);
  });

  test("MODERATION_DEADLINE_HOURS is 72", () => {
    expect(MODERATION_DEADLINE_HOURS).toBe(72);
  });
});

describe("authorNotice", () => {
  const base: AuthorModeration = {
    written: "Lovely stay. Call Jan on 0612345678.",
    flaggedRules: ["links_contact"],
    decision: null,
    decisionRules: [],
    decisionNote: null,
    decidedAt: null,
    publishedByDeadline: false,
    maskedBody: null,
    textPurged: false,
    deadlineMay: true,
    heldSince: "2026-11-20T10:00:00.000Z",
  };

  test("held: waiting for a person, with the deadline 72 hours after it was written", () => {
    expect(authorNotice("pending", base)).toEqual({
      state: "held",
      deadline: new Date("2026-11-23T10:00:00.000Z"),
      publishesAtDeadline: true,
    });
    // The deadline can't publish it (deadlineMaySql): it waits for a person.
    expect(authorNotice("pending", { ...base, deadlineMay: false })).toMatchObject({ state: "held", publishesAtDeadline: false });
  });

  test("removed: the rules and note the person gave, and when", () => {
    const m = { ...base, decision: "removed" as const, decisionRules: ["abuse", "threat"] as ReviewRuleId[], decisionNote: "No insults.", decidedAt: "2026-11-21T09:00:00.000Z" };
    expect(authorNotice("removed", m)).toEqual({
      state: "removed",
      rules: ["abuse", "threat"],
      note: "No insults.",
      decidedAt: new Date("2026-11-21T09:00:00.000Z"),
    });
  });

  test("removed before moderation recorded decisions: no rules, note or date", () => {
    expect(authorNotice("removed", base)).toEqual({ state: "removed", rules: [], note: null, decidedAt: null });
  });

  test("published with parts removed by the deadline: the check's rules, not a decision's", () => {
    const m = { ...base, publishedByDeadline: true, maskedBody: "Lovely stay. Call Jan on [removed]." };
    expect(authorNotice("published", m)).toEqual({
      state: "masked",
      rules: ["links_contact"],
      published: "Lovely stay. Call Jan on [removed].",
      written: "Lovely stay. Call Jan on 0612345678.",
    });
  });

  test("published as written, kept, or published by the deadline with nothing to mask: nothing to say", () => {
    expect(authorNotice("published", base)).toBeNull();
    expect(authorNotice("published", { ...base, decision: "kept", publishedByDeadline: true, maskedBody: "x [removed]" })).toBeNull();
    expect(authorNotice("published", { ...base, publishedByDeadline: true })).toBeNull();
    expect(authorNotice("hidden", base)).toBeNull();
    expect(authorNotice("deleted", base)).toBeNull();
  });
});

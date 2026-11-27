import { describe, expect, test } from "bun:test";
import {
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  REVIEW_RULES,
  REVIEW_RULE_IDS,
  fragmentRanges,
  isReviewRuleId,
  maskFragments,
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

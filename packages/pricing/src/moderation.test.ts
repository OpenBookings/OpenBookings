import { describe, expect, test } from "bun:test";
import {
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  REVIEW_RULES,
  REVIEW_RULE_IDS,
  isReviewRuleId,
  maskFragments,
} from "./moderation";

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

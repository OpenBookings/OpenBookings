/**
 * Review and reply moderation: the rules, the deadline and the masking of
 * flagged text. Moderation is about the words only. The score is never part of
 * a rule and never changes how a review is treated.
 */

export const REVIEW_RULE_IDS = [
  "abuse",
  "threat",
  "personal_details",
  "links_contact",
  "off_topic",
  "conflict_of_interest",
] as const;

export type ReviewRuleId = (typeof REVIEW_RULE_IDS)[number];

/** The public wording: the rules page, removal emails and the admin picker. */
export const REVIEW_RULES: Record<ReviewRuleId, { title: string; description: string }> = {
  abuse: {
    title: "No abuse or hate",
    description:
      "Criticise the stay, not the people. Insults, slurs, harassment and hate towards anyone, including hate based on who they are, are not allowed.",
  },
  threat: {
    title: "No threats",
    description: "Threats of harm, violence or revenge against a person or a property are not allowed.",
  },
  personal_details: {
    title: "No personal details",
    description:
      "First names of staff are fine, in praise or criticism. Surnames, full names, and contact details of staff or other guests (phone numbers, email addresses, home addresses) are not allowed. Accusing a named person of a crime or misconduct is not allowed either.",
  },
  links_contact: {
    title: "No links or contact details for promotion",
    description:
      "Links, phone numbers, email addresses and social media handles used to advertise or to move people elsewhere are not allowed.",
  },
  off_topic: {
    title: "Stay on topic",
    description:
      "Write about the stay itself. Spam, advertising and text that has nothing to do with the property are not allowed.",
  },
  conflict_of_interest: {
    title: "No conflicts of interest",
    description:
      "Don't write about your own property or a competitor's, and don't write on behalf of someone who has been offered something in return.",
  },
};

/** A held item publishes this many hours after submission if nobody decided. */
export const MODERATION_DEADLINE_HOURS = 72;

/** Reports and the original text of removed or masked items are deleted this long after the decision. */
export const MODERATION_RECORD_RETENTION_MONTHS = 12;

/** Replaces each flagged fragment in text that publishes at the deadline. */
export const MASKED_TEXT = "[removed]";

/** The outcome of checking one text, by the regex screen or by Mistral. */
export type TextCheck = {
  verdict: "clean" | "flagged" | "unchecked";
  rules: ReviewRuleId[];
  fragments: string[];
  source: "regex" | "mistral";
};

export function isReviewRuleId(x: unknown): x is ReviewRuleId {
  return typeof x === "string" && (REVIEW_RULE_IDS as readonly string[]).includes(x);
}

/**
 * Replaces every occurrence of each fragment with MASKED_TEXT. All matches are
 * found in the original text, then overlapping or touching ranges are merged
 * and each merged range is replaced once, so a fragment can never match inside
 * an earlier mask and overlaps mask in one piece. Fragments are matched
 * literally. Fragments that aren't in the text (or are empty) are ignored; it
 * never throws.
 */
export function maskFragments(body: string, fragments: string[]): string {
  const ranges: Array<[number, number]> = [];
  for (const fragment of new Set(fragments)) {
    if (fragment.length === 0) continue;
    let from = body.indexOf(fragment);
    while (from !== -1) {
      ranges.push([from, from + fragment.length]);
      from = body.indexOf(fragment, from + 1);
    }
  }
  if (ranges.length === 0) return body;
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = "";
  let cursor = 0;
  let [start, end] = ranges[0];
  for (const [s, e] of ranges.slice(1)) {
    if (s <= end) {
      end = Math.max(end, e);
      continue;
    }
    out += body.slice(cursor, start) + MASKED_TEXT;
    cursor = end;
    [start, end] = [s, e];
  }
  return out + body.slice(cursor, start) + MASKED_TEXT + body.slice(end);
}

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

/** The date on the public rules page (/legal/review-rules). Change it with REVIEW_RULES' wording or the process the page describes. */
export const REVIEW_RULES_LAST_UPDATED = "2026-11-27";

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
 * Where the fragments are in the text: every occurrence of each fragment,
 * found in the original, with overlapping or touching ranges merged, sorted.
 * Fragments are matched literally; empty ones, and ones that aren't in the
 * text, are ignored. maskFragments masks these ranges, and the admin queue
 * highlights them, so the two never disagree.
 */
export function fragmentRanges(text: string, fragments: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const fragment of new Set(fragments)) {
    if (typeof fragment !== "string" || fragment.length === 0) continue;
    for (let from = text.indexOf(fragment); from !== -1; from = text.indexOf(fragment, from + 1)) {
      ranges.push([from, from + fragment.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * Replaces every occurrence of each fragment with MASKED_TEXT. Each merged
 * range (fragmentRanges) is replaced once, so a fragment can never match
 * inside an earlier mask and overlaps mask in one piece. Fragments that
 * aren't in the text (or are empty) are ignored; it never throws.
 */
export function maskFragments(body: string, fragments: string[]): string {
  let out = "";
  let cursor = 0;
  for (const [start, end] of fragmentRanges(body, fragments)) {
    out += body.slice(cursor, start) + MASKED_TEXT;
    cursor = end;
  }
  return out + body.slice(cursor);
}

// ── What the author is told ──────────────────────────────────────────────────

/**
 * What the author of a review or reply may see about its moderation, on their
 * own page (the guest's review page, the host's Reviews page). Times are ISO
 * strings: the business app hands them to client components.
 */
export type AuthorModeration = {
  /** Their words as written (null when there were none, or after the purge). */
  written: string | null;
  /** What the automated check flagged (flagged_reason): known rules only. */
  flaggedRules: ReviewRuleId[];
  decision: "kept" | "removed" | null;
  decisionRules: ReviewRuleId[];
  decisionNote: string | null;
  decidedAt: string | null;
  publishedByDeadline: boolean;
  /** As the deadline published it, flagged parts replaced; null otherwise (a Keep clears it). */
  maskedBody: string | null;
  /** When its words were written: the deadline counts from here. */
  heldSince: string;
};

/** What happened to it, for its author. Nothing to say when it is published as written, or kept. */
export type AuthorNotice =
  | { state: "held"; deadline: Date }
  | { state: "removed"; rules: ReviewRuleId[]; note: string | null; decidedAt: Date | null }
  | { state: "masked"; rules: ReviewRuleId[]; published: string; written: string | null };

/**
 * Held: waiting for a person, until the deadline. Removed: what the person
 * decided (rules, note, when). Published with parts removed: nobody decided,
 * so the rules are the check's, not a decision's.
 */
export function authorNotice(
  status: "pending" | "published" | "hidden" | "removed" | "deleted",
  m: AuthorModeration,
): AuthorNotice | null {
  if (status === "pending") {
    return { state: "held", deadline: new Date(Date.parse(m.heldSince) + MODERATION_DEADLINE_HOURS * 60 * 60 * 1000) };
  }
  if (status === "removed") {
    return {
      state: "removed",
      rules: m.decisionRules,
      note: m.decisionNote,
      decidedAt: m.decidedAt ? new Date(m.decidedAt) : null,
    };
  }
  if (status === "published" && m.publishedByDeadline && m.maskedBody !== null && m.decision !== "kept") {
    return { state: "masked", rules: m.flaggedRules, published: m.maskedBody, written: m.written };
  }
  return null;
}

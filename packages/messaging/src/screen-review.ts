import { detectCircumvention } from "./circumvention";

/**
 * The automated check before a review is published. Anything it flags is
 * held as 'pending' for a person, never rejected: a false positive (a date
 * read as a phone number) costs a delay, not the review.
 *
 * Contact details reuse messaging's circumvention check; links are added here.
 * No profanity list yet: one that works across EU languages is its own job.
 */

// Bounded and anchored on a word boundary, so a hostile body can't make it backtrack.
const URL_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]{1,63}\.|(?<![@\w.-])[a-z0-9-]{1,63}\.(?:com|net|org|eu|nl|de|be|fr|es|it|at|pt|io|co|info|biz|me|ly)\b(?:\/|\s|$)/i;

/** A comma-separated flag reason, or null when the text looks clean. */
export function screenReview(body: string | null): string | null {
  if (!body) return null;
  const reasons = new Set<string>();
  const contact = detectCircumvention(body);
  if (contact) for (const r of contact.split(",")) reasons.add(r);
  if (URL_RE.test(body)) reasons.add("url");
  return reasons.size > 0 ? [...reasons].join(",") : null;
}

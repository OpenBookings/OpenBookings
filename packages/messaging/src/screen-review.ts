import { circumventionMatches, contactHandles, detectCircumvention } from "./circumvention";

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

const URL_RE_ALL = new RegExp(URL_RE.source, "gi");
const URL_TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "'", '"']);

/**
 * The whole link a URL_RE match starts: the pattern only anchors on the start
 * (`https://`, `www.example.`), so the fragment runs on to the next whitespace,
 * without trailing punctuation.
 */
function linkAt(body: string, start: number): string {
  let end = start;
  while (end < body.length && !/\s/.test(body[end])) end++;
  while (end > start && URL_TRAILING.has(body[end - 1])) end--;
  return body.slice(start, end);
}

/**
 * The regex half of review moderation: real contact details (phone numbers,
 * email addresses, links and handles) break `links_contact`, and `fragments`
 * are the exact pieces of text that matched, ready to be masked. Stricter than
 * screenReview: a bare app name ("the wifi signal", "we snapped photos") is
 * not a contact detail in a review. Message screening is unchanged.
 */
export function screenReviewFragments(body: string | null): { rules: "links_contact"[]; fragments: string[] } {
  if (!body) return { rules: [], fragments: [] };
  const fragments = new Set<string>(
    circumventionMatches(body)
      .filter((m) => m.reason !== "messenger_handle")
      .map((m) => m.text),
  );
  for (const handle of contactHandles(body)) fragments.add(handle);
  let linkEnd = 0;
  for (const m of body.matchAll(URL_RE_ALL)) {
    if (m.index < linkEnd) continue; // the bare domain inside a link already taken
    const link = linkAt(body, m.index);
    fragments.add(link);
    linkEnd = m.index + link.length;
  }
  return fragments.size > 0 ? { rules: ["links_contact"], fragments: [...fragments] } : { rules: [], fragments: [] };
}

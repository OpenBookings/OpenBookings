/**
 * v1 policy: warn-and-log, not block. Flagged messages are still inserted
 * (with flagged_reason set) so the send isn't blocked on a false positive;
 * the API response surfaces the warning so the UI can show it to the sender.
 * Revisit block-vs-warn once we've seen the false-positive rate in practice.
 */

/**
 * Candidate runs only — the digit count below is the real gate. Nothing
 * follows the character class, so there is no ambiguous split for a regex
 * engine to backtrack over on a hostile message body (see EMAIL_RE).
 */
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{6,}/g;

const PHONE_TRAILING = new Set([" ", "\t", "\n", "\r", "(", ")", ".", "-"]);

/** Candidates with at least 7 digits, without the separators they end on. */
function phoneNumbers(body: string): string[] {
  const candidates = body.match(PHONE_CANDIDATE_RE) ?? [];
  return candidates
    .filter((c) => c.replace(/\D/g, "").length >= 7)
    .map((c) => {
      // A loop rather than a regex: `[\s().-]+$` backtracks quadratically on a long run.
      let end = c.length;
      while (end > 0 && PHONE_TRAILING.has(c[end - 1])) end--;
      return c.slice(0, end);
    });
}

/**
 * Message bodies are attacker-controlled, so this must not backtrack
 * super-linearly. The domain labels exclude `.` (so no label can also be
 * consumed by the dot that separates it from the next one) and every
 * quantifier is bounded to its RFC 1035 limit, which caps the work per
 * starting position regardless of input.
 */
const EMAIL_RE =
  /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63}){0,10}\.[a-zA-Z]{2,24}/;

const MESSENGER_RE =
  /\b(whatsapp|wa\.me|t\.me|telegram|instagram|\binsta\b|snapchat|\bsnap\b|wechat|\bkik\b|signal|facebook\.com\/messages|m\.me)\b/i;

export type CircumventionReason = "phone_number" | "email_address" | "messenger_handle";

/** The same patterns as above, global, so every match can be read back. */
const EMAIL_RE_ALL = new RegExp(EMAIL_RE.source, "g");
const MESSENGER_RE_ALL = new RegExp(MESSENGER_RE.source, "gi");

/**
 * Each piece of text the check flags, with its reason, in detection order
 * (phone numbers, then email addresses, then messenger names). Every `text` is
 * an exact substring of the body.
 */
export function circumventionMatches(body: string): { reason: CircumventionReason; text: string }[] {
  return [
    ...phoneNumbers(body).map((text) => ({ reason: "phone_number" as const, text })),
    ...[...body.matchAll(EMAIL_RE_ALL)].map((m) => ({ reason: "email_address" as const, text: m[0] })),
    ...[...body.matchAll(MESSENGER_RE_ALL)].map((m) => ({ reason: "messenger_handle" as const, text: m[0] })),
  ];
}

/**
 * An @handle that isn't the middle of an email address. Bounded, and the
 * lookbehind is one character, so it can't backtrack.
 */
const AT_HANDLE_RE = /(?<![\w.%+-])@[A-Za-z0-9_][A-Za-z0-9_.]{1,29}/g;

/** A messenger name followed by a handle-like token: "insta: hotel_guest99". */
const APP_HANDLE_RE = new RegExp(`(?:${MESSENGER_RE.source})[\\s:]{1,3}@?([A-Za-z0-9_.]{3,30})`, "gi");

function trimDots(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ".") end--;
  return s.slice(0, end);
}

/** A number with a unit or a time after it: "100mbps", "2.5ghz", "7pm". */
const NUMBER_UNIT_RE = /^\d{1,6}(?:[.,]\d{1,3})?[a-z]{1,4}$/i;

/** A token that could name an account: it has a letter and isn't a measurement or a time. */
function nameLike(token: string): boolean {
  return /[A-Za-z]/.test(token) && !NUMBER_UNIT_RE.test(token);
}

/**
 * Handles someone can actually be reached on: an @handle, or a token after a
 * messenger name that has a digit or underscore in it (so "on telegram
 * yesterday" is not one). Either way it needs a letter and can't be a number
 * with a unit ("dinner @7pm", "wifi signal 100mbps"). A bare messenger name is
 * not a handle. Every result is an exact substring of the body. Only the
 * review check uses this; message screening is detectCircumvention.
 */
export function contactHandles(body: string): string[] {
  const handles = [...body.matchAll(AT_HANDLE_RE)].map((m) => trimDots(m[0])).filter((h) => nameLike(h.slice(1)));
  for (const m of body.matchAll(APP_HANDLE_RE)) {
    const token = trimDots(m[2]);
    if (/[\d_]/.test(token) && nameLike(token) && !handles.some((h) => h.slice(1) === token)) handles.push(token);
  }
  return handles.filter((h) => h.replace(/^@/, "").length >= 2);
}

/** Returns a comma-separated flagged_reason, or null if the body looks clean. */
export function detectCircumvention(body: string): string | null {
  const reasons = new Set(circumventionMatches(body).map((m) => m.reason));
  return reasons.size > 0 ? [...reasons].join(",") : null;
}

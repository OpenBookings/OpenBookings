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

function hasPhoneNumber(body: string): boolean {
  const candidates = body.match(PHONE_CANDIDATE_RE) ?? [];
  return candidates.some((c) => c.replace(/\D/g, "").length >= 7);
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

/** Returns a comma-separated flagged_reason, or null if the body looks clean. */
export function detectCircumvention(body: string): string | null {
  const reasons: string[] = [];
  if (hasPhoneNumber(body)) reasons.push("phone_number");
  if (EMAIL_RE.test(body)) reasons.push("email_address");
  if (MESSENGER_RE.test(body)) reasons.push("messenger_handle");
  return reasons.length > 0 ? reasons.join(",") : null;
}

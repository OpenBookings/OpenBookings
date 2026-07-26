/**
 * v1 policy: warn-and-log, not block. Flagged messages are still inserted
 * (with flagged_reason set) so the send isn't blocked on a false positive;
 * the API response surfaces the warning so the UI can show it to the sender.
 * Revisit block-vs-warn once we've seen the false-positive rate in practice.
 */

const PHONE_CANDIDATE_RE = /(\+?\d[\d\s().-]{6,}\d)/g;

function hasPhoneNumber(body: string): boolean {
  const candidates = body.match(PHONE_CANDIDATE_RE) ?? [];
  return candidates.some((c) => c.replace(/\D/g, "").length >= 7);
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

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

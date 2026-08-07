import type { PaymentSummary } from "@openbookings/stripe";

/**
 * Rule-driven escalation — the safety net that runs regardless of model
 * judgment. Two hooks:
 *
 *  1. `messageTriggersEscalation` on the incoming guest message, before the
 *     Mistral call ever runs.
 *  2. `paymentTriggersEscalation` on every `get_payment_status` result inside
 *     the loop.
 *
 * Dispute/chargeback procedures are defined in the partner agreement and have
 * real financial/legal exposure, so they must never be left entirely to the
 * model.
 */

/**
 * Strip diacritics and case so one ASCII pattern matches however the guest
 * typed it — "rückbuchung" / "ruckbuchung", "rétrofacturation" /
 * "retrofacturation". Patterns below are therefore written unaccented.
 */
function normalize(message: string): string {
  return message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Dispute/chargeback vocabulary in the languages we see most (EN/NL/DE/FR).
 * Deliberately narrow: a guest asking whether they can get a refund, or
 * complaining about the room, stays with the bot. Only language that means
 * "I am going around you to my bank/card issuer" escalates.
 *
 * Two traps this avoids on purpose:
 *  - German "stornieren"/"stornierung"/"storno" means *cancel a booking*,
 *    while Dutch "storneren" means reverse a direct debit. The strings are
 *    near-identical, so nothing matches a bare `storn-` stem.
 *  - Generic complaint words (klacht, Beschwerde, réclamation, complaint)
 *    are not dispute vocabulary and are excluded.
 */
const DISPUTE_PATTERNS: RegExp[] = [
  // ---- EN ----
  /\bdisput(e|es|ed|ing)\b/,
  /\bcharge.?backs?\b/,
  /\b(my|the) (bank|card issuer|credit card company)\b.{0,40}\b(reclaim|revers|disput|recall|refund|claw)/,
  /\bstop payment\b/,
  /\b(contact|call|go to|going to)\b.{0,20}\bmy (bank|card issuer)\b/,
  // ---- NL ----
  /\bgeschil\b/,
  /\bterugboeking(en)?\b/,
  /\bterugboeken\b/,
  /\bterugvorder(en|ing)\b/,
  /\b(mijn|de) bank\b.{0,40}\b(terugbo|terugvorder|storneer|storneren|terughal)/,
  // ---- DE ----
  /\br(u|ue)ckbuchung(en)?\b/,
  /\bzur(u|ue)ckbuchen\b/,
  /\bstreitfall\b/,
  /\blastschrift\b.{0,40}\bzur(u|ue)ck/,
  /\b(meine|die) bank\b.{0,40}\b(zur(u|ue)ck|einschalt|anfecht)/,
  /\bzahlung\b.{0,30}\banfecht(en|ung)\b/,
  // ---- FR ----
  /\bretrofacturation\b/,
  /\blitige\b/,
  /\bfaire opposition\b/,
  /\bopposition\b.{0,30}\b(carte|paiement|prelevement)/,
  /\bcontester\b.{0,40}\b(paiement|prelevement|debit|transaction|montant)/,
  /\b(ma|la) banque\b.{0,40}\b(rembours|contest|oppos|recuper)/,
];

export function messageTriggersEscalation(message: string): string | null {
  const normalized = normalize(message);
  for (const pattern of DISPUTE_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match) {
      return `Guest message mentions a dispute/chargeback ("${match[0]}") — routed straight to a human per partner-agreement dispute procedure.`;
    }
  }
  return null;
}

/**
 * Force escalation when a payment lookup reveals real exposure: an active
 * dispute/chargeback, or refund activity at/above the threshold (euros).
 */
export function paymentTriggersEscalation(
  summary: PaymentSummary,
  thresholdEur: number,
): string | null {
  const thresholdCents = Math.round(thresholdEur * 100);
  if (summary.disputed) {
    return `Payment ${summary.paymentIntentId} has a dispute/chargeback on the charge.`;
  }
  if (
    summary.amountRefunded >= thresholdCents ||
    summary.refunds.some((r) => r.amount >= thresholdCents)
  ) {
    return `Payment ${summary.paymentIntentId} has refund activity at or above €${thresholdEur} (refunded ${summary.amountRefunded} cents).`;
  }
  return null;
}

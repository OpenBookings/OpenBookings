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
 * Dispute/chargeback vocabulary in the languages we see most (EN/NL/DE/FR).
 * Deliberately narrow: plain refund questions should stay with the bot.
 */
const DISPUTE_PATTERNS: RegExp[] = [
  /\bdisputes?\b/i,
  /\bcharge.?backs?\b/i,
  /\bmy bank\b.{0,40}\b(reclaim|revers|dispute|recall)/i,
  /\bgeschil\b/i, // NL
  /\bterugboeking\b/i, // NL
  /\brückbuchung\b/i, // DE
  /\brétrofacturation\b/i, // FR
  /\blitige\b/i, // FR
];

export function messageTriggersEscalation(message: string): string | null {
  for (const pattern of DISPUTE_PATTERNS) {
    if (pattern.test(message)) {
      return "Guest message mentions a dispute/chargeback — routed straight to a human per partner-agreement dispute procedure.";
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

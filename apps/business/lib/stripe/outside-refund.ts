import type { OutsideRefundInput } from "@openbookings/db";
import { PAYMENT_FLAG_ACTIONS, type StripeAuditEntry } from "@openbookings/stripe";

const text = (v: unknown) => (typeof v === "string" && v ? v : null);
const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? new Date(v * 1000) : null);

/**
 * The booking record for a payment flag: a refund the host made outside
 * OpenBookings, or a lost dispute (`recordOutsideRefund`). Null for any other
 * audit entry, or one missing what the record needs.
 */
export function outsideRefundFromFlag(entry: StripeAuditEntry, now: Date = new Date()): OutsideRefundInput | null {
  const d = entry.detail;
  const amountCents = typeof d.amount === "number" ? d.amount : null;
  const common = {
    paymentIntentId: text(d.paymentIntentId),
    chargeId: text(d.chargeId),
    stripeAccountId: entry.stripeAccountId,
    reason: text(d.reason),
  };
  if (entry.action === PAYMENT_FLAG_ACTIONS.refundOutside) {
    const stripeId = text(d.refundId);
    if (!stripeId || amountCents === null) return null;
    return { ...common, source: "stripe_dashboard", stripeId, amountCents, occurredAt: seconds(d.created) ?? now };
  }
  if (entry.action === PAYMENT_FLAG_ACTIONS.disputeLost) {
    const stripeId = text(d.disputeId);
    if (!stripeId || amountCents === null) return null;
    // Lost when the event came, not when the dispute was opened.
    return { ...common, source: "dispute", stripeId, amountCents, occurredAt: seconds(d.lostAt) ?? now };
  }
  return null;
}

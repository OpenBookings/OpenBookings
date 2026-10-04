import { stripe } from '../client';
import { commissionRefundDue } from './fees';

export type CommissionRefund = { id: string; amount: number };

/**
 * Hand OpenBookings' commission back for a charge that was refunded or lost
 * to a dispute. If the booking did not happen, OpenBookings does not earn.
 *
 * Hosts refund from their own Stripe Dashboard, and Stripe does not return the
 * platform's application fee there by default, so the platform does it here.
 * This moves only OpenBookings' own money, back to the host; it never touches
 * the host's balance in the other direction.
 *
 * Safe to call on every refund or dispute event for a charge, in any order
 * and any number of times: the amount is worked out from what has already
 * been returned, the idempotency key covers a retry that lands mid-request,
 * and Stripe itself refuses to refund more of a fee than is left.
 *
 * Returns EVERY commission refund that now exists on the charge, not just one
 * made by this call. That is what lets the caller record them reliably: if a
 * previous attempt moved the money and then failed before writing its record,
 * the next attempt still sees that refund and can record it.
 */
export async function refundCommissionForCharge(
  chargeId: string,
  stripeAccountId: string,
  options: { lostDisputeAmount?: number } = {},
): Promise<CommissionRefund[]> {
  // The charge lives on the host's account; the fee is the platform's object.
  const charge = await stripe.charges.retrieve(chargeId, {}, { stripeAccount: stripeAccountId });
  const feeId =
    typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee?.id;
  if (!feeId) return [];

  const fee = await stripe.applicationFees.retrieve(feeId);
  const existing: CommissionRefund[] = (fee.refunds?.data ?? []).map((r) => ({
    id: r.id,
    amount: r.amount,
  }));

  const due = commissionRefundDue({
    chargeAmount: charge.amount,
    chargeRefunded: charge.amount_refunded,
    feeAmount: fee.amount,
    feeRefunded: fee.amount_refunded,
    lostDisputeAmount: options.lostDisputeAmount,
  });
  if (due <= 0) return existing;

  const created = await stripe.applicationFees.createRefund(
    fee.id,
    { amount: due },
    { idempotencyKey: `commission-refund:${fee.id}:${fee.amount_refunded + due}` },
  );
  return existing.some((r) => r.id === created.id)
    ? existing
    : [...existing, { id: created.id, amount: created.amount }];
}

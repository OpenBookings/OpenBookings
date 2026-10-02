import { stripe } from '../client';
import { commissionRefundDue } from './fees';

/**
 * Hand OpenBookings' commission back for a charge that was refunded or lost
 * to a dispute. If the booking did not happen, OpenBookings does not earn.
 *
 * Hosts refund from their own Stripe Dashboard, and Stripe does not return the
 * platform's application fee there by default, so the platform does it here.
 * This moves only OpenBookings' own money, back to the host; it never touches
 * the host's balance in the other direction.
 *
 * Safe to call on every refund or dispute event for a charge: the amount is
 * worked out from what has already been returned, so a repeated event returns
 * nothing, and the idempotency key covers a retry that lands mid-request.
 *
 * Returns the amount returned, in minor units (0 when nothing was due).
 */
export async function refundCommissionForCharge(
  chargeId: string,
  stripeAccountId: string,
  options: { lostDispute?: boolean } = {},
): Promise<number> {
  // The charge lives on the host's account; the fee is the platform's object.
  const charge = await stripe.charges.retrieve(chargeId, {}, { stripeAccount: stripeAccountId });
  const feeId =
    typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee?.id;
  if (!feeId) return 0;

  const fee = await stripe.applicationFees.retrieve(feeId);
  const due = commissionRefundDue({
    chargeAmount: charge.amount,
    chargeRefunded: charge.amount_refunded,
    feeAmount: fee.amount,
    feeRefunded: fee.amount_refunded,
    lostDispute: options.lostDispute,
  });
  if (due <= 0) return 0;

  await stripe.applicationFees.createRefund(
    fee.id,
    { amount: due },
    { idempotencyKey: `commission-refund:${fee.id}:${fee.amount_refunded + due}` },
  );
  return due;
}

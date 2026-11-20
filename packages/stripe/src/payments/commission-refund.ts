import type Stripe from 'stripe';
import { stripe } from '../client';
import { commissionRefundDue, roomPriceOfRefunds } from './fees';
import { madeByOpenBookings } from './refund-origin';

export type CommissionRefund = { id: string; amount: number };

/**
 * A refund on the charge that OpenBookings did not make (see
 * `madeByOpenBookings`): the host refunded the guest in their own Stripe
 * Dashboard. OpenBookings cannot tell what it was for, room price or tourist
 * tax, so the commission went back in proportion to the whole payment and
 * the host is asked to explain it.
 */
export type OutsideRefund = {
  id: string;
  amount: number;
  /** Unix seconds, as Stripe gives it. */
  created: number;
  /** Stripe's own refund reason, if the host picked one. */
  reason: string | null;
  status: string | null;
  paymentIntentId: string | null;
};

export type CommissionReturn = {
  /** Every commission refund that now exists on the charge. */
  commissionRefunds: CommissionRefund[];
  /** Refunds on the charge made outside OpenBookings that moved (or may move) money. */
  outsideRefunds: OutsideRefund[];
};

/**
 * Hand OpenBookings' commission back for a charge that was refunded or lost
 * to a dispute. If the booking did not happen, OpenBookings does not earn.
 *
 * The commission goes back in proportion to the room price refunded, never
 * the tourist tax (see `commissionRefundDue`). Refunds OpenBookings makes name
 * their room-price part in their metadata, read here off the charge's refunds.
 * `refundPayment` calls this right after each refund it makes; the
 * `charge.refunded` webhook calls it again as the backstop, and for refunds
 * hosts make in their own Stripe Dashboard, where Stripe does not return the
 * platform's application fee by default. Both work out the same target, so
 * whichever runs second finds nothing left to do.
 *
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
 * the next attempt still sees that refund and can record it. Also returns the
 * charge's refunds that OpenBookings did not make, read from the same list,
 * so the caller can flag them for the host to explain.
 */
export async function refundCommissionForCharge(
  chargeId: string,
  stripeAccountId: string,
  options: { lostDisputeAmount?: number } = {},
): Promise<CommissionReturn> {
  // The charge lives on the host's account; the fee is the platform's object.
  const charge = await stripe.charges.retrieve(chargeId, {}, { stripeAccount: stripeAccountId });

  const refunds: Stripe.Refund[] = [];
  if (charge.amount_refunded > 0) {
    for await (const refund of stripe.refunds.list({ charge: chargeId, limit: 100 }, { stripeAccount: stripeAccountId })) {
      refunds.push(refund);
    }
  }
  const outsideRefunds = refundsOutsideOpenBookings(refunds);

  const feeId =
    typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee?.id;
  if (!feeId) return { commissionRefunds: [], outsideRefunds };

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
    roomPrice: roomPriceOfRefunds(refunds),
  });
  if (due <= 0) return { commissionRefunds: existing, outsideRefunds };

  const created = await stripe.applicationFees.createRefund(
    fee.id,
    { amount: due },
    { idempotencyKey: `commission-refund:${fee.id}:${fee.amount_refunded + due}` },
  );
  const commissionRefunds = existing.some((r) => r.id === created.id)
    ? existing
    : [...existing, { id: created.id, amount: created.amount }];
  return { commissionRefunds, outsideRefunds };
}

/**
 * The refunds OpenBookings did not make. Failed and canceled ones moved no
 * money and are left out; pending ones are kept, as they normally go through.
 */
export function refundsOutsideOpenBookings(
  refunds: Pick<Stripe.Refund, 'id' | 'amount' | 'created' | 'reason' | 'status' | 'metadata' | 'payment_intent'>[],
): OutsideRefund[] {
  return refunds
    .filter((r) => r.status !== 'failed' && r.status !== 'canceled' && !madeByOpenBookings(r.metadata))
    .map((r) => ({
      id: r.id,
      amount: r.amount,
      created: r.created,
      reason: r.reason ?? null,
      status: r.status ?? null,
      paymentIntentId: typeof r.payment_intent === 'string' ? r.payment_intent : (r.payment_intent?.id ?? null),
    }));
}

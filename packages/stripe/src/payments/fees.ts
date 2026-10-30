/**
 * Commission maths. Pure, in minor units, and integer throughout: these
 * numbers move money, so nothing here may depend on floating-point luck.
 */

const RATE_SCALE = 1_000_000;

/**
 * OpenBookings' commission on a booking, taken as a Stripe application fee.
 *
 * Charged on the stay: the room price, which includes VAT. Tourist tax is
 * added on top for the host to pay to their town and is never commissioned,
 * so callers pass the stay alone (see `bookingSplitCents`). Rounded half up
 * to a whole cent, and always below the total — Stripe rejects a fee that
 * swallows the whole payment.
 */
export function applicationFeeCents(totalCents: number, rate: number): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error(`Total must be a whole, non-negative amount in minor units, got ${totalCents}`);
  }
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new Error(`Commission rate must be at least 0 and below 1, got ${rate}`);
  }
  const scaledRate = Math.round(rate * RATE_SCALE);
  const fee = Math.floor((totalCents * scaledRate + RATE_SCALE / 2) / RATE_SCALE);
  return Math.max(0, Math.min(fee, totalCents - 1));
}

/**
 * How one booking's money splits: what the guest pays, what OpenBookings
 * takes, and what lands on the host's account before Stripe's own fees.
 *
 * The guest pays the stay plus tourist tax as one all-in price. Commission is
 * on the stay only; the tourist tax passes through to the host untouched.
 */
export function bookingSplitCents(input: {
  stayCents: number;
  touristTaxCents: number;
  rate: number;
}): { guestTotalCents: number; commissionCents: number; hostReceivesCents: number } {
  const { stayCents, touristTaxCents, rate } = input;
  if (!Number.isInteger(touristTaxCents) || touristTaxCents < 0) {
    throw new Error(`Tourist tax must be a whole, non-negative amount in minor units, got ${touristTaxCents}`);
  }
  const commissionCents = applicationFeeCents(stayCents, rate);
  const guestTotalCents = stayCents + touristTaxCents;
  return { guestTotalCents, commissionCents, hostReceivesCents: guestTotalCents - commissionCents };
}

/**
 * How much more of the commission to hand back, given where the charge now
 * stands. If the booking did not happen, OpenBookings does not earn.
 *
 * Stated as a target rather than a delta, which is what makes it safe to call
 * on every refund event: the commission returned so far is an input, so a
 * redelivered or repeated event computes zero. The final partial refund picks
 * up the rounding remainder, so the parts always sum to the fee exactly.
 */
export function commissionRefundDue(input: {
  chargeAmount: number;
  chargeRefunded: number;
  feeAmount: number;
  feeRefunded: number;
  /**
   * The amount of a dispute the host lost. It counts like a refund of that
   * amount: a guest who wins back EUR 100 of a EUR 555 stay did not undo the
   * whole booking, and the commission on the rest was earned.
   */
  lostDisputeAmount?: number;
}): number {
  const { chargeAmount, feeAmount, feeRefunded } = input;
  if (chargeAmount <= 0 || feeAmount <= 0) return 0;

  // A lost dispute does not show up in the charge's refunded amount, so it is
  // added here; together they can never exceed the charge.
  const undone = Math.min(
    Math.max(input.chargeRefunded, 0) + Math.max(input.lostDisputeAmount ?? 0, 0),
    chargeAmount,
  );
  const target = Math.floor((feeAmount * undone) / chargeAmount);

  return Math.max(0, Math.min(target, feeAmount) - Math.max(feeRefunded, 0));
}

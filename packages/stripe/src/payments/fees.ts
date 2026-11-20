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
 * The metadata keys on a refund OpenBookings makes, naming how much of it was
 * room price. The rest of the refund is tourist tax, which returns no
 * commission: commission is taken on the room price only.
 */
export const ROOM_PRICE_REFUNDED_KEY = 'accommodationCents';
/** The room price on the whole charge: the base the commission was taken on. */
export const ROOM_PRICE_TOTAL_KEY = 'accommodationTotalCents';

/** What refunds that name their room-price part add up to (see `roomPriceOfRefunds`). */
export type RoomPriceRefunded = {
  /** The room price on the charge: the commission's base. */
  roomTotal: number;
  /** The room price those refunds gave back. */
  roomRefunded: number;
  /** What those refunds took off the charge in all, tourist tax included. */
  refunded: number;
};

const wholeCents = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
};

/**
 * The room-price split one refund names in its metadata, or null if it names
 * none (or names it in something other than whole cents).
 */
export function roomPriceSplitOf(
  metadata: Record<string, string> | null | undefined,
): { room: number; total: number } | null {
  const room = wholeCents(metadata?.[ROOM_PRICE_REFUNDED_KEY]);
  const total = wholeCents(metadata?.[ROOM_PRICE_TOTAL_KEY]);
  if (room === null || total === null || total <= 0) return null;
  return { room, total };
}

/**
 * Reads the room-price split off a charge's refunds. Only OpenBookings' own
 * refunds carry it (in their metadata); a refund made in the host's Stripe
 * Dashboard does not, and neither do refunds from before the split. Failed and
 * canceled refunds moved no money and are left out. Null when no refund
 * names a split.
 */
export function roomPriceOfRefunds(
  refunds: { amount: number; status: string | null; metadata?: Record<string, string> | null }[],
): RoomPriceRefunded | null {
  const split = { roomTotal: 0, roomRefunded: 0, refunded: 0 };
  let named = false;
  for (const r of refunds) {
    if (r.status === 'failed' || r.status === 'canceled') continue;
    const part = roomPriceSplitOf(r.metadata);
    if (!part) continue;
    named = true;
    split.roomTotal = Math.max(split.roomTotal, part.total);
    split.roomRefunded += Math.min(part.room, r.amount);
    split.refunded += r.amount;
  }
  return named ? split : null;
}

/**
 * How much more of the commission to hand back, given where the charge now
 * stands. If the booking did not happen, OpenBookings does not earn.
 *
 * Commission is taken on the room price, so it goes back in proportion to the
 * room price refunded: 80% of the room price back means 80% of the commission
 * back, and a refund of tourist tax alone returns none. OpenBookings' own
 * refunds say how much of each was room price (`roomPrice`). OpenBookings' own
 * refunds that name no split (a payment that never became a booking, one the
 * ledger cannot explain, a booking without a room price) and a lost dispute
 * count in proportion to the whole charge (`unsplitRefunded`,
 * `lostDisputeAmount`). A dispute can only take back money that was still on
 * the charge, so it counts for no more than the charge less everything
 * refunded on it, outside refunds included (`chargeRefunded`).
 *
 * A refund the host makes in their own Stripe Dashboard is outside
 * OpenBookings and returns no commission at all: it is not an input here, only
 * flagged for staff (`refundsOutsideOpenBookings`). Any goodwill return is
 * made by hand.
 *
 * Stated as a target rather than a delta, which is what makes it safe to call
 * on every refund event: the commission returned so far is an input, so a
 * redelivered or repeated event computes zero. The final partial refund picks
 * up the rounding remainder, so the parts always sum to the fee exactly.
 * Rounded down, like Stripe's own proration, and never above the fee.
 */
export function commissionRefundDue(input: {
  chargeAmount: number;
  feeAmount: number;
  feeRefunded: number;
  /**
   * Everything refunded on the charge so far, OpenBookings' own refunds and
   * those made outside it. Only caps a lost dispute; it returns no commission
   * by itself.
   */
  chargeRefunded: number;
  /**
   * What OpenBookings' own refunds that name no room-price split took off the
   * charge (`ownUnsplitRefunded`). Never a refund made outside OpenBookings.
   */
  unsplitRefunded?: number;
  /**
   * The amount of a dispute the host lost. It counts like a refund of that
   * amount: a guest who wins back EUR 100 of a EUR 555 stay did not undo the
   * whole booking, and the commission on the rest was earned.
   */
  lostDisputeAmount?: number;
  /** The room-price split of the refunds that name one (`roomPriceOfRefunds`). */
  roomPrice?: RoomPriceRefunded | null;
}): number {
  const { chargeAmount, feeAmount, feeRefunded } = input;
  if (chargeAmount <= 0 || feeAmount <= 0) return 0;

  const split = input.roomPrice ?? null;
  // Without a split the whole charge is the base.
  const roomTotal = split ? Math.min(Math.max(split.roomTotal, 1), chargeAmount) : chargeAmount;
  const splitRefunded = split ? Math.min(Math.max(split.refunded, 0), chargeAmount) : 0;
  const roomRefunded = split ? Math.min(Math.max(split.roomRefunded, 0), roomTotal) : 0;
  // A dispute takes back only what was still on the charge: an outside refund
  // returns no commission, but it does shrink what a later dispute can claim.
  const stillCharged = chargeAmount - Math.min(Math.max(input.chargeRefunded, 0), chargeAmount);
  const disputed = Math.min(Math.max(input.lostDisputeAmount ?? 0, 0), stillCharged);
  // OpenBookings' unsplit refunds and the dispute, counted against the whole
  // charge. Together with the split refunds they can never exceed it.
  const unsplit = Math.min(Math.max(input.unsplitRefunded ?? 0, 0) + disputed, chargeAmount - splitRefunded);

  // fee × (roomRefunded / roomTotal + unsplit / chargeAmount), in integers:
  // the products pass 2^53 on a large stay, so BigInt.
  const C = BigInt(chargeAmount);
  const R = BigInt(roomTotal);
  const undone = BigInt(roomRefunded) * C + BigInt(unsplit) * R;
  const whole = R * C;
  const target = Number((BigInt(feeAmount) * (undone < whole ? undone : whole)) / whole);

  return Math.max(0, Math.min(target, feeAmount) - Math.max(feeRefunded, 0));
}

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
    const room = wholeCents(r.metadata?.[ROOM_PRICE_REFUNDED_KEY]);
    const total = wholeCents(r.metadata?.[ROOM_PRICE_TOTAL_KEY]);
    if (room === null || total === null || total <= 0) continue;
    named = true;
    split.roomTotal = Math.max(split.roomTotal, total);
    split.roomRefunded += Math.min(room, r.amount);
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
 * refunds say how much of each was room price (`roomPrice`). A refund that
 * does not say (one made in the host's Stripe Dashboard) and a lost dispute
 * can't be split, so they count in proportion to the whole charge.
 *
 * Stated as a target rather than a delta, which is what makes it safe to call
 * on every refund event: the commission returned so far is an input, so a
 * redelivered or repeated event computes zero. The final partial refund picks
 * up the rounding remainder, so the parts always sum to the fee exactly.
 * Rounded down, like Stripe's own proration.
 */
export function commissionRefundDue(input: {
  chargeAmount: number;
  /** Everything refunded on the charge so far, split or not. */
  chargeRefunded: number;
  feeAmount: number;
  feeRefunded: number;
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
  // Without a split the whole charge is the base, which is the old rule exactly.
  const roomTotal = split ? Math.min(Math.max(split.roomTotal, 1), chargeAmount) : chargeAmount;
  const refunded = Math.min(Math.max(input.chargeRefunded, 0), chargeAmount);
  const splitRefunded = split ? Math.min(Math.max(split.refunded, 0), refunded) : 0;
  const roomRefunded = split ? Math.min(Math.max(split.roomRefunded, 0), roomTotal) : 0;
  // A lost dispute does not show up in the charge's refunded amount, so it is
  // added here; together they can never exceed the charge.
  const unsplit = Math.min(
    refunded - splitRefunded + Math.max(input.lostDisputeAmount ?? 0, 0),
    chargeAmount - splitRefunded,
  );

  // fee × (roomRefunded / roomTotal + unsplit / chargeAmount), in integers:
  // the products pass 2^53 on a large stay, so BigInt.
  const C = BigInt(chargeAmount);
  const R = BigInt(roomTotal);
  const undone = BigInt(roomRefunded) * C + BigInt(unsplit) * R;
  const whole = R * C;
  const target = Number((BigInt(feeAmount) * (undone < whole ? undone : whole)) / whole);

  return Math.max(0, Math.min(target, feeAmount) - Math.max(feeRefunded, 0));
}

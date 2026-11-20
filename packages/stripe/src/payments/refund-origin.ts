import { ROOM_PRICE_REFUNDED_KEY, ROOM_PRICE_TOTAL_KEY } from './fees';

/**
 * Whether a refund on a host's charge was made by OpenBookings, read off the
 * metadata OpenBookings gives every refund it creates. A refund without any of
 * it was made somewhere else: by the host in their own Stripe Dashboard, or
 * through Stripe's API on the host's own keys.
 *
 * What each of OpenBookings' refunds carries:
 * - a refund of a booking (`buildRefundParams`, from the booking lifecycle):
 *   `refundId`, and the room-price keys when the booking has a room price;
 * - a payment that could not become a booking (oversold or duplicate, in the
 *   web app's checkout confirmation): `intentId`;
 * - a payment the commission ledger cannot explain
 *   (`buildReturnUnexplainedRequest`): `reason: 'unexplained'`.
 */
export function madeByOpenBookings(metadata: Record<string, string> | null | undefined): boolean {
  if (!metadata) return false;
  return (
    metadata[ROOM_PRICE_REFUNDED_KEY] !== undefined ||
    metadata[ROOM_PRICE_TOTAL_KEY] !== undefined ||
    !!metadata.refundId ||
    !!metadata.intentId ||
    metadata.reason === 'unexplained'
  );
}

import type Stripe from 'stripe';
import { stripe } from '../client';
import { refundCommissionForCharge } from './commission-refund';
import { ROOM_PRICE_REFUNDED_KEY, ROOM_PRICE_TOTAL_KEY } from './fees';

/**
 * How much of a refund is room price, and the room price on the whole
 * booking. The rest of the refund is tourist tax. OpenBookings' commission
 * goes back in proportion to the room price refunded only (B.5.7).
 */
export type RefundRoomPrice = { refundCents: number; totalCents: number };

/**
 * A refund OpenBookings makes on the host's behalf (Annex B B.5.8): created on
 * the host's connected account, from the host's balance, because the booking
 * was a direct charge there.
 *
 * `refund_application_fee` stays off: Stripe would hand the commission back in
 * proportion to the whole charge, tourist tax included, so a refund of the tax
 * alone would return commission on a stay that happened. Instead the refund
 * names its room-price part in its metadata, and `refundPayment` returns that
 * share of the commission itself (`refundCommissionForCharge`).
 */
export function buildRefundParams(i: {
  paymentIntentId: string;
  amountCents: number;
  metadata: Record<string, string>;
  roomPrice?: RefundRoomPrice;
}): Stripe.RefundCreateParams {
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) {
    throw new Error(`A refund must be a whole, positive number of cents (got ${i.amountCents})`);
  }
  const room = i.roomPrice;
  if (room) {
    const ok = (n: number) => Number.isInteger(n) && n >= 0;
    if (!ok(room.refundCents) || !ok(room.totalCents) || room.refundCents > i.amountCents) {
      throw new Error(`A refund's room price must be whole cents within the refund (got ${room.refundCents} of ${i.amountCents})`);
    }
  }
  return {
    payment_intent: i.paymentIntentId,
    amount: i.amountCents,
    refund_application_fee: false,
    metadata: room
      ? { ...i.metadata, [ROOM_PRICE_REFUNDED_KEY]: String(room.refundCents), [ROOM_PRICE_TOTAL_KEY]: String(room.totalCents) }
      : i.metadata,
  };
}

export type RefundPaymentInput = {
  paymentIntentId: string;
  stripeAccountId: string;
  amountCents: number;
  /** Same key, same refund: a retry after a timeout never pays out twice. */
  idempotencyKey: string;
  metadata: Record<string, string>;
  /**
   * The room-price part of the refund. Without it (a payment that never
   * became a booking) the refund counts against the whole charge, which for
   * a full refund returns the whole commission.
   */
  roomPrice?: RefundRoomPrice;
};

/**
 * Refunds the guest, then hands back OpenBookings' share of the commission.
 *
 * The commission step never fails the refund: the guest's money has moved,
 * and the `charge.refunded` webhook runs the same step as a backstop, from
 * the same metadata, so a commission refund missed here is made there.
 */
export async function refundPayment(
  i: RefundPaymentInput,
  returnCommission: (chargeId: string, stripeAccountId: string) => Promise<unknown> = refundCommissionForCharge,
): Promise<{ id: string; status: string }> {
  const refund = await stripe.refunds.create(buildRefundParams(i), {
    stripeAccount: i.stripeAccountId,
    idempotencyKey: i.idempotencyKey,
  });
  const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
  if (chargeId) {
    await returnCommission(chargeId, i.stripeAccountId).catch((error: unknown) => {
      console.error(
        `[refunds] commission for refund ${refund.id} not returned yet; the charge.refunded webhook will:`,
        error instanceof Error ? error.message : error,
      );
    });
  }
  return { id: refund.id, status: refund.status ?? 'pending' };
}

/**
 * The refund for a payment the commission ledger cannot explain (spec
 * decision 8): the whole charge back to the guest, on the host's account, with
 * OpenBookings' application fee handed back too. No amount is named, so
 * whatever is left of the charge goes back. Unlike `buildRefundParams` this
 * keeps `refund_application_fee`: the payment is no booking, so it has no
 * room price to split from tourist tax, and the whole fee goes back with the
 * whole charge (any remainder is picked up by the `charge.refunded` backstop). The idempotency key is the charge,
 * so a retry within Stripe's key window (about a day) never pays out twice;
 * after that the ledger only calls this while the charge is not fully refunded.
 */
export function buildReturnUnexplainedRequest(
  chargeId: string,
  stripeAccountId: string,
): { params: Stripe.RefundCreateParams; options: { stripeAccount: string; idempotencyKey: string } } {
  return {
    params: {
      charge: chargeId,
      refund_application_fee: true,
      metadata: { reason: 'unexplained', chargeId },
    },
    options: { stripeAccount: stripeAccountId, idempotencyKey: `return-unexplained:${chargeId}` },
  };
}

/** Refunds an unexplained payment in full (see `buildReturnUnexplainedRequest`). */
export async function returnUnexplainedPayment(
  chargeId: string,
  stripeAccountId: string,
  _reason: 'unexplained',
): Promise<{ refundId: string }> {
  const { params, options } = buildReturnUnexplainedRequest(chargeId, stripeAccountId);
  const refund = await stripe.refunds.create(params, options);
  return { refundId: refund.id };
}

/**
 * Stripe errors that mean the refund was refused, so no money moved. Anything
 * else (a dropped connection, a timeout, a Stripe-side 5xx, a rate limit)
 * might have gone through, and must be checked before it is sent again.
 *
 * An idempotency conflict is never a refusal: it means another request with
 * the same key is still being processed (409 `idempotency_key_in_use`), and
 * that one may well pay. The row stays uncertain, so it is looked up before it
 * is ever sent under a fresh key.
 */
const DEFINITE = new Set([
  'StripeInvalidRequestError',
  'StripeCardError',
  'StripePermissionError',
  'StripeAuthenticationError',
]);

function isIdempotencyConflict(error: unknown): boolean {
  const e = error as { type?: unknown; code?: unknown; raw?: { code?: unknown } | null } | null;
  return (
    e?.type === 'StripeIdempotencyError' ||
    e?.code === 'idempotency_key_in_use' ||
    e?.raw?.code === 'idempotency_key_in_use'
  );
}

export function isDefiniteRefundFailure(error: unknown): boolean {
  if (isIdempotencyConflict(error)) return false;
  const type = (error as { type?: unknown } | null)?.type;
  return typeof type === 'string' && DEFINITE.has(type);
}

type ListedRefund = { id: string; status: string | null; metadata?: Record<string, string> | null };

/** A live refund carrying every value in `metadata`, if any. Failed and canceled refunds moved no money. */
export function matchRefundByMetadata(refunds: ListedRefund[], metadata: Record<string, string>): { id: string } | null {
  const found = refunds.find(
    (r) =>
      r.status !== 'failed' &&
      r.status !== 'canceled' &&
      Object.entries(metadata).every(([key, value]) => r.metadata?.[key] === value),
  );
  return found ? { id: found.id } : null;
}

/** The live refund made for our refund row `refundId`, if any. */
export function matchRefund(refunds: ListedRefund[], refundId: string): { id: string } | null {
  return matchRefundByMetadata(refunds, { refundId });
}

/**
 * A refund already made on the host's account for this payment, recognised by
 * the metadata we gave it. Run before refunding again, because Stripe forgets
 * idempotency keys after about a day: a retry the next day would otherwise
 * pay out twice, or be refused for good once the charge is fully refunded.
 */
export async function findRefundByMetadata(i: {
  paymentIntentId: string;
  stripeAccountId: string;
  metadata: Record<string, string>;
}): Promise<{ id: string } | null> {
  const list = await stripe.refunds.list(
    { payment_intent: i.paymentIntentId, limit: 100 },
    { stripeAccount: i.stripeAccountId },
  );
  return matchRefundByMetadata(list.data, i.metadata);
}

/** The live refund made for our refund row, if any (see `findRefundByMetadata`). */
export function findRefundForRow(i: {
  paymentIntentId: string;
  stripeAccountId: string;
  refundRowId: string;
}): Promise<{ id: string } | null> {
  return findRefundByMetadata({
    paymentIntentId: i.paymentIntentId,
    stripeAccountId: i.stripeAccountId,
    metadata: { refundId: i.refundRowId },
  });
}

import type { BookingIntent } from '@openbookings/db';
import { hotelSearchHref } from './hotel-search-href';

/**
 * What the guest is told after Stripe sends them back.
 *
 * The intent first: only an intent the webhook turned into a booking is
 * "confirmed", because the rooms can still turn out to be gone after Stripe
 * took the money. Until the webhook decides, Stripe's view of the session
 * answers, and a payment Stripe holds is "being confirmed", never confirmed.
 *
 * The other distinction that matters is between *knowing* a payment failed and
 * merely being unable to confirm it. Only `failed` — a session Stripe still
 * reports as open — has earned the right to say nothing was charged and offer
 * a retry. Every other uncertain path lands on `unverified`, because inviting
 * someone to pay again for a booking that may already be paid is the worst
 * thing this page can do.
 */
export type OutcomeKind =
  | 'paid'
  | 'confirming'
  | 'processing'
  | 'failed'
  | 'expired'
  | 'oversold'
  | 'unverified'
  | 'unknown';

export type ReturnOutcome = {
  kind: OutcomeKind;
  tone: string;
  title: string;
  body: string;
  /** `reload`: request this same page again in full, to re-check. */
  action: { href: string; label: string; reload?: boolean };
};

export type ReturnIntent = Pick<BookingIntent, 'status' | 'bookingId' | 'propertySlug' | 'checkIn' | 'checkOut'> & {
  rooms: { adults: number; children: number }[];
};

/** Stripe's view of the session, or Stripe positively saying there is none. */
export type SessionView =
  | { kind: 'found'; status: string | null; paymentStatus: string; declineReason: string | null }
  | { kind: 'missing' };

const DONE = { href: '/', label: 'Done' };
const tryAgain = (href: string) => ({ href, label: 'Try again' });

/** No intent of this guest's to read: there is no hotel to go back to. */
export const UNKNOWN: ReturnOutcome = {
  kind: 'unknown',
  tone: 'text-muted-foreground',
  title: 'Nothing to show here',
  body: "This page needs a payment reference and there isn't one, so there's nothing to confirm. If you were part-way through booking, start again.",
  action: tryAgain('/'),
};

export const UNVERIFIED: ReturnOutcome = {
  kind: 'unverified',
  tone: 'text-amber-600',
  title: "We couldn't confirm this payment",
  body: "We couldn't reach our payment provider to check on your booking. Please don't pay again — we'll email you as soon as we know, and you can contact us if nothing arrives.",
  action: DONE,
};

const OVERSOLD_BODY = "Another booking took them just as your payment went through, so we couldn't confirm yours.";

/** The webhook's answer, or null while it has not given one. */
export function settledOutcome(intent: ReturnIntent): ReturnOutcome | null {
  if (intent.status === 'paid' && intent.bookingId) {
    return {
      kind: 'paid',
      tone: 'text-foreground',
      title: 'Booking confirmed',
      body: 'Your payment went through. A confirmation email with your check-in details is on its way.',
      action: { href: `/bookings/${intent.bookingId}`, label: 'View booking' },
    };
  }
  if (intent.status === 'oversold' || intent.status === 'refunded_oversold') {
    // `oversold` is the moment between the payment and its refund.
    const refund = intent.status === 'oversold' ? 'is being refunded' : 'was refunded';
    return {
      kind: 'oversold',
      tone: 'text-amber-600',
      title: 'Those rooms were just taken',
      body: `${OVERSOLD_BODY} Your payment ${refund} in full — there's nothing you need to do.`,
      action: { href: hotelSearchHref(intent), label: 'Back to the property' },
    };
  }
  return null;
}

/**
 * Stripe's answer for an intent the webhook has not settled. A retry goes
 * back to the hotel for the same stay; `returnHref` is this page, for a
 * re-check once the webhook has caught up.
 */
export function sessionOutcome(intent: ReturnIntent, session: SessionView, returnHref: string): ReturnOutcome {
  const retry = tryAgain(hotelSearchHref(intent));

  // Stripe positively confirming there is no such session: the id is wrong,
  // and there is no payment of the guest's hanging in the balance.
  if (session.kind === 'missing') return { ...UNKNOWN, action: retry };

  if (session.paymentStatus === 'paid' || session.paymentStatus === 'no_payment_required') {
    return {
      kind: 'confirming',
      tone: 'text-muted-foreground',
      title: "Payment received — we're confirming your booking",
      body: "Your payment went through and we're finishing your booking now. This usually takes a few seconds — refresh to see it. Please don't pay again.",
      action: { href: returnHref, label: 'Refresh', reload: true },
    };
  }

  // Completed but not yet paid: an async method such as iDEAL or a bank debit
  // is still clearing.
  if (session.status === 'complete') {
    return {
      kind: 'processing',
      tone: 'text-muted-foreground',
      title: 'Payment processing',
      body: "Your bank is still confirming this payment. We'll email you as soon as it clears — no need to pay again.",
      action: DONE,
    };
  }

  // The hold ran out before the guest confirmed. Distinct from a refusal:
  // there was never an attempt to charge.
  if (session.status === 'expired') {
    return {
      kind: 'expired',
      tone: 'text-muted-foreground',
      title: 'Your hold expired',
      body: 'This booking was only held for a short while and the hold has lapsed. Nothing was charged — start again to see whether the room is still free.',
      action: retry,
    };
  }

  // Still open — the guest came back without completing. This is the one case
  // where we know for certain no charge was made.
  if (session.status === 'open') {
    return {
      kind: 'failed',
      tone: 'text-destructive',
      title: 'Payment not completed',
      body: session.declineReason
        ? `${session.declineReason} You have not been charged.`
        : "The payment didn't go through and you haven't been charged. You can try again with another method.",
      action: retry,
    };
  }

  // A status Stripe has added since. Guessing would risk the double payment.
  return UNVERIFIED;
}

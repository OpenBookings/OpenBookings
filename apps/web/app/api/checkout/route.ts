import * as Sentry from '@sentry/nextjs';
import { stripe } from '@openbookings/stripe';
import {
  BookingNotFoundError,
  getBookingSummary,
  totalCents,
  type BookingSummary,
} from '@/app/checkout/_lib/booking';
import {
  checkoutErrorCopy,
  classifyStripeError,
  type CheckoutErrorCode,
} from '@/app/checkout/_lib/errors';

/**
 * Creates the Checkout Session backing the embedded checkout page.
 *
 * `ui_mode: 'elements'` returns a client secret instead of a hosted URL: the
 * page mounts Stripe's Payment Element against it and confirms client-side,
 * so we keep our own layout and our own pay button.
 *
 * Every priced row of the booking goes across as its own line item. The page
 * renders the breakdown back out of the session rather than from local data,
 * so the guest cannot be shown a split that differs from what is charged.
 */

/** Stripe rejects sessions expiring sooner than this or later than 24 hours. */
const MIN_HOLD_MS = 30 * 60 * 1000;
const MAX_HOLD_MS = 24 * 60 * 60 * 1000;
/**
 * Shaves the round trip off both ends. Without it a 30-minute hold computed
 * here can reach Stripe at 29:59 and be rejected outright, which is a failure
 * that only shows up under latency.
 */
const HOLD_MARGIN_MS = 60 * 1000;

/**
 * Smallest chargeable amount per currency, in minor units. Stripe rejects
 * anything below it, so we catch it here where we can say something useful
 * instead of surfacing "Amount must be at least €0.50".
 */
const MINIMUM_CHARGE: Record<string, number> = {
  eur: 50,
  gbp: 30,
  usd: 50,
  chf: 50,
  sek: 300,
  dkk: 250,
  nok: 300,
};

class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/**
 * Rejects bookings Stripe would reject, before we ask it to.
 *
 * Everything here is a bug on our side rather than anything the guest did, so
 * each case throws with the detail we want in Sentry and a code that maps to
 * copy telling the guest not to keep retrying.
 */
function assertChargeable(summary: BookingSummary): number {
  if (summary.lines.length === 0) {
    throw new CheckoutError('booking_invalid', 'Booking has no priced lines');
  }

  for (const line of summary.lines) {
    if (!Number.isInteger(line.unitAmountCents) || line.unitAmountCents < 0) {
      throw new CheckoutError(
        'booking_invalid',
        `Line "${line.name}" has a non-integer or negative unit amount: ${line.unitAmountCents}`
      );
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new CheckoutError(
        'booking_invalid',
        `Line "${line.name}" has an invalid quantity: ${line.quantity}`
      );
    }
  }

  const total = totalCents(summary.lines);
  const minimum = MINIMUM_CHARGE[summary.currency.toLowerCase()] ?? 50;
  if (total < minimum) {
    throw new CheckoutError(
      'booking_invalid',
      `Total ${total} is below the ${summary.currency} minimum of ${minimum}`
    );
  }

  // Only meaningful on a Connect booking: without a destination there is no
  // fee to take, and Stripe rejects a fee that swallows the whole payment.
  if (summary.stripeAccountId) {
    if (!Number.isInteger(summary.platformFeeCents) || summary.platformFeeCents < 0) {
      throw new CheckoutError(
        'booking_invalid',
        `Platform fee is not a non-negative integer: ${summary.platformFeeCents}`
      );
    }
    if (summary.platformFeeCents >= total) {
      throw new CheckoutError(
        'booking_invalid',
        `Platform fee ${summary.platformFeeCents} is not below the total ${total}`
      );
    }
  }

  return total;
}

/**
 * Where Stripe sends the guest back to.
 *
 * The localhost fallback is a development convenience and nothing more —
 * shipping it would redirect real guests to a machine that isn't theirs, so
 * outside development a missing URL is a configuration failure.
 */
function resolveAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  if (process.env.NODE_ENV === 'production') {
    throw new CheckoutError('config_error', 'NEXT_PUBLIC_APP_URL is not set');
  }
  return 'http://localhost:3002';
}

/** Clamped into Stripe's accepted window so a bad `holdMinutes` can't 400. */
function resolveExpiry(holdMinutes: number): number {
  const requested = Number.isFinite(holdMinutes) ? holdMinutes * 60 * 1000 : 0;
  const clamped = Math.min(
    Math.max(requested, MIN_HOLD_MS + HOLD_MARGIN_MS),
    MAX_HOLD_MS - HOLD_MARGIN_MS
  );
  return Math.floor((Date.now() + clamped) / 1000);
}

function failure(code: CheckoutErrorCode, status: number): Response {
  return Response.json(
    { error: { code, message: checkoutErrorCopy(code).message } },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST() {
  // Declared outside the try only so the catch can name the booking in Sentry;
  // the read itself is inside it, because a booking that cannot be loaded is a
  // checkout failure like any other rather than an unhandled 500.
  let summary: BookingSummary | null = null;

  let session;
  try {
    // Bound to a const as well: the line-item map below is a closure, and TS
    // will not keep a narrowing on the outer `let` across one.
    const booking = (summary = await getBookingSummary());
    const total = assertChargeable(booking);
    const appUrl = resolveAppUrl();
    const expiresAt = resolveExpiry(booking.holdMinutes);

    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'elements',
      line_items: booking.lines.map((line) => ({
        price_data: {
          currency: booking.currency,
          unit_amount: line.unitAmountCents,
          product_data: {
            name: line.name,
            description: `${booking.propertyName} — ${booking.roomName}`,
          },
        },
        quantity: line.quantity,
      })),
      // Makes the Session require a phone number, which hosts need to reach the
      // guest about arrival. It does NOT render a field: the Contact Details
      // Element collects email only, so the number is collected by our own
      // input and pushed with `updatePhoneNumber`. See PhoneField.
      phone_number_collection: { enabled: true },
      payment_intent_data: booking.stripeAccountId
        ? {
            transfer_data: { destination: booking.stripeAccountId },
            // Platform fee temporarily disabled — restore with
            // `application_fee_amount: booking.platformFeeCents` when needed.
          }
        : {},
      metadata: {
        bookingIntentId: booking.intentId,
        roomId: booking.roomId,
        // Guest name, email and phone arrive via `customer_details`, filled in
        // by the Contact Details and Billing Address Elements.
        totalCents: String(total),
      },
      return_url: `${appUrl}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      expires_at: expiresAt,
    });

    // Typed as nullable, and a session without one is unusable client-side.
    // Better to fail here than to hand the browser `null` and watch Stripe.js
    // fail with something less traceable.
    if (!session.client_secret) {
      throw new CheckoutError('session_failed', `Session ${session.id} has no client_secret`);
    }
  } catch (err) {
    const code =
      err instanceof CheckoutError
        ? err.code
        : err instanceof BookingNotFoundError
          ? 'booking_invalid'
          : classifyStripeError(err);

    // The full error only ever goes here. `config_error` and `booking_invalid`
    // both mean the deployment is broken rather than the guest, so they are
    // worth a louder level than a transient Stripe blip.
    Sentry.captureException(err, {
      level: code === 'config_error' || code === 'booking_invalid' ? 'fatal' : 'error',
      tags: { area: 'checkout', checkoutErrorCode: code },
      extra: { intentId: summary?.intentId, roomId: summary?.roomId },
    });
    console.error('[checkout]', code, err instanceof Error ? err.message : String(err));

    return failure(code, code === 'rate_limited' ? 503 : 500);
  }

  return Response.json(
    {
      clientSecret: session.client_secret,
      // Drives the client-side hold countdown, so a guest who leaves the tab
      // open is told the hold lapsed instead of being declined by Stripe.
      expiresAt: session.expires_at,
    },
    // A cached client secret would hand a second guest someone else's session.
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

import * as Sentry from '@sentry/nextjs';
import { headers } from 'next/headers';
import { createBookingCheckout } from '@openbookings/stripe';
import { auth } from '@/lib/auth';
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
import { verifyTurnstileToken } from '@/app/checkout/_lib/turnstile';
import { getClientIP } from '@/lib/rateLimit';

/**
 * Creates the Checkout Session backing the embedded checkout page.
 *
 * `ui_mode: 'form'` returns a client secret instead of a hosted URL: the page
 * mounts Stripe's embedded form against it and confirms client-side, so the
 * page keeps its own surrounding layout while Stripe owns the fields, the
 * validation and the pay button.
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
    message: string,
    /** Overrides the Sentry level the code would otherwise get. */
    readonly level?: 'warning'
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
  // The total is shown as "incl. tax". That is only true once the property's
  // organisation has confirmed its rates include tax; until then the price
  // cannot honestly be sold. Not retryable by the guest, hence config_error.
  if (!summary.ratesConfirmed) {
    throw new CheckoutError(
      'config_error',
      'Property organisation has not confirmed tax-inclusive rates',
      // An expected state on release day, not a broken deployment.
      'warning'
    );
  }

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
  const configured = process.env.NEXT_PUBLIC_WEB_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  if (process.env.NODE_ENV === 'production') {
    throw new CheckoutError('config_error', 'NEXT_PUBLIC_WEB_URL is not set');
  }
  return 'http://localhost:3002';
}

/**
 * An explicit payment method configuration for checkout, if one is set.
 *
 * Bookings are direct charges on the host's connected account, so it is the
 * connected-account configuration that decides what the guest is offered: the
 * platform's "your connected accounts" preset, as each host's account inherits
 * it. A `pmc_` id set here must be one that exists on the connected account.
 *
 * Left unset, Stripe uses the connected account's default configuration,
 * which is the normal case. Test and live mode hold different `pmc_` objects,
 * hence an environment variable rather than a constant.
 */
function resolvePaymentMethodConfiguration(): string | undefined {
  return process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION?.trim() || undefined;
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

export async function POST(request: Request) {
  // Two gates, both before anything else happens: creating a Checkout Session
  // is a write against Stripe's API, so a caller who is neither signed in nor
  // verified must not reach the handler at all.
  //
  // Auth first, and it is deliberately checked here rather than trusted from
  // the page. The gate in the browser is what the guest experiences, but it is
  // UI — the session cookie read on this side is the only thing that actually
  // decides. A request forged straight at this route skips the gate entirely
  // and still has to get past this line.
  const authSession = await auth.api
    .getSession({ headers: await headers() })
    .catch(() => null);
  if (!authSession?.user?.email) {
    return failure('auth_required', 401);
  }

  const payload = (await request.json().catch(() => null)) as {
    'cf-turnstile-response'?: unknown;
  } | null;

  const verified = await verifyTurnstileToken(
    payload?.['cf-turnstile-response'],
    getClientIP(request)
  );
  if (!verified) {
    return failure('verification_failed', 403);
  }

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
    const paymentMethodConfiguration = resolvePaymentMethodConfiguration();
    const expiresAt = resolveExpiry(booking.holdMinutes);

    // A direct charge: created on the host's own Stripe account, with
    // OpenBookings' commission as an application fee. Without an account
    // there is nowhere to charge, and the platform's own account is never a
    // substitute.
    if (!booking.stripeAccountId) {
      throw new CheckoutError('config_error', 'Property has no connected Stripe account');
    }

    session = await createBookingCheckout({
      stripeAccountId: booking.stripeAccountId,
      // Prefilled and locked: the booking is attached to this account, so the
      // confirmation must not go somewhere the account holder cannot see.
      customerEmail: authSession.user.email,
      currency: booking.currency,
      // Every priced row goes across as its own line item; the page renders
      // the breakdown back out of the session, so the guest cannot be shown a
      // split that differs from what is charged.
      lines: booking.lines.map((line) => ({
        name: line.name,
        description: `${booking.propertyName} — ${booking.roomName}`,
        unitAmountCents: line.unitAmountCents,
        quantity: line.quantity,
      })),
      applicationFeeCents: booking.platformFeeCents,
      paymentMethodConfiguration,
      metadata: {
        bookingIntentId: booking.intentId,
        roomId: booking.roomId,
        // Who the booking belongs to. `customer_details` still carries what
        // the guest types into the form; this is the account the webhook
        // should attach the booking to.
        //
        // TODO: once booking intents are real rows, the intent should carry
        // this and the webhook should read it from there.
        userId: authSession.user.id,
        totalCents: String(total),
      },
      returnUrl: `${appUrl}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      expiresAt,
    });

    // Typed as nullable, and a session without one is unusable client-side.
    // Better to fail here than to hand the browser `null` and watch Stripe.js
    // fail with something less traceable.
    if (!session.clientSecret) {
      throw new CheckoutError('session_failed', `Session ${session.id} has no client secret`);
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
      level:
        err instanceof CheckoutError && err.level
          ? err.level
          : code === 'config_error' || code === 'booking_invalid'
            ? 'fatal'
            : 'error',
      tags: { area: 'checkout', checkoutErrorCode: code },
      extra: { intentId: summary?.intentId, roomId: summary?.roomId },
    });
    console.error('[checkout]', code, err instanceof Error ? err.message : String(err));

    return failure(code, code === 'rate_limited' ? 503 : 500);
  }

  return Response.json(
    {
      clientSecret: session.clientSecret,
      // Drives the client-side hold countdown, so a guest who leaves the tab
      // open is told the hold lapsed instead of being declined by Stripe.
      expiresAt: session.expiresAt,
    },
    // A cached client secret would hand a second guest someone else's session.
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

import * as Sentry from '@sentry/nextjs';
import { getPool, withTransaction } from '@openbookings/db';
import { createBookingCheckout, expireBookingCheckout, retrieveBookingCheckout } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import {
  BookingNotFoundError,
  getBookingSummary,
  totalCents,
  type BookingSummary,
} from '@/app/checkout/_lib/booking';
import { stayCents, toCents } from '@/app/checkout/_lib/booking-lines';
import { openIntentSession, refusalFor } from '@/app/checkout/_lib/intent-session';
import {
  checkoutErrorCopy,
  classifyStripeError,
  type CheckoutErrorCode,
} from '@/app/checkout/_lib/errors';
import { verifyTurnstileToken } from '@/app/checkout/_lib/turnstile';
import { propertyBookable } from '@/lib/booking/readiness-gate';
import { ensureCheckoutDomain } from '@/lib/payments/checkout-domain';
import { getClientIP } from '@/lib/rateLimit';

/**
 * The Checkout Session backing the embedded checkout page, for one of the
 * guest's own booking intents.
 *
 * POST /api/checkout { intentId, 'cf-turnstile-response' }
 * → 200 { clientSecret, expiresAt }
 * → 409 { error: { code: 'hold_expired' | 'already_paid' | 'oversold' } } when the intent can no longer be paid
 *
 * An intent has at most one payable session: one Stripe still has open is
 * handed back rather than a second made beside it.
 *
 * `ui_mode: 'elements'` returns a client secret instead of a hosted URL: the
 * page mounts Stripe's wallet buttons and payment box against it and confirms
 * client-side. The guest's name, phone and address come from the page's own
 * details card (saved to their account first) and go to Stripe on confirm.
 *
 * Every priced row of the booking goes across as its own line item. The page
 * renders the breakdown back out of the session rather than from local data,
 * so the guest cannot be shown a split that differs from what is charged.
 */

/**
 * Stripe rejects sessions expiring sooner than this. The rooms are held for
 * less (HOLD_MINUTES); the page's countdown, not the session, ends the hold,
 * and a payment that lands after it is re-checked when it is confirmed.
 */
const MIN_HOLD_MS = 30 * 60 * 1000;
/**
 * Without it a 30-minute expiry computed here can reach Stripe at 29:59 and be
 * rejected outright, which is a failure that only shows up under latency.
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
  // The lines are rebuilt from the intent's rooms; the guest agreed to the
  // intent's total. Should the two ever part, nothing is charged at all.
  if (total !== toCents(summary.intentTotal)) {
    throw new CheckoutError(
      'booking_invalid',
      `Lines total ${total} differs from the intent total ${toCents(summary.intentTotal)}`
    );
  }

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

/** As soon as Stripe allows, in unix seconds. */
function resolveExpiry(): number {
  return Math.floor((Date.now() + MIN_HOLD_MS + HOLD_MARGIN_MS) / 1000);
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
  // getServerSession is sessionForApp over the raw read: a host-app cookie, or
  // a session row stamped for the other portal, must not be able to start a
  // guest checkout.
  const authSession = await getServerSession().catch(() => null);
  if (!authSession?.user?.email || !authSession.user.id) {
    return failure('auth_required', 401);
  }
  const user = { id: authSession.user.id, email: authSession.user.email };

  const payload = (await request.json().catch(() => null)) as {
    intentId?: unknown;
    'cf-turnstile-response'?: unknown;
  } | null;

  const verified = await verifyTurnstileToken(
    payload?.['cf-turnstile-response'],
    getClientIP(request)
  );
  if (!verified) {
    return failure('verification_failed', 403);
  }

  const intentId = typeof payload?.intentId === 'string' ? payload.intentId : '';

  // Declared outside the try only so the catch can name the intent in Sentry;
  // the read itself is inside it, because an intent that cannot be loaded is a
  // checkout failure like any other rather than an unhandled 500.
  let summary: BookingSummary | null = null;

  let session;
  try {
    // Bound to a const as well: the line-item map below is a closure, and TS
    // will not keep a narrowing on the outer `let` across one.
    const booking = (summary = await getBookingSummary({ intentId, userId: user.id }));

    // Checked again under a lock in `openIntentSession`; this early answer
    // spares Stripe a request for an intent that is plainly over.
    // A paid or oversold intent was charged, so it is never answered as a
    // lapsed hold ("nothing has been charged").
    if (booking.status !== 'open') return failure(refusalFor(booking.status), 409);
    if (booking.holdExpiresAt.getTime() <= Date.now()) return failure('hold_expired', 409);

    // A second line of defence behind the hold: the property may have lost
    // its readiness since the guest held the rooms. Not retryable by the guest.
    if (!(await propertyBookable(getPool(), booking.propertyId))) {
      throw new CheckoutError('config_error', 'Property is not ready to take bookings', 'warning');
    }

    const total = assertChargeable(booking);
    const appUrl = resolveAppUrl();
    const paymentMethodConfiguration = resolvePaymentMethodConfiguration();

    // A direct charge: created on the host's own Stripe account, with
    // OpenBookings' commission as an application fee. Without an account
    // there is nowhere to charge, and the platform's own account is never a
    // substitute.
    if (!booking.stripeAccountId) {
      throw new CheckoutError('config_error', 'Property has no connected Stripe account');
    }
    const stripeAccountId = booking.stripeAccountId;

    // Beside the Session, never instead of it: the hotel's account needs our
    // domain registered before Apple Pay can show, and that check never fails
    // the booking (it reports and gives up after a short deadline).
    const [opened] = await Promise.all([
      openIntentSession(
        {
          transaction: (fn) => withTransaction((client) => fn(client)),
          retrieve: async (sessionId, accountId) => {
            const existing = await retrieveBookingCheckout(sessionId, accountId);
            return { status: existing.status, clientSecret: existing.client_secret, expiresAt: existing.expires_at };
          },
          create: () =>
            createBookingCheckout({
              stripeAccountId,
              // Prefilled and locked: the booking is attached to this account, so
              // the confirmation must not go somewhere the account holder cannot see.
              customerEmail: user.email,
              currency: booking.currency,
              // Every priced row goes across as its own line item; the page
              // renders the breakdown back out of the session, so the guest
              // cannot be shown a split that differs from what is charged.
              lines: booking.lines.map((line) => ({
                name: line.name,
                description: booking.propertyName,
                unitAmountCents: line.unitAmountCents,
                quantity: line.quantity,
              })),
              applicationFeeCents: booking.platformFeeCents,
              paymentMethodConfiguration,
              // The intent carries the guest, the rooms and the prices; the
              // webhook finds it through `bookingIntentId`.
              metadata: {
                bookingIntentId: booking.intentId,
                totalCents: String(total),
                touristTaxCents: String(total - stayCents(booking.lines)),
              },
              returnUrl: `${appUrl}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
              expiresAt: resolveExpiry(),
            }),
          expire: expireBookingCheckout,
          // An orphaned session that could not be expired: logged, not the
          // guest's problem. It lapses on its own, and a payment on an intent
          // that is not open is caught when it is confirmed.
          report: (err, { sessionId }) => {
            Sentry.captureException(err, { tags: { area: 'checkout' }, extra: { intentId: booking.intentId, sessionId } });
            console.error('[checkout] expire orphaned session', sessionId, err instanceof Error ? err.message : String(err));
          },
        },
        { intentId: booking.intentId, userId: user.id, accountId: stripeAccountId, now: new Date() }
      ),
      ensureCheckoutDomain(stripeAccountId, appUrl),
    ]);
    if (!opened.ok) {
      if (opened.code === 'not_found') throw new BookingNotFoundError(booking.intentId, 'gone while opening its session');
      return failure(opened.code, 409);
    }
    session = opened.session;

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
    // worth a louder level than a transient Stripe blip. A link to an intent
    // that is not the guest's is neither: it is answered as not found.
    Sentry.captureException(err, {
      level:
        err instanceof CheckoutError && err.level
          ? err.level
          : err instanceof BookingNotFoundError
            ? 'warning'
            : code === 'config_error' || code === 'booking_invalid'
              ? 'fatal'
              : 'error',
      tags: { area: 'checkout', checkoutErrorCode: code },
      extra: { intentId: summary?.intentId ?? intentId },
    });
    console.error('[checkout]', code, err instanceof Error ? err.message : String(err));

    return failure(
      code,
      err instanceof BookingNotFoundError ? 404 : code === 'rate_limited' ? 503 : 500
    );
  }

  return Response.json(
    {
      clientSecret: session.clientSecret,
      // When Stripe stops taking payment. The page's countdown runs to the
      // intent's own, earlier, hold instead.
      expiresAt: session.expiresAt,
    },
    // A cached client secret would hand a second guest someone else's session.
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

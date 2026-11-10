'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Sentry from '@sentry/nextjs';
import { loadStripe } from '@stripe/stripe-js';
import type { Appearance, Stripe } from '@stripe/stripe-js';
import { CheckoutElementsProvider } from '@stripe/react-stripe-js/checkout';
import { buildAppearance } from '../_lib/appearance';
import type { GuestDetailsPrefill } from '../_lib/guest-details';
import type { DialCode } from '@/app/account/personal-details/_components/fields';
import {
  CHECKOUT_ALREADY_PAID,
  CHECKOUT_EXPIRED,
  CHECKOUT_OVERSOLD,
  checkoutErrorCopy,
  STRIPE_JS_UNAVAILABLE,
  type CheckoutErrorCopy,
} from '../_lib/errors';
import { useHoldCountdown } from '../_lib/useHoldCountdown';
import { useTurnstileToken } from '../_lib/useTurnstileToken';
import { Backdrop } from './Backdrop';
import { CheckoutGate, type GateViewer } from './CheckoutGate';
import { CheckoutNotice } from './CheckoutNotice';
import { CHECKOUT_CARD, DetailsCard } from './DetailsCard';
import { PaymentCard } from './PaymentCard';
import { PaymentCardBoundary } from './PaymentCardBoundary';
import { TripSummary, type TripSummaryProps } from './TripSummary';
import { useCheckoutDetails } from './useCheckoutDetails';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

// Bookings are direct charges on the host's connected account, so Stripe.js
// has to be initialised for that account: the Session's client secret belongs
// to it and means nothing to the platform's own instance.
//
// Created once per account per page load, not per render. Without a key or an
// account there is nothing to load: `loadStripe('')` rejects asynchronously,
// which would surface as a blocked-script error rather than the configuration
// failure it really is.
const stripePromises = new Map<string, Promise<Stripe | null>>();

function stripeFor(stripeAccountId: string): Promise<Stripe | null> | null {
  if (!PUBLISHABLE_KEY || !stripeAccountId) return null;
  let promise = stripePromises.get(stripeAccountId);
  if (!promise) {
    promise = loadStripe(PUBLISHABLE_KEY, { stripeAccount: stripeAccountId });
    stripePromises.set(stripeAccountId, promise);
  }
  return promise;
}

/** Everything the summary renders, plus the photograph behind the whole page. */
export type CheckoutClientProps = TripSummaryProps & {
  heroImageUrl: string;
  /**
   * The signed-in guest, read on the server so the gate knows on first paint
   * whether sign-in is still owed. Null means nobody is signed in.
   */
  viewer: GateViewer | null;
  /** The host's connected account the booking is charged on. Empty = not chargeable. */
  stripeAccountId: string;
  /** The booking intent being paid for. */
  intentId: string;
  /** Unix milliseconds the intent stops holding its rooms. */
  holdExpiresAt: number;
  /**
   * `paid` and `oversold` were charged (oversold is refunded in full);
   * `expired` covers any other intent that can no longer be paid.
   */
  intentStatus: 'open' | 'expired' | 'paid' | 'oversold';
  /** The property page: where a lapsed hold starts again. */
  backHref: string;
  /** The guest's saved details, for the details card. */
  guestDetails: GuestDetailsPrefill;
  /** Built on the server; see lib/account/countries.ts. */
  countries: { code: string; name: string }[];
  dialCodes: DialCode[];
};

function Shell({ heroImageUrl, children }: { heroImageUrl: string; children: React.ReactNode }) {
  return (
    <>
      <Backdrop heroImageUrl={heroImageUrl} />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-16">
        {/*
          Summary first on narrow screens, matching the design's reading order;
          side by side from lg up.

          `items-start`, never `items-center`: the row is as tall as the payment
          card, so centring made the summary re-centre — and visibly jump —
          every time Stripe expanded an Element. Anchoring both columns to the
          top keeps the left half still while only the Stripe side resizes.
        */}
        {/*
          `[&>*]:min-w-0` guards the phone layout: a grid item defaults to
          `min-width: auto`, so a child with a wide min-content size — the
          Stripe Elements iframes are the candidate here — would size the whole
          column and push the page into horizontal overflow rather than
          scrolling inside its own card.
        */}
        <div className="grid items-start gap-10 [&>*]:min-w-0 lg:grid-cols-2 lg:gap-16">
          {children}
        </div>
      </main>
    </>
  );
}

/**
 * The whole checkout is unusable without a Stripe Session, so the failure
 * takes over the page rather than sitting beside a trip summary for a booking
 * that cannot be paid for.
 */
function NoticeShell({
  heroImageUrl,
  copy,
  onRetry,
  backHref,
}: {
  heroImageUrl: string;
  copy: CheckoutErrorCopy;
  onRetry?: () => void;
  backHref?: string;
}) {
  return (
    <>
      <Backdrop heroImageUrl={heroImageUrl} />
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6">
        <CheckoutNotice copy={copy} onRetry={onRetry} backHref={backHref} />
      </main>
    </>
  );
}

export function CheckoutClient(props: CheckoutClientProps) {
  // The appearance reads computed tokens and the client secret is fetched on
  // demand, so both wait for the browser rather than running during SSR.
  const isClient = useSyncExternalStore(
    NO_OP_SUBSCRIBE,
    () => true,
    () => false
  );
  const appearance = useMemo(() => (isClient ? buildAppearance() : null), [isClient]);

  if (!PUBLISHABLE_KEY) {
    return <NoticeShell heroImageUrl={props.heroImageUrl} copy={checkoutErrorCopy('config_error')} />;
  }

  // Already paid: the form must never come back for a second payment.
  if (props.intentStatus === 'paid') {
    return <NoticeShell heroImageUrl={props.heroImageUrl} copy={CHECKOUT_ALREADY_PAID} backHref={props.backHref} />;
  }
  // Charged, then refunded: neither "nothing has been charged" nor a way to pay again.
  if (props.intentStatus === 'oversold') {
    return <NoticeShell heroImageUrl={props.heroImageUrl} copy={CHECKOUT_OVERSOLD} backHref={props.backHref} />;
  }

  if (!appearance) {
    // Server render and the first client frame. The gate lives inside
    // `CheckoutSession`, which has not mounted yet, so this paints the
    // backdrop it will sit on — not a skeleton of a layout the gate is about
    // to cover anyway.
    return <Backdrop heroImageUrl={props.heroImageUrl} />;
  }

  return <CheckoutSession appearance={appearance} {...props} />;
}

const NO_OP_SUBSCRIBE = () => () => {};

/**
 * Checkout for a visitor who is not signed in. The intent is the guest's own,
 * so nothing of it can be shown yet: only the gate's sign-in step, which comes
 * back to this checkout. No Turnstile token is minted before sign-in, so its
 * slot stays empty.
 */
export function CheckoutSignIn({ intentId }: { intentId: string }) {
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  return (
    <CheckoutGate
      heroImageUrl=""
      visible
      viewer={null}
      verified={false}
      turnstileRef={turnstileRef}
      callbackURL={`/checkout/${intentId}`}
    />
  );
}

type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; clientSecret: string }
  | { status: 'error'; copy: CheckoutErrorCopy };

/** A failure already translated into guest-facing copy. */
class SessionFailure extends Error {
  constructor(readonly copy: CheckoutErrorCopy) {
    super(copy.message);
    this.name = 'SessionFailure';
  }
}

async function createSession(
  intentId: string,
  turnstileToken: string,
  signal: AbortSignal
): Promise<{ clientSecret: string }> {
  let response: Response;
  try {
    response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      // The route verifies this with Cloudflare before it touches Stripe. The
      // field name is Turnstile's own, so the server reads it exactly as the
      // canonical siteverify flow expects.
      body: JSON.stringify({ intentId, 'cf-turnstile-response': turnstileToken }),
      signal,
    });
  } catch (err) {
    // An abort is our own cleanup, not a failure to report.
    if (signal.aborted) throw err;
    throw new SessionFailure(checkoutErrorCopy('stripe_unreachable'));
  }

  // A crashed route, an edge proxy or a captive portal answers with HTML, and
  // `res.json()` on that throws a SyntaxError whose message ("Unexpected token
  // <") would otherwise be shown to the guest as if it explained something.
  const body = (await response.json().catch(() => null)) as {
    clientSecret?: unknown;
    error?: { code?: unknown };
  } | null;

  if (!response.ok) {
    throw new SessionFailure(checkoutErrorCopy(body?.error?.code));
  }

  if (typeof body?.clientSecret !== 'string' || body.clientSecret.length === 0) {
    // A 200 without a secret means the route changed shape under us.
    Sentry.captureException(new Error('Checkout session response had no clientSecret'), {
      tags: { area: 'checkout' },
    });
    throw new SessionFailure(checkoutErrorCopy('session_failed'));
  }

  return { clientSecret: body.clientSecret };
}

/**
 * Resolves Stripe.js, turning both of its failure modes — a rejected load and
 * a `null` instance — into one message that names the likely cause.
 */
async function loadStripeOrFail(stripeAccountId: string): Promise<Stripe> {
  let stripe: Stripe | null;
  try {
    stripe = await stripeFor(stripeAccountId);
  } catch {
    throw new SessionFailure(STRIPE_JS_UNAVAILABLE);
  }
  if (!stripe) throw new SessionFailure(STRIPE_JS_UNAVAILABLE);
  return stripe;
}

/** Mounted only in the browser, so the session is created exactly once. */
function CheckoutSession({
  appearance,
  ...props
}: CheckoutClientProps & { appearance: Omit<Appearance, 'rules'> }) {
  const [attempt, setAttempt] = useState(0);
  // A property with no connected Stripe account cannot be charged at all. Say
  // so straight away, with copy that does not invite a retry, instead of
  // loading nothing and blaming the guest's ad blocker.
  const chargeable = props.stripeAccountId !== '';
  const [state, setState] = useState<SessionState>(() =>
    chargeable ? { status: 'loading' } : { status: 'error', copy: checkoutErrorCopy('config_error') }
  );
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const details = useCheckoutDetails(props.guestDetails);
  // Non-refundable rates (Annex B B.4.3): nothing to do with paying is shown
  // until the guest has ticked that they understand.
  const [consented, setConsented] = useState(false);
  const holdLapsed = useHoldCountdown({
    intentId: props.intentId,
    holdExpiresAt: props.holdExpiresAt,
    open: props.intentStatus === 'open',
  });
  const {
    token: turnstileToken,
    failed: turnstileFailed,
    containerRef: turnstileRef,
    reset: resetTurnstile,
  } = useTurnstileToken({
    // Nothing to verify until we know who the guest is. A token lasts a few
    // minutes and is spent once, so minting one while the sign-in form is
    // still on screen just burns it — and a social sign-in reloads the page
    // and discards it anyway.
    enabled: props.viewer !== null,
  });

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    // The previous token was redeemed at siteverify and cannot be spent twice,
    // so the retry needs a fresh one. Resetting clears it and re-runs the
    // challenge; the effect below waits for the replacement.
    resetTurnstile();
    setAttempt((n) => n + 1);
  }, [resetTurnstile]);

  useEffect(() => {
    // No token yet — either the gate is still waiting on sign-in, or the
    // challenge is running. Neither is a failure; the effect re-runs as soon
    // as a token is issued.
    if (!turnstileToken || !chargeable || holdLapsed) return;

    // Aborting on cleanup keeps React's development double-mount from leaving
    // a second, orphaned Session holding the same room.
    const controller = new AbortController();
    let active = true;

    // Stripe.js and the Session are independent, so a slow script does not
    // delay the request that puts the room on hold.
    Promise.all([
      loadStripeOrFail(props.stripeAccountId),
      createSession(props.intentId, turnstileToken, controller.signal),
    ])
      .then(([loaded, session]) => {
        if (!active) return;
        setStripe(loaded);
        setState({ status: 'ready', ...session });
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted) return;
        if (err instanceof SessionFailure) {
          setState({ status: 'error', copy: err.copy });
          return;
        }
        Sentry.captureException(err, { tags: { area: 'checkout' } });
        setState({ status: 'error', copy: checkoutErrorCopy('session_failed') });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, turnstileToken, props.stripeAccountId, props.intentId, chargeable, holdLapsed]);

  // A blocked script or a failed challenge is terminal for this attempt: there
  // is no token to send, so the Session is never requested. Derived rather than
  // pushed into state from an effect — it is a fact about this render, and
  // mirroring it into `state` would only add a cascading re-render.
  //
  // A lapsed hold ends the attempt too, unless the form is already up: then
  // the payment card shows it in place, beside the summary.
  const resolved: SessionState =
    holdLapsed && state.status !== 'ready'
      ? { status: 'error', copy: CHECKOUT_EXPIRED }
      : turnstileFailed
        ? { status: 'error', copy: checkoutErrorCopy('verification_failed') }
        : state;

  // The gate is up for exactly as long as the Session is still being prepared.
  //
  // `loading` covers all three of its steps — waiting on sign-in, waiting on a
  // Turnstile token, waiting on Stripe — because none of them has produced a
  // client secret yet. It comes down on `ready`, and on `error` too: a failure
  // gets the notice, not a gate still claiming to be preparing something.
  //
  // The previous predicate keyed off the token instead, which was true on the
  // error path as well — so the challenge stayed on screen over the notice.
  const gateVisible = resolved.status === 'loading';

  // Rendered once, outside every branch below, and never conditionally.
  //
  // Two reasons, and both have bitten this file. `resetTurnstile()` acts on a
  // live widget, so unmounting the container on the error screen would leave
  // the retry button with nothing to reset. And the gate is `position: fixed`,
  // which keeps the widget out of the payment grid entirely — as a grid child
  // it consumed a cell even at `h-0`, which pushed the summary into the second
  // column and dropped the payment card onto a row of its own.
  const gate = (
    <CheckoutGate
      heroImageUrl={props.heroImageUrl}
      visible={gateVisible}
      viewer={props.viewer}
      verified={turnstileToken !== null}
      turnstileRef={turnstileRef}
      callbackURL={`/checkout/${props.intentId}`}
    />
  );

  if (resolved.status === 'error') {
    return (
      <>
        {gate}
        <NoticeShell heroImageUrl={props.heroImageUrl} copy={resolved.copy} onRetry={retry} backHref={props.backHref} />
      </>
    );
  }

  if (resolved.status === 'loading' || !stripe) {
    // No skeleton behind the gate: it covers the viewport, so a pair of
    // pulsing blocks underneath is work nobody can see.
    return (
      <>
        {gate}
        <Backdrop heroImageUrl={props.heroImageUrl} />
      </>
    );
  }

  return (
    <CheckoutElementsProvider
      // Keyed on the secret so a retry mounts a clean provider against the new
      // Session rather than reusing the one that failed.
      key={resolved.clientSecret}
      stripe={stripe}
      options={{ clientSecret: resolved.clientSecret, elementsOptions: { appearance } }}
    >
      {gate}
      <Shell heroImageUrl={props.heroImageUrl}>
        <TripSummary {...props} />
        {/*
          Reading order: the non-refundable check (when there is one), the
          guest's details, then payment. The details card stays usable before
          the tick; payment appears only after it.
        */}
        <div className="flex flex-col gap-4">
          {props.requiresNonRefundableConsent && (
            <label className={`${CHECKOUT_CARD} flex cursor-pointer items-start gap-3 text-sm`}>
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-neutral-900"
              />
              <span>
                <span className="font-medium">I understand this rate is non-refundable.</span>{' '}
                If I cancel or don&apos;t show up, I won&apos;t get the room price back.
              </span>
            </label>
          )}
          <DetailsCard controller={details} countries={props.countries} dialCodes={props.dialCodes} />
          {(!props.requiresNonRefundableConsent || consented) && (
            <PaymentCardBoundary onRestart={retry}>
              <PaymentCard
                holdLapsed={holdLapsed}
                onRestart={retry}
                backHref={props.backHref}
                details={details}
                propertyName={props.propertyName}
              />
            </PaymentCardBoundary>
          )}
        </div>
      </Shell>
    </CheckoutElementsProvider>
  );
}

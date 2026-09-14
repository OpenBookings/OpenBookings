'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Sentry from '@sentry/nextjs';
import { loadStripe } from '@stripe/stripe-js';
import type { Appearance, Stripe } from '@stripe/stripe-js';
import { CheckoutFormProvider } from '@stripe/react-stripe-js/checkout';
import { buildAppearance } from '../_lib/appearance';
import {
  checkoutErrorCopy,
  STRIPE_JS_UNAVAILABLE,
  type CheckoutErrorCopy,
} from '../_lib/errors';
import { useTurnstileToken } from '../_lib/useTurnstileToken';
import { Backdrop } from './Backdrop';
import { CheckoutGate, type GateViewer } from './CheckoutGate';
import { CheckoutNotice } from './CheckoutNotice';
import { PaymentCard } from './PaymentCard';
import { PaymentCardBoundary } from './PaymentCardBoundary';
import { TripSummary, type TripSummaryProps } from './TripSummary';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

// Created once per page load, not per render. Without a key there is nothing
// to load: `loadStripe('')` rejects asynchronously, which would surface as a
// blocked-script error rather than the configuration failure it really is.
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

/** Everything the summary renders, plus the photograph behind the whole page. */
export type CheckoutClientProps = TripSummaryProps & {
  heroImageUrl: string;
  /**
   * The signed-in guest, read on the server so the gate knows on first paint
   * whether sign-in is still owed. Null means nobody is signed in.
   */
  viewer: GateViewer | null;
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
}: {
  heroImageUrl: string;
  copy: CheckoutErrorCopy;
  onRetry?: () => void;
}) {
  return (
    <>
      <Backdrop heroImageUrl={heroImageUrl} />
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6">
        <CheckoutNotice copy={copy} onRetry={onRetry} />
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

type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; clientSecret: string; expiresAt: number | null }
  | { status: 'error'; copy: CheckoutErrorCopy };

/** A failure already translated into guest-facing copy. */
class SessionFailure extends Error {
  constructor(readonly copy: CheckoutErrorCopy) {
    super(copy.message);
    this.name = 'SessionFailure';
  }
}

async function createSession(
  turnstileToken: string,
  signal: AbortSignal
): Promise<{ clientSecret: string; expiresAt: number | null }> {
  let response: Response;
  try {
    response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      // The route verifies this with Cloudflare before it touches Stripe. The
      // field name is Turnstile's own, so the server reads it exactly as the
      // canonical siteverify flow expects.
      body: JSON.stringify({ 'cf-turnstile-response': turnstileToken }),
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
    expiresAt?: unknown;
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

  return {
    clientSecret: body.clientSecret,
    expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : null,
  };
}

/**
 * Resolves Stripe.js, turning both of its failure modes — a rejected load and
 * a `null` instance — into one message that names the likely cause.
 */
async function loadStripeOrFail(): Promise<Stripe> {
  let stripe: Stripe | null;
  try {
    stripe = await stripePromise;
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
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [stripe, setStripe] = useState<Stripe | null>(null);
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
    if (!turnstileToken) return;

    // Aborting on cleanup keeps React's development double-mount from leaving
    // a second, orphaned Session holding the same room.
    const controller = new AbortController();
    let active = true;

    // Stripe.js and the Session are independent, so a slow script does not
    // delay the request that puts the room on hold.
    Promise.all([loadStripeOrFail(), createSession(turnstileToken, controller.signal)])
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
  }, [attempt, turnstileToken]);

  // A blocked script or a failed challenge is terminal for this attempt: there
  // is no token to send, so the Session is never requested. Derived rather than
  // pushed into state from an effect — it is a fact about this render, and
  // mirroring it into `state` would only add a cascading re-render.
  const resolved: SessionState = turnstileFailed
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
    />
  );

  if (resolved.status === 'error') {
    return (
      <>
        {gate}
        <NoticeShell heroImageUrl={props.heroImageUrl} copy={resolved.copy} onRetry={retry} />
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
    <CheckoutFormProvider
      // Keyed on the secret so a retry mounts a clean provider against the new
      // Session rather than reusing the one that failed.
      key={resolved.clientSecret}
      stripe={stripe}
      options={{ clientSecret: resolved.clientSecret, appearance }}
    >
      {gate}
      <Shell heroImageUrl={props.heroImageUrl}>
        <TripSummary {...props} />
        <PaymentCardBoundary onRestart={retry}>
          <PaymentCard expiresAt={resolved.expiresAt} onRestart={retry} />
        </PaymentCardBoundary>
      </Shell>
    </CheckoutFormProvider>
  );
}

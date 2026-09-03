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
};

/**
 * Full-bleed host photograph with the checkout laid over it.
 *
 * The image is fixed behind the content rather than set on the page
 * background, so it stays put while a tall payment form scrolls, and the
 * gradient scrim keeps the white summary text legible whatever the host
 * uploads.
 */
function Backdrop({ heroImageUrl }: { heroImageUrl: string }) {
  return (
    <div className="fixed inset-0 -z-10 bg-[#0b1c4d]" aria-hidden="true">
      {heroImageUrl && (
        // Not next/image: the photo is host-supplied and no remote patterns
        // are configured for it. images.openbookings.co is allowed by CSP.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroImageUrl}
          alt=""
          className="size-full scale-105 object-cover blur-[2px]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0b1c4d]/95 via-[#0b1c4d]/80 to-[#0b1c4d]/60" />
    </div>
  );
}

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
    return (
      <Shell heroImageUrl={props.heroImageUrl}>
        <div className="h-72 animate-pulse rounded-2xl bg-white/10" aria-hidden="true" />
        <div className="h-[32rem] animate-pulse rounded-3xl bg-white/20" aria-hidden="true" />
      </Shell>
    );
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
  signal: AbortSignal
): Promise<{ clientSecret: string; expiresAt: number | null }> {
  let response: Response;
  try {
    response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { Accept: 'application/json' },
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

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    // Aborting on cleanup keeps React's development double-mount from leaving
    // a second, orphaned Session holding the same room.
    const controller = new AbortController();
    let active = true;

    // Stripe.js and the Session are independent, so a slow script does not
    // delay the request that puts the room on hold.
    Promise.all([loadStripeOrFail(), createSession(controller.signal)])
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
  }, [attempt]);

  if (state.status === 'error') {
    return <NoticeShell heroImageUrl={props.heroImageUrl} copy={state.copy} onRetry={retry} />;
  }

  if (state.status === 'loading' || !stripe) {
    return (
      <Shell heroImageUrl={props.heroImageUrl}>
        <div className="h-72 animate-pulse rounded-2xl bg-white/10" aria-hidden="true" />
        <div className="h-[32rem] animate-pulse rounded-3xl bg-white/20" aria-hidden="true" />
      </Shell>
    );
  }

  return (
    <CheckoutFormProvider
      // Keyed on the secret so a retry mounts a clean provider against the new
      // Session rather than reusing the one that failed.
      key={state.clientSecret}
      stripe={stripe}
      options={{ clientSecret: state.clientSecret, appearance }}
    >
      <Shell heroImageUrl={props.heroImageUrl}>
        <TripSummary {...props} />
        <PaymentCardBoundary onRestart={retry}>
          <PaymentCard expiresAt={state.expiresAt} onRestart={retry} />
        </PaymentCardBoundary>
      </Shell>
    </CheckoutFormProvider>
  );
}

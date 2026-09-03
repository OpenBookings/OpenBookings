'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import {
  BillingAddressElement,
  ContactDetailsElement,
  PaymentElement,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout';
import type { StripeError } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import {
  CHECKOUT_ALREADY_PAID,
  CHECKOUT_EXPIRED,
  ELEMENT_LOAD_FAILED,
  OFFLINE,
  checkoutErrorCopy,
  describeConfirmError,
  describeValidationError,
  isExpiredSessionError,
} from '../_lib/errors';
import { CheckoutNotice } from './CheckoutNotice';

/**
 * The payment card: Stripe Elements and nothing else.
 *
 * Almost every field the guest fills in belongs to Stripe — the billing
 * address and name, the email, and the payment method. Those are never
 * mirrored into React state, so there is no second copy of the guest's data to
 * keep in sync or to leak; the webhook reads them back from `customer_details`.
 */

export type PaymentCardProps = {
  /** Unix seconds the Session lapses at, or null if the route didn't say. */
  expiresAt: number | null;
  /** Asks the parent for a brand new Session. */
  onRestart: () => void;
};


/** `setTimeout` treats delays past this as zero and fires immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Explains a failure we have no better words for, mentioning connectivity only
 * when the browser claims to be offline.
 *
 * `navigator.onLine` is never used to *prevent* a payment. It reports false on
 * plenty of perfectly connected machines — headless Chrome and container
 * networking among them, and it flickered between runs on this very form — so
 * gating submission on it would stop real guests paying. Consulted after
 * something has already failed, a wrong answer costs only a slightly worse
 * sentence.
 */
function failureMessage(fallback: string): string {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return offline ? OFFLINE.message : fallback;
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white/70 p-4 shadow-2xl backdrop-blur-md sm:p-5">{children}</div>
  );
}

export function PaymentCard({ expiresAt, onRestart }: PaymentCardProps) {
  const checkoutState = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holdLapsed, setHoldLapsed] = useState(false);
  const [elementFailed, setElementFailed] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const submittingRef = useRef(false);

  /**
   * Watches the hold rather than waiting for Stripe to refuse the payment.
   *
   * A guest who opens checkout and comes back an hour later would otherwise
   * fill in a card, press pay, and be told something vague. Timers are also
   * throttled in background tabs and stop entirely while a laptop sleeps, so
   * the wall clock is rechecked whenever the tab becomes visible again rather
   * than trusted to have fired.
   */
  useEffect(() => {
    if (expiresAt === null) return;

    const deadline = expiresAt * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        setHoldLapsed(true);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
    };

    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [expiresAt]);

  // On a phone the pay button sits well below the fold, so an error rendered
  // above it would be announced by screen readers and seen by nobody else.
  // `nearest` scrolls only when the message is actually out of view — landing
  // on it when it is already visible would move the page for no reason.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  // Reported from an effect rather than inline: the provider's error branch
  // re-renders, and reporting during render would file the same issue again
  // on every one of them.
  const providerError = checkoutState.type === 'error' ? checkoutState.error.message : null;
  useEffect(() => {
    if (!providerError) return;
    Sentry.captureException(new Error(providerError), {
      tags: { area: 'checkout', stage: 'provider' },
    });
  }, [providerError]);

  const onElementLoadError = useCallback((event: { error: StripeError }) => {
    Sentry.captureException(event.error, { tags: { area: 'checkout', stage: 'element-load' } });
    setElementFailed(true);
  }, []);

  if (holdLapsed) {
    return <CheckoutNotice copy={CHECKOUT_EXPIRED} onRetry={onRestart} retryLabel="Start again" />;
  }

  if (checkoutState.type === 'loading') {
    return (
      <CardShell>
        <div className="space-y-4" aria-hidden="true">
          <div className="h-24 animate-pulse rounded-xl bg-neutral-300/60" />
          <div className="h-12 animate-pulse rounded-xl bg-neutral-300/60" />
          <div className="h-12 animate-pulse rounded-xl bg-neutral-300/60" />
          <div className="h-64 animate-pulse rounded-xl bg-neutral-300/60" />
        </div>
      </CardShell>
    );
  }

  if (checkoutState.type === 'error') {
    // The provider only reports a message, with no code to classify on, so the
    // real one goes to Sentry and the guest gets copy that offers a way out.
    return <CheckoutNotice copy={checkoutErrorCopy('session_failed')} onRetry={onRestart} />;
  }

  const { checkout } = checkoutState;

  // A back button, a bfcache restore or a second tab can land the guest on a
  // Session that is already done. Showing the form again invites a second
  // payment for the same room.
  if (checkout.status.type === 'expired') {
    return <CheckoutNotice copy={CHECKOUT_EXPIRED} onRetry={onRestart} retryLabel="Start again" />;
  }
  if (checkout.status.type === 'complete') {
    return <CheckoutNotice copy={CHECKOUT_ALREADY_PAID} />;
  }

  if (elementFailed) {
    return <CheckoutNotice copy={ELEMENT_LOAD_FAILED} onRetry={onRestart} />;
  }

  // Stripe requires the displayed amount to come from the session itself, so
  // what we show can never drift from what is charged.
  const total = checkout.total.total.amount;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in a text field submits too, and the disabled attribute alone
    // doesn't cover the window between the click and the first render.
    if (submittingRef.current || submitting || redirecting) return;

    setError(null);

    submittingRef.current = true;
    setSubmitting(true);

    try {
      // Surfaces field-level errors inside the Elements themselves, next to
      // the input at fault. The summary below is what catches the cases Stripe
      // reports without drawing — a missing phone number being the common one.
      const validation = await checkout.validateElements();
      if (validation.type === 'error') {
        setError(describeValidationError(validation.error));
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      const result = await checkout.confirm();

      // Only reached on an immediate error. Otherwise Stripe redirects to
      // return_url, sometimes via the payment method's own authorisation page.
      if (result.type === 'error') {
        submittingRef.current = false;
        if (isExpiredSessionError(result.error)) {
          setHoldLapsed(true);
          return;
        }

        const { message, report, unmappedCode } = describeConfirmError(result.error);
        if (report) {
          Sentry.captureException(new Error(result.error.message || 'Checkout confirm failed'), {
            // An unmapped decline is not a broken payment — the guest still got
            // usable copy — it just means the map needs a line adding.
            level: unmappedCode ? 'warning' : 'error',
            tags: {
              area: 'checkout',
              stage: 'confirm',
              ...(unmappedCode ? { unmappedDeclineCode: unmappedCode } : {}),
            },
            extra: { code: result.error.code, sessionId: checkout.id },
          });
        }
        setError(report ? failureMessage(message) : message);
        setSubmitting(false);
        return;
      }

      // Payment taken. Navigate immediately to return_url.
      setRedirecting(true);
      const sessionId = result.session.id;
      window.location.assign(`/checkout/return?session_id=${encodeURIComponent(sessionId)}`);
    } catch (err) {
      submittingRef.current = false;
      // Stripe.js throwing rather than returning an error would otherwise
      // leave the button stuck on "Confirming…" with nothing explaining it.
      Sentry.captureException(err, { tags: { area: 'checkout', stage: 'confirm' } });
      setError(failureMessage(checkoutErrorCopy('session_failed').message));
      setSubmitting(false);
    }
  }

  const busy = submitting || redirecting;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-4 rounded-3xl bg-white/70 p-4 shadow-2xl backdrop-blur-md sm:p-5"
    >
      <BillingAddressElement
        options={{ display: { name: 'full' }, fields: { phone: 'always' } }}
        onLoadError={onElementLoadError}
      />
      {/* The Contact Details Element emits `{ email }` only, but the Billing Address Element above will handle phone collection. */}
      <ContactDetailsElement onLoadError={onElementLoadError} />
      {/* Tabs, not the default accordion: with this many methods enabled the
          accordion becomes a long list that pushes the pay button off-screen. */}
      <PaymentElement options={{ layout: 'tabs' }} onLoadError={onElementLoadError} />

      {/* Always present so assistive technology has a region to announce into,
          rather than one that appears at the same moment it gains content. */}
      <p
        ref={errorRef}
        role="alert"
        aria-live="assertive"
        className="text-sm font-medium text-red-700 empty:hidden"
      >
        {error}
      </p>

      {/*
        Deliberately not disabled on `checkout.canConfirm`: an incomplete form
        should explain what is missing when pressed, not present a dead button
        with no clue which field is at fault.
      */}
      <Button
        type="submit"
        disabled={busy}
        className="h-12 w-full rounded-xl bg-[#a5b4f0] text-base font-semibold text-neutral-900 hover:bg-[#93a4e8] disabled:opacity-70"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {redirecting ? 'Payment taken — redirecting…' : 'Confirming…'}
          </>
        ) : (
          `Pay ${total}`
        )}
      </Button>
    </form>
  );
}

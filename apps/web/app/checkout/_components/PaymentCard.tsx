'use client';

import { useCallback, useEffect, useState } from 'react';
import * as Sentry from '@sentry/nextjs';
import { CheckoutForm, useCheckoutForm } from '@stripe/react-stripe-js/checkout';
import type { StripeCheckoutFormConfirmEvent, StripeError } from '@stripe/stripe-js';
import {
  CHECKOUT_ALREADY_PAID,
  CHECKOUT_EXPIRED,
  ELEMENT_LOAD_FAILED,
  checkoutErrorCopy,
  isExpiredSessionError,
} from '../_lib/errors';
import { CheckoutNotice } from './CheckoutNotice';

/**
 * The payment card: Stripe's embedded form and nothing else.
 *
 * Under `ui_mode: 'form'` Stripe owns every field the guest fills in — email,
 * phone, billing address and payment method — along with their validation,
 * their error messages and the pay button. None of it is mirrored into React
 * state, so there is no second copy of the guest's data to keep in sync or to
 * leak; the webhook reads it back from `customer_details`.
 *
 * What is left here is only what Stripe cannot know about: our room hold, and
 * the page-level takeovers for a session that has lapsed or already been paid.
 */

export type PaymentCardProps = {
  /** Unix seconds the Session lapses at, or null if the route didn't say. */
  expiresAt: number | null;
  /** Asks the parent for a brand new Session. */
  onRestart: () => void;
};

/** `setTimeout` treats delays past this as zero and fires immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white/70 p-4 shadow-2xl backdrop-blur-md sm:p-5">{children}</div>
  );
}

export function PaymentCard({ expiresAt, onRestart }: PaymentCardProps) {
  const checkoutState = useCheckoutForm();
  const [holdLapsed, setHoldLapsed] = useState(false);
  const [formFailed, setFormFailed] = useState(false);

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

  const onLoadError = useCallback((event: { error: StripeError }) => {
    Sentry.captureException(event.error, { tags: { area: 'checkout', stage: 'form-load' } });
    setFormFailed(true);
  }, []);

  const checkout = checkoutState.type === 'success' ? checkoutState.checkout : null;

  /**
   * Hands the guest's confirmation straight back to Stripe.
   *
   * Deliberately silent about declines. The embedded form renders its own
   * localised message for anything the guest can act on — a declined card, an
   * incomplete field — so surfacing a second copy out here would say the same
   * thing twice in two different voices. Only a lapsed hold is escalated,
   * because that one needs the whole page rather than a line of red text.
   */
  const onConfirm = useCallback(
    async (event: StripeCheckoutFormConfirmEvent) => {
      if (!checkout) return;
      try {
        const result = await checkout.confirm({ formConfirmEvent: event });
        if (result.type === 'error') {
          if (isExpiredSessionError(result.error)) {
            setHoldLapsed(true);
            return;
          }
          // Left for Stripe to display; recorded here so a systematic failure
          // is still visible to us rather than only to the guest.
          Sentry.captureException(new Error(result.error.message || 'Checkout confirm failed'), {
            level: 'warning',
            tags: { area: 'checkout', stage: 'confirm' },
            extra: { code: result.error.code, sessionId: checkout.id },
          });
        }
      } catch (err) {
        // Stripe.js throwing rather than returning an error. The form stays
        // usable, so the guest can try again once we have logged it.
        Sentry.captureException(err, { tags: { area: 'checkout', stage: 'confirm' } });
      }
    },
    [checkout]
  );

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

  const { checkout: session } = checkoutState;

  // A back button, a bfcache restore or a second tab can land the guest on a
  // Session that is already done. Showing the form again invites a second
  // payment for the same room.
  if (session.status.type === 'expired') {
    return <CheckoutNotice copy={CHECKOUT_EXPIRED} onRetry={onRestart} retryLabel="Start again" />;
  }
  if (session.status.type === 'complete') {
    return <CheckoutNotice copy={CHECKOUT_ALREADY_PAID} />;
  }

  if (formFailed) {
    return <CheckoutNotice copy={ELEMENT_LOAD_FAILED} onRetry={onRestart} />;
  }

  return (
    <CardShell>
      {/*
        `expanded` keeps the whole checkout on one page. The compact layout is
        a multi-step flow suited to modals, and it is in private preview.

        There is no pay button of ours here any more: the form renders its own,
        labelled with the amount from the Session, so what the guest presses
        can never disagree with what is charged.
      */}
      <CheckoutForm
        options={{ layout: 'expanded' }}
        onConfirm={onConfirm}
        onLoadError={onLoadError}
      />
    </CardShell>
  );
}

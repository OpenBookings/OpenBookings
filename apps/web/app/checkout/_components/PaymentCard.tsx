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
 * the takeovers for a hold that has lapsed or a session already paid.
 */

export type PaymentCardProps = {
  /** The intent's hold has run out (`useHoldCountdown`), so the form must go. */
  holdLapsed: boolean;
  /** Asks the parent for a brand new Session. */
  onRestart: () => void;
  /** The property page, where a lapsed hold starts again. */
  backHref: string;
  /**
   * A Non-refundable rate (Annex B B.4.3): the guest ticks that they
   * understand before the card form appears. The form has its own pay
   * button, so holding the form back is the one reliable way to gate it.
   */
  requiresNonRefundableConsent?: boolean;
};

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white/70 p-4 shadow-2xl backdrop-blur-md sm:p-5">{children}</div>
  );
}

export function PaymentCard({
  holdLapsed,
  onRestart,
  backHref,
  requiresNonRefundableConsent = false,
}: PaymentCardProps) {
  const checkoutState = useCheckoutForm();
  const [consented, setConsented] = useState(false);
  // Stripe refusing a confirm because the session expired; the countdown
  // covers the hold itself.
  const [sessionLapsed, setSessionLapsed] = useState(false);
  const [formFailed, setFormFailed] = useState(false);

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
            setSessionLapsed(true);
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

  if (holdLapsed || sessionLapsed) {
    return <CheckoutNotice copy={CHECKOUT_EXPIRED} backHref={backHref} />;
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
    return <CheckoutNotice copy={CHECKOUT_EXPIRED} backHref={backHref} />;
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

        The express wallet buttons are turned off rather than left to `auto`.
        They sit above everything else and lead with someone else's brand,
        which on a page that has just shown the guest a specific room reads as
        a detour rather than a shortcut. Apple Pay and Google Pay are left
        alone: they are the two the guest's own device offers, and they cost
        nothing in trust.
      */}
      {requiresNonRefundableConsent && (
        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-300 bg-white/80 p-4 text-sm text-neutral-800">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 size-4 accent-neutral-900"
          />
          <span>
            <span className="font-medium">I understand this rate is non-refundable.</span>{' '}
            If I cancel or don&apos;t show up, I won&apos;t get the room price back.
          </span>
        </label>
      )}
      {(!requiresNonRefundableConsent || consented) && (
        <CheckoutForm
          options={{
            layout: 'expanded',
            expressCheckout: { paymentMethods: { link: 'never', amazonPay: 'never' } },
          }}
          onConfirm={onConfirm}
          onLoadError={onLoadError}
        />
      )}
      {/*
        Signed off under the pay button, where a payment page conventionally
        says who handled the money. Decorative to a screen reader — the fields
        above already announce themselves as Stripe's.
      */}
      <img
        src="/powered-by-stripe.svg"
        alt=""
        aria-hidden="true"
        className="mx-auto mt-5 h-8 w-auto opacity-70"
        draggable="false"
      />
    </CardShell>
  );
}

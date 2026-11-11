'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Loader2, Lock, Mail, ShieldCheck, UserRound } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { ExpressCheckoutElement, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';
import type {
  StripeCheckoutExpressCheckoutElementOptions,
  StripeError,
  StripeExpressCheckoutElementConfirmEvent,
} from '@stripe/stripe-js';
import {
  CHECKOUT_ALREADY_PAID,
  CHECKOUT_EXPIRED,
  ELEMENT_LOAD_FAILED,
  OFFLINE,
  checkoutErrorCopy,
  alertForConfirmError,
  describeValidationError,
  isExpiredSessionError,
  unexpectedPaymentError,
} from '../_lib/errors';
import { toStripeContact } from '../_lib/guest-details';
import { holdLabel } from '../_lib/reassurance';
import { PAY_BUTTON_ID } from './CheckoutStickyBar';
import { CheckoutNotice } from './CheckoutNotice';
import { CHECKOUT_CARD } from './DetailsCard';
import type { CheckoutDetailsController } from './useCheckoutDetails';

/**
 * The payment card: Stripe's wallet buttons and payment box, and our Pay
 * button. Nothing else.
 *
 * The guest's name, phone and address live in the details card above and are
 * saved to their account before Stripe is asked to charge; they reach Stripe
 * as part of `confirm`. So this card collects only what is Stripe's to
 * collect, inside Stripe's own frames.
 *
 * Which methods show is not ours to decide: Stripe draws what the hotel's
 * account allows for this currency, amount and device. The wallet row is
 * simply absent when Stripe has no wallet to offer.
 */

export type PaymentCardProps = {
  /** The intent's hold has run out (`useHoldCountdown`), so the form must go. */
  holdLapsed: boolean;
  /** Asks the parent for a brand new Session. */
  onRestart: () => void;
  /** The property page, where a lapsed hold starts again. */
  backHref: string;
  /** The details card's state: validated and saved before anything is charged. */
  details: CheckoutDetailsController;
  /** Named in the trust line: the hotel is the merchant (a direct charge). */
  propertyName: string;
  /** Unix milliseconds the hold ends, for the header label. */
  holdExpiresAt: number;
  /** The cancellation line above Pay. */
  reassurance: { tone: 'free' | 'neutral'; text: string };
  /** "+ €75.00 at the property for the extra bed", under Pay; null when nothing is paid there. */
  payAtPropertyLine: string | null;
};

/** How often the hold label re-reads the clock. */
const HOLD_TICK_MS = 15_000;

/** "14:30", 24-hour whatever the browser's locale. */
const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function HoldLabel({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), HOLD_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const { text, urgent } = holdLabel(expiresAt, now, clockTime);
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-normal ${urgent ? 'text-amber-700' : 'text-muted-foreground'}`}
    >
      <Clock aria-hidden className="size-3.5" />
      {text}
    </span>
  );
}

const NEXT_STEPS = (propertyName: string) => [
  { Icon: Mail, text: 'Confirmation by email straight away.' },
  { Icon: UserRound, text: 'Change, cancel or message the hotel from your account.' },
  { Icon: Lock, text: `You pay ${propertyName} directly. Stripe handles your card; OpenBookings never sees it.` },
];

/**
 * Stripe's elements show nothing until they have loaded. If one never says it
 * is ready, the guest still gets the form after this long rather than a
 * skeleton forever.
 */
const READY_FALLBACK_MS = 8000;

type ConfirmError = { code?: string | null; message?: string; paymentFailed?: { declineCode?: string | null } };

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="h-11 animate-pulse rounded-xl bg-neutral-300/60" />
      <div className="h-24 animate-pulse rounded-xl bg-neutral-300/60" />
      <div className="h-12 animate-pulse rounded-xl bg-neutral-300/60" />
    </div>
  );
}

export function PaymentCard({
  holdLapsed,
  onRestart,
  backHref,
  details,
  propertyName,
  holdExpiresAt,
  reassurance,
  payAtPropertyLine,
}: PaymentCardProps) {
  const checkoutState = useCheckoutElements();
  // Stripe refusing a confirm because the session expired; the countdown
  // covers the hold itself.
  const [sessionLapsed, setSessionLapsed] = useState(false);
  const [formFailed, setFormFailed] = useState(false);
  const [walletsReady, setWalletsReady] = useState(false);
  const [hasWallets, setHasWallets] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref as well as state: a double click lands before React re-renders.
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const providerError = checkoutState.type === 'error' ? checkoutState.error.message : null;
  useEffect(() => {
    if (!providerError) return;
    Sentry.captureException(new Error(providerError), { tags: { area: 'checkout', stage: 'provider' } });
  }, [providerError]);

  useEffect(() => {
    const timer = setTimeout(() => setWaitedTooLong(true), READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  const shownError = error ?? details.saveError;
  useEffect(() => {
    if (shownError) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [shownError]);

  const onLoadError = useCallback((event: { error: StripeError }) => {
    Sentry.captureException(event.error, { tags: { area: 'checkout', stage: 'element-load' } });
    setFormFailed(true);
  }, []);

  const checkout = checkoutState.type === 'success' ? checkoutState.checkout : null;

  /** Puts a failed confirm into words; a lapsed session takes the card over instead. */
  const showConfirmError = useCallback(
    (confirmError: ConfirmError, elementShowsDeclines: boolean) => {
      if (isExpiredSessionError(confirmError)) {
        setSessionLapsed(true);
        return;
      }
      const { message, report, unmappedCode } = alertForConfirmError(confirmError, { elementShowsDeclines });
      if (report) {
        Sentry.captureException(new Error(confirmError.message || 'Checkout confirm failed'), {
          level: unmappedCode ? 'warning' : 'error',
          tags: { area: 'checkout', stage: 'confirm', ...(unmappedCode ? { unmappedDeclineCode: unmappedCode } : {}) },
          extra: { code: confirmError.code, sessionId: checkout?.id },
        });
      }
      setError(report && isOffline() ? unexpectedPaymentError({ confirmStarted: true, offline: true }) : message);
    },
    [checkout]
  );

  /** Card, iDEAL and the rest of Stripe's payment box. */
  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!checkout || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    let leaving = false;
    // Past this point Stripe may have charged, so no error may claim otherwise.
    let confirmStarted = false;
    try {
      // Cheapest first, and nothing is written until all of it is complete.
      if (!details.validate()) return;
      const validation = await checkout.validateElements();
      if (validation.type === 'error') {
        setError(describeValidationError(validation.error));
        return;
      }
      const outcome = await details.save();
      if (!outcome.saved) {
        // Field errors show in the details card; a failed save shows its own sentence.
        if (outcome.reason === 'failed' && isOffline()) setError(OFFLINE.message);
        return;
      }
      confirmStarted = true;
      const result = await checkout.confirm(toStripeContact(outcome.details));
      if (result.type === 'error') {
        showConfirmError(result.error, true);
        return;
      }
      // Methods that need no redirect resolve here; send the guest on ourselves.
      leaving = true;
      // A full load, not router.push: the return page reads the paid Session fresh.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/checkout/return?session_id=${encodeURIComponent(result.session.id)}`);
    } catch (err) {
      Sentry.captureException(err, { tags: { area: 'checkout', stage: 'confirm' } });
      setError(unexpectedPaymentError({ confirmStarted, offline: isOffline() }));
    } finally {
      if (!leaving) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  /**
   * Apple Pay and Google Pay. The checkout's wallet element offers no click
   * hook, so the details card is checked once the guest has approved in the
   * wallet: incomplete details fail the wallet payment and open the card on
   * the problem. A guest whose account is complete never meets that, since
   * the card starts as a summary only when everything is there.
   */
  const onWalletConfirm = async (event: StripeExpressCheckoutElementConfirmEvent) => {
    if (!checkout || submitting.current) {
      event.paymentFailed();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    let leaving = false;
    let confirmStarted = false;
    try {
      const outcome = await details.save();
      if (!outcome.saved) {
        event.paymentFailed();
        if (outcome.reason === 'invalid') setError('Complete your details above, then pay again.');
        return;
      }
      confirmStarted = true;
      const result = await checkout.confirm({
        expressCheckoutConfirmEvent: event,
        ...toStripeContact(outcome.details),
      });
      if (result.type === 'error') {
        showConfirmError(result.error, false);
        return;
      }
      leaving = true;
      // A full load, not router.push: the return page reads the paid Session fresh.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/checkout/return?session_id=${encodeURIComponent(result.session.id)}`);
    } catch (err) {
      Sentry.captureException(err, { tags: { area: 'checkout', stage: 'wallet-confirm' } });
      event.paymentFailed();
      setError(unexpectedPaymentError({ confirmStarted, offline: isOffline() }));
    } finally {
      if (!leaving) {
        submitting.current = false;
        setBusy(false);
      }
    }
  };

  if (holdLapsed || sessionLapsed) {
    return <CheckoutNotice copy={CHECKOUT_EXPIRED} backHref={backHref} />;
  }

  if (checkoutState.type === 'loading') {
    return (
      <div className={CHECKOUT_CARD}>
        <Skeleton />
      </div>
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

  // Both of Stripe's pieces are measured before either is shown, so the wallet
  // row never appears and then vanishes, or arrives late and shoves the form.
  const ready = (walletsReady && paymentReady) || waitedTooLong;

  return (
    <section aria-labelledby="checkout-payment-heading" className={CHECKOUT_CARD}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="checkout-payment-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Lock aria-hidden className="size-3.5" />
          Payment
        </h2>
        <HoldLabel expiresAt={holdExpiresAt} />
      </div>

      <div className="relative">
        {!ready && <Skeleton />}
        <div className={ready ? undefined : 'pointer-events-none absolute inset-x-0 top-0 opacity-0'} aria-hidden={!ready}>
          <ExpressCheckoutElement
            // Stripe's typings mark every option required; all but these are optional at runtime.
            options={{ paymentMethods: { link: 'never', amazonPay: 'never' } } as StripeCheckoutExpressCheckoutElementOptions}
            onReady={(event) => {
              setHasWallets(Object.values(event.availablePaymentMethods ?? {}).some(Boolean));
              setWalletsReady(true);
            }}
            onConfirm={onWalletConfirm}
            onLoadError={onLoadError}
          />
          {hasWallets && (
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-black/10" />
              or pay another way
              <span className="h-px flex-1 bg-black/10" />
            </div>
          )}

          <form onSubmit={pay} noValidate className="space-y-4">
            <PaymentElement
              options={{
                layout: 'tabs',
                // Ours to send, from the details card, on confirm.
                fields: { billingDetails: { name: 'never', email: 'never', phone: 'never', address: 'never' } },
                // Link's "save my information" signup asks for an email and
                // phone of its own; off here as it is on the wallet row.
                wallets: { link: 'never' },
              }}
              onReady={() => setPaymentReady(true)}
              onLoadError={onLoadError}
            />

            {/* Always present, so assistive technology has a region to announce into. */}
            <p ref={errorRef} role="alert" aria-live="assertive" className="text-sm font-medium text-(--red-11) empty:hidden">
              {shownError}
            </p>

            <p
              className={`flex items-center gap-1.5 text-[13px] ${reassurance.tone === 'free' ? 'font-medium text-green-700' : 'text-muted-foreground'}`}
            >
              <ShieldCheck aria-hidden className={`size-4 shrink-0 ${reassurance.tone === 'free' ? 'text-green-600' : ''}`} />
              {reassurance.text}
            </p>

            {/*
              Not disabled on an incomplete form: pressing it should say what is
              missing. The amount is Stripe's, so it can't differ from the charge.
            */}
            <button
              id={PAY_BUTTON_ID}
              type="submit"
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#a5b4f0] text-base font-semibold text-neutral-900 transition-colors outline-none hover:bg-[#93a4e8] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-70"
            >
              {busy ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Paying…
                </>
              ) : (
                <>
                  <Lock aria-hidden className="size-4" />
                  Pay {session.total.total.amount}
                </>
              )}
            </button>
            {payAtPropertyLine && (
              <p className="-mt-1 text-center text-xs text-muted-foreground">{payAtPropertyLine}</p>
            )}
          </form>
        </div>
      </div>

      <ul className="mt-5 space-y-2.5 border-t border-black/10 pt-4">
        {NEXT_STEPS(propertyName).map(({ Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5 text-xs leading-relaxed text-pretty text-muted-foreground">
            <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {text}
          </li>
        ))}
      </ul>
      {/* Decorative to a screen reader: the fields above announce themselves as Stripe's. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a static badge, nothing to optimise */}
      <img
        src="/powered-by-stripe.svg"
        alt=""
        aria-hidden="true"
        className="mx-auto mt-3 h-8 w-auto opacity-70"
        draggable="false"
      />
    </section>
  );
}

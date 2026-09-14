'use client';

import { useEffect, useState } from 'react';
import { BedDouble, Check, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react';
import { AuthFormFields, AuthFormPhaseProvider } from '@/components/auth/AuthFormFields';
import { Backdrop } from './Backdrop';

/**
 * Where sign-in returns to.
 *
 * A bare path rather than an absolute URL: the magic-link route resolves it
 * against our own origin and refuses anything that lands elsewhere, and
 * Better Auth checks social callbacks against `trustedOrigins`. Landing back
 * on /checkout re-runs this gate, which now finds a session and moves on to
 * the next step.
 */
const GATE_CALLBACK_URL = '/checkout';

/**
 * The screen that stands between arriving at /checkout and being able to pay.
 *
 * Three things have to be true before a Checkout Session is worth creating: we
 * know who the guest is, Cloudflare is satisfied they are a person, and Stripe
 * has given us a secret to mount the form against. Each used to announce
 * itself somewhere different — a sign-in wall would have been a redirect, the
 * Turnstile widget sat in the payment grid, and the Session appeared as a pair
 * of pulsing skeletons. This is all three in one place, in the order they
 * actually resolve.
 *
 * Ordering is the point, not just the presentation. Both ways out of sign-in
 * leave the page: a magic link opens from the guest's inbox, and the social
 * buttons redirect to Google or Apple. Doing that *after* a Session exists
 * would abandon a live room hold and a Turnstile token that cannot be spent
 * twice. Putting auth first means the round trip costs nothing — there is
 * nothing yet to lose — and by the time we ask Stripe for a Session we have an
 * email to prefill it with.
 *
 * ## Why this never unmounts
 *
 * `turnstile.reset()` acts on a live widget, so the element the widget was
 * rendered into has to stay in the document for the entire life of the page —
 * including after the gate is done and the payment form is on screen. A gate
 * that mounted and unmounted around it would destroy the widget the retry path
 * depends on.
 *
 * So this component is always rendered, and `visible` only swaps its classes.
 * The container's ancestor chain never changes; the widget inside it is
 * untouched by anything that happens out here.
 *
 * The hidden state is `size-0 overflow-hidden opacity-0`, deliberately *not*
 * `display:none`, `visibility:hidden` or an unmount — all three tear the
 * widget down or stop Cloudflare treating it as rendered.
 */

export type GateViewer = {
  email: string;
  name: string | null;
};

export type CheckoutGateProps = {
  heroImageUrl: string;
  /** False once a Session exists, or once a failure has taken over the page. */
  visible: boolean;
  /** The signed-in guest, or null while sign-in is still the blocking step. */
  viewer: GateViewer | null;
  /** True once Turnstile has issued a token for this attempt. */
  verified: boolean;
  /** Where the Turnstile widget mounts. Must stay in the DOM — see above. */
  turnstileRef: React.RefObject<HTMLDivElement | null>;
};

type StepStatus = 'done' | 'active' | 'pending';

function Step({
  status,
  icon: Icon,
  label,
  detail,
}: {
  status: StepStatus;
  icon: typeof UserRound;
  label: string;
  detail?: string | null;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={[
          'grid size-8 shrink-0 place-items-center rounded-full border transition-colors',
          status === 'done'
            ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
            : status === 'active'
              ? 'border-white/30 bg-white/15 text-white'
              : 'border-white/10 bg-white/5 text-white/30',
        ].join(' ')}
      >
        {status === 'done' ? (
          <Check className="size-4" aria-hidden="true" />
        ) : status === 'active' ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span
          className={[
            'block text-sm font-medium transition-colors',
            status === 'pending' ? 'text-white/40' : 'text-white',
          ].join(' ')}
        >
          {label}
        </span>
        {detail ? (
          <span className="block truncate text-xs text-white/55">{detail}</span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Holds the Turnstile widget, and takes up room only when it draws something.
 *
 * Under `interaction-only` most guests never see a challenge, but Cloudflare
 * still injects its machinery into the container — so the element is present
 * and zero-height rather than absent, and neither `:empty` nor `:has()` can
 * tell the two apart. Margin applied unconditionally would therefore leave a
 * band of dead space in the card for the majority who pass silently.
 *
 * Measuring is what actually distinguishes them: the observer reports a real
 * height only when there is a challenge on screen, and the spacing follows it.
 *
 * The container itself is always rendered. The ref has to resolve to a live
 * node from the first paint, and that node must outlive the gate — see the
 * component docblock.
 */
function TurnstileSlot({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [occupied, setOccupied] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      setOccupied(entry.contentRect.height > 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

  return (
    <div className={occupied ? 'mt-6 flex justify-center' : 'flex justify-center'}>
      <div ref={containerRef} />
    </div>
  );
}

export function CheckoutGate({
  heroImageUrl,
  visible,
  viewer,
  verified,
  turnstileRef,
}: CheckoutGateProps) {
  const signedIn = viewer !== null;

  const authStatus: StepStatus = signedIn ? 'done' : 'active';
  const verifyStatus: StepStatus = !signedIn ? 'pending' : verified ? 'done' : 'active';
  const reserveStatus: StepStatus = verified ? 'active' : 'pending';

  return (
    <div
      className={
        visible
          ? 'fixed inset-0 z-50 overflow-y-auto'
          : // Collapsed rather than unmounted or display:none — the Turnstile
            // widget inside has to stay live for the retry path.
            'pointer-events-none fixed left-0 top-0 size-0 overflow-hidden opacity-0'
      }
      // The gate owns the screen while it is up, so everything behind it is
      // inert. When it is down it is not content at all.
      role={visible ? 'dialog' : undefined}
      aria-modal={visible ? true : undefined}
      aria-label={visible ? 'Preparing your booking' : undefined}
      aria-hidden={visible ? undefined : true}
    >
      {visible ? <Backdrop heroImageUrl={heroImageUrl} /> : null}

      <div className="flex min-h-full items-center justify-center px-4 py-10">
        {/*
          `text-white` is the card's inherited foreground, not decoration on
          the wrapper. `<body>` sets no colour, so the document default — black
          — is what anything without its own reaches. Most of this card names
          its colour, but the shared sign-in controls do not: `Input` and the
          `outline` Button variant set a background and let the text inherit,
          which is correct everywhere else because every other surface renders
          them inside `<Card>` and that supplies `text-card-foreground`. This
          card is hand-rolled glass, so it has to supply the same thing.
        */}
        <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-black/40 p-8 text-white shadow-2xl backdrop-blur-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://cdn.openbookings.co/Public/Openbookings-logo-v2.png"
            alt="OpenBookings"
            className="pointer-events-none mx-auto h-8 w-auto select-none"
            draggable="false"
          />

          {signedIn ? (
            <p className="mt-6 text-center text-lg font-semibold text-white">
              Preparing your booking
            </p>
          ) : (
            <div className="mt-6 text-center">
              <p className="text-lg font-semibold text-white">Sign in to book</p>
              <p className="mt-1 text-sm text-white/70">
                Your booking, confirmation and cancellation all live in your account.
              </p>
            </div>
          )}

          {/*
            The sign-in form replaces the step list rather than sitting under
            it: until there is an account there is nothing for the other two
            steps to report, and showing three spinners behind a form the guest
            has not filled in yet reads as progress that is not happening.
          */}
          {!signedIn ? (
            <div className="mt-6 flex flex-col items-center gap-4">
              <AuthFormPhaseProvider>
                <AuthFormFields callbackURL={GATE_CALLBACK_URL} />
              </AuthFormPhaseProvider>
            </div>
          ) : (
            <ol className="mt-7 space-y-4">
              <Step
                status={authStatus}
                icon={UserRound}
                label="Signed in"
                detail={viewer?.email ?? null}
              />
              <Step
                status={verifyStatus}
                icon={ShieldCheck}
                label={verifyStatus === 'done' ? 'Browser checked' : 'Checking your browser'}
              />
              <Step
                status={reserveStatus}
                icon={BedDouble}
                label={reserveStatus === 'active' ? 'Reserving your room' : 'Reserve your room'}
              />
            </ol>
          )}

          <TurnstileSlot containerRef={turnstileRef} />

          <p className="mt-6 text-center text-xs text-white/45">
            You won&apos;t be charged until you confirm the payment.
          </p>
        </div>
      </div>
    </div>
  );
}

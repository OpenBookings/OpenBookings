import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, XCircle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { getPool, loadIntentBySession, type BookingIntent } from '@openbookings/db';
import { retrieveBookingCheckout } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Backdrop } from '../_components/Backdrop';
import { describeDeclineCode } from '../_lib/errors';
import { hotelSearchHref } from '../_lib/hotel-search-href';

export const dynamic = 'force-dynamic';

type ReturnPageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

type Outcome = {
  icon: typeof CheckCircle2;
  tone: string;
  title: string;
  body: string;
  action: { href: string; label: string };
};

/** Without an intent there is no hotel to go back to; outcomes for an intent go back to its hotel instead. */
const RETRY = { href: '/', label: 'Try again' };
const DONE = { href: '/', label: 'Done' };
const OVERSOLD_BODY = "Another booking took them just as your payment went through, so we couldn't confirm yours.";

/**
 * What the guest is told after Stripe sends them back.
 *
 * The distinction that matters is between *knowing* a payment failed and
 * merely being unable to confirm it. Only `failed` — a Session Stripe still
 * reports as open — has earned the right to say nothing was charged and offer
 * a retry. Every other uncertain path lands on `unverified`, because inviting
 * someone to pay again for a booking that may already be paid is the worst
 * thing this page can do.
 */
const OUTCOMES = {
  paid: {
    icon: CheckCircle2,
    tone: 'text-foreground',
    title: 'Booking confirmed',
    body: 'Your payment went through. A confirmation email with your check-in details is on its way.',
    action: DONE,
  },
  processing: {
    icon: Clock,
    tone: 'text-muted-foreground',
    title: 'Payment processing',
    body: "Your bank is still confirming this payment. We'll email you as soon as it clears — no need to pay again.",
    action: DONE,
  },
  failed: {
    icon: XCircle,
    tone: 'text-destructive',
    title: 'Payment not completed',
    body: "The payment didn't go through and you haven't been charged. You can try again with another method.",
    action: RETRY,
  },
  expired: {
    icon: Clock,
    tone: 'text-muted-foreground',
    title: 'Your hold expired',
    body: 'This booking was only held for a short while and the hold has lapsed. Nothing was charged — start again to see whether the room is still free.',
    action: RETRY,
  },
  oversold: {
    icon: AlertTriangle,
    tone: 'text-amber-600',
    title: 'Those rooms were just taken',
    body: `${OVERSOLD_BODY} Your payment was refunded in full — there's nothing you need to do.`,
    action: { href: '/', label: 'Back to the property' },
  },
  unverified: {
    icon: AlertTriangle,
    tone: 'text-amber-600',
    title: "We couldn't confirm this payment",
    body: "We couldn't reach our payment provider to check on your booking. Please don't pay again — we'll email you as soon as we know, and you can contact us if nothing arrives.",
    action: DONE,
  },
  unknown: {
    icon: HelpCircle,
    tone: 'text-muted-foreground',
    title: 'Nothing to show here',
    body: "This page needs a payment reference and there isn't one, so there's nothing to confirm. If you were part-way through booking, start again.",
    action: RETRY,
  },
} satisfies Record<string, Outcome>;

/**
 * Checkout Session ids are `cs_` plus an opaque suffix. Anything else is a
 * mangled link or someone poking at the URL, and is answered from here rather
 * than turned into a Stripe request that can only 404.
 */
function isSessionId(value: string): boolean {
  return /^cs_[A-Za-z0-9_]{10,}$/.test(value);
}

/**
 * Our words for why the last payment attempt on this Session failed.
 *
 * Stripe reports the reason twice: `decline_code` when an issuer refused the
 * card, and `code` for everything else. They overlap by name for the common
 * cases, so both go through the same map. Null when there was no attempt, or
 * when the reason is one we have no wording for — the caller keeps its own
 * copy rather than inventing a reason.
 */
function declineReason(paymentIntent: unknown): string | null {
  if (!paymentIntent || typeof paymentIntent !== 'object') return null;

  const error = (paymentIntent as { last_payment_error?: unknown }).last_payment_error;
  if (!error || typeof error !== 'object') return null;

  const { code, decline_code: declineCode } = error as {
    code?: string | null;
    decline_code?: string | null;
  };
  return describeDeclineCode(declineCode) ?? describeDeclineCode(code);
}

/** Stripe could not tell us, or we could not ask: we do not know what happened to the money. */
function unverified(err: unknown, sessionId: string): Outcome {
  // In none of these do we know what happened to the guest's money, so we
  // must not claim they weren't charged.
  Sentry.captureException(err, {
    tags: { area: 'checkout', stage: 'return' },
    extra: { sessionId },
  });
  console.error('[checkout/return]', err instanceof Error ? err.message : String(err));
  return OUTCOMES.unverified;
}

/** The guest's own intent paid with this session. Null when it is not theirs, or not signed in. */
async function loadGuestIntent(sessionId: string): Promise<BookingIntent | null> {
  const auth = await getServerSession();
  if (!auth?.user?.id) return null;
  return loadIntentBySession(getPool(), { sessionId, userId: auth.user.id });
}

/** The hotel's photograph for the backdrop; a missing one leaves it plain black. */
async function loadHeroImageUrl(propertyId: string): Promise<string> {
  const { rows } = await getPool().query<{ url: string }>(
    `select url from property_images
     where property_id = $1 and "group" = 'hero-image'
     order by sort_order limit 1`,
    [propertyId]
  );
  return rows[0]?.url ?? '';
}

/**
 * The intent first: once the webhook has turned it into a booking (or found
 * the rooms gone), that is the answer. Until then, Stripe's view of the
 * session decides, as below.
 */
async function resolveIntentOutcome(intent: BookingIntent, sessionId: string): Promise<Outcome> {
  if (intent.status === 'paid' && intent.bookingId) {
    return { ...OUTCOMES.paid, action: { href: `/bookings/${intent.bookingId}`, label: 'View booking' } };
  }
  const hotel = hotelSearchHref(intent);
  if (intent.status === 'oversold' || intent.status === 'refunded_oversold') {
    // `oversold` is the moment between the payment and its refund.
    const refund = intent.status === 'oversold' ? 'is being refunded' : 'was refunded';
    return {
      ...OUTCOMES.oversold,
      body: `${OVERSOLD_BODY} Your payment ${refund} in full — there's nothing you need to do.`,
      action: { ...OUTCOMES.oversold.action, href: hotel },
    };
  }
  const outcome = await resolveStripeOutcome(sessionId, intent.paymentAccountId);
  // Starting again means the same stay at the same hotel, not a blank search.
  return outcome.action === RETRY ? { ...outcome, action: { ...RETRY, href: hotel } } : outcome;
}

async function resolveStripeOutcome(sessionId: string, accountId: string | null): Promise<Outcome> {
  let session;
  try {
    // The PaymentIntent carries `last_payment_error`, which is the only place
    // the reason for a decline survives once the guest is back on our page.
    //
    // The Session was created on the host's connected account, so that is
    // where it has to be looked up; the intent holds the account its session
    // was made on. A failure to find it lands in the catch below as
    // "unverified": we cannot say what happened to the money.
    if (!accountId) throw new Error('Booking intent has no payment account');
    session = await retrieveBookingCheckout(sessionId, accountId);
  } catch (err) {
    // Stripe positively confirming there is no such Session is different from
    // Stripe being unreachable: the id is wrong, and there is no payment of
    // the guest's hanging in the balance to warn them about.
    if ((err as { code?: unknown })?.code === 'resource_missing') {
      return OUTCOMES.unknown;
    }

    // Everything else — a missing secret key, an outage, a timeout.
    return unverified(err, sessionId);
  }

  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    return OUTCOMES.paid;
  }

  // Completed but not yet paid: an async method such as iDEAL or a bank debit
  // is still clearing.
  if (session.status === 'complete') return OUTCOMES.processing;

  // The hold ran out before the guest confirmed. Distinct from a refusal:
  // there was never an attempt to charge.
  if (session.status === 'expired') return OUTCOMES.expired;

  // Still open — the guest came back without completing. This is the one case
  // where we know for certain no charge was made.
  if (session.status === 'open') {
    const reason = declineReason(session.payment_intent);
    return reason
      ? { ...OUTCOMES.failed, body: `${reason} You have not been charged.` }
      : OUTCOMES.failed;
  }

  // A status Stripe has added since. Guessing would risk the double payment.
  Sentry.captureMessage(`Unhandled checkout session status: ${session.status}`, {
    level: 'warning',
    tags: { area: 'checkout', stage: 'return' },
    extra: { sessionId },
  });
  return OUTCOMES.unverified;
}

async function resolveOutcome(sessionId: string | undefined): Promise<{ outcome: Outcome; heroImageUrl: string }> {
  if (!sessionId || !isSessionId(sessionId)) return { outcome: OUTCOMES.unknown, heroImageUrl: '' };

  let intent;
  try {
    intent = await loadGuestIntent(sessionId);
    if (!intent) throw new Error('No booking intent of this guest has this session');
  } catch (err) {
    return { outcome: unverified(err, sessionId), heroImageUrl: '' };
  }

  // Only the backdrop: never worth failing the page over.
  const [outcome, heroImageUrl] = await Promise.all([
    resolveIntentOutcome(intent, sessionId),
    loadHeroImageUrl(intent.propertyId).catch(() => ''),
  ]);
  return { outcome, heroImageUrl };
}

export default async function CheckoutReturnPage({ searchParams }: ReturnPageProps) {
  const { session_id: sessionId } = await searchParams;
  const { outcome, heroImageUrl } = await resolveOutcome(sessionId);
  const Icon = outcome.icon;

  return (
    <>
      <Backdrop heroImageUrl={heroImageUrl} />
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="space-y-5 rounded-lg border border-border bg-card p-8 shadow-sm">
          <Icon className={`size-8 ${outcome.tone}`} aria-hidden="true" />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">{outcome.title}</h1>
            <p className="text-sm text-muted-foreground">{outcome.body}</p>
          </div>
          <Button asChild className="w-full">
            <Link href={outcome.action.href}>{outcome.action.label}</Link>
          </Button>
        </div>
      </main>
    </>
  );
}

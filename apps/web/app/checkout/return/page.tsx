import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, XCircle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { stripe } from '@openbookings/stripe';
import { Button } from '@/components/ui/button';
import { describeDeclineCode } from '../_lib/errors';

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

const RETRY = { href: '/checkout', label: 'Try again' };
const DONE = { href: '/', label: 'Done' };

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

async function resolveOutcome(sessionId: string | undefined): Promise<Outcome> {
  if (!sessionId || !isSessionId(sessionId)) return OUTCOMES.unknown;

  let session;
  try {
    // The PaymentIntent carries `last_payment_error`, which is the only place
    // the reason for a decline survives once the guest is back on our page.
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });
  } catch (err) {
    // Stripe positively confirming there is no such Session is different from
    // Stripe being unreachable: the id is wrong, and there is no payment of
    // the guest's hanging in the balance to warn them about.
    if ((err as { code?: unknown })?.code === 'resource_missing') {
      return OUTCOMES.unknown;
    }

    // Everything else — a missing secret key, an outage, a timeout. In none of
    // those do we know what happened to the guest's money, so we must not
    // claim they weren't charged.
    Sentry.captureException(err, {
      tags: { area: 'checkout', stage: 'return' },
      extra: { sessionId },
    });
    console.error('[checkout/return]', err instanceof Error ? err.message : String(err));
    return OUTCOMES.unverified;
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

export default async function CheckoutReturnPage({ searchParams }: ReturnPageProps) {
  const { session_id: sessionId } = await searchParams;
  const outcome = await resolveOutcome(sessionId);
  const Icon = outcome.icon;

  return (
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
  );
}

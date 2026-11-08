import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, XCircle } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';
import { getPool, loadIntentBySession, type BookingIntent } from '@openbookings/db';
import { retrieveBookingCheckout } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Backdrop } from '../_components/Backdrop';
import { describeDeclineCode } from '../_lib/errors';
import {
  sessionOutcome,
  settledOutcome,
  UNKNOWN,
  UNVERIFIED,
  type OutcomeKind,
  type ReturnOutcome,
  type SessionView,
} from '../_lib/return-outcome';

export const dynamic = 'force-dynamic';

type ReturnPageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

const ICONS: Record<OutcomeKind, typeof CheckCircle2> = {
  paid: CheckCircle2,
  confirming: Clock,
  processing: Clock,
  failed: XCircle,
  expired: Clock,
  oversold: AlertTriangle,
  unverified: AlertTriangle,
  unknown: HelpCircle,
};

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

/** We could not find out what happened to the guest's money, so we must not claim they weren't charged. */
function unverified(err: unknown, sessionId: string): ReturnOutcome {
  Sentry.captureException(err, {
    tags: { area: 'checkout', stage: 'return' },
    extra: { sessionId },
  });
  console.error('[checkout/return]', err instanceof Error ? err.message : String(err));
  return UNVERIFIED;
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
 * Stripe's view of the session. The PaymentIntent carries
 * `last_payment_error`, the only place the reason for a decline survives once
 * the guest is back on our page. The session was created on the host's
 * connected account, so that is where it is looked up; the intent holds the
 * account its session was made on.
 */
async function loadSession(sessionId: string, accountId: string | null): Promise<SessionView> {
  if (!accountId) throw new Error('Booking intent has no payment account');
  try {
    const session = await retrieveBookingCheckout(sessionId, accountId);
    return {
      kind: 'found',
      status: session.status,
      paymentStatus: session.payment_status,
      declineReason: declineReason(session.payment_intent),
    };
  } catch (err) {
    // Stripe positively confirming there is no such session is different
    // from Stripe being unreachable.
    if ((err as { code?: unknown })?.code === 'resource_missing') return { kind: 'missing' };
    throw err;
  }
}

async function resolveIntentOutcome(intent: BookingIntent, sessionId: string): Promise<ReturnOutcome> {
  const settled = settledOutcome(intent);
  if (settled) return settled;

  let session;
  try {
    session = await loadSession(sessionId, intent.paymentAccountId);
  } catch (err) {
    // A missing secret key, an outage, a timeout.
    return unverified(err, sessionId);
  }

  const outcome = sessionOutcome(intent, session, `/checkout/return?session_id=${encodeURIComponent(sessionId)}`);
  if (outcome.kind === 'unverified' && session.kind === 'found') {
    Sentry.captureMessage(`Unhandled checkout session status: ${session.status}`, {
      level: 'warning',
      tags: { area: 'checkout', stage: 'return' },
      extra: { sessionId },
    });
  }
  return outcome;
}

async function resolveOutcome(sessionId: string | undefined): Promise<{ outcome: ReturnOutcome; heroImageUrl: string }> {
  if (!sessionId || !isSessionId(sessionId)) return { outcome: UNKNOWN, heroImageUrl: '' };

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
  const Icon = ICONS[outcome.kind];

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
            {/* A re-check is a full request: the page is read fresh from the intent. */}
            {outcome.action.reload ? (
              <a href={outcome.action.href}>{outcome.action.label}</a>
            ) : (
              <Link href={outcome.action.href}>{outcome.action.label}</Link>
            )}
          </Button>
        </div>
      </main>
    </>
  );
}

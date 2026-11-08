import * as Sentry from '@sentry/nextjs';
import { expireIntent, getPool, loadIntent } from '@openbookings/db';
import { expireBookingCheckout } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';

/**
 * The checkout countdown reached zero: end the hold and stop its payment
 * session. Only once the hold has really run out — the browser's clock is
 * not trusted to end it early.
 *
 * POST /api/booking-intents/[id]/expire → 200 { status }
 */
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession().catch(() => null);
  if (!session?.user?.id) return Response.json({ error: 'auth_required' }, { status: 401, headers: NO_STORE });

  const { id } = await ctx.params;
  try {
    const db = getPool();
    // Someone else's intent reads as not found.
    const intent = await loadIntent(db, { intentId: id, userId: session.user.id });
    if (!intent) return Response.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });

    const expired = await expireIntent(db, { intentId: intent.id, now: new Date() });
    if (expired?.sessionId && expired.accountId) {
      // Logged, not the guest's problem: the session lapses on its own, and a
      // payment on an expired intent is caught when it is confirmed.
      await expireBookingCheckout(expired.sessionId, expired.accountId).catch((err) => {
        Sentry.captureException(err, { tags: { area: 'booking-intents' }, extra: { intentId: intent.id } });
        console.error('[booking-intents] expire session', intent.id, err instanceof Error ? err.message : err);
      });
    }

    return Response.json({ status: expired ? 'expired' : intent.status }, { headers: NO_STORE });
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'booking-intents' }, extra: { intentId: id } });
    console.error('[booking-intents] expire', err instanceof Error ? err.message : err);
    return Response.json({ error: 'server_error' }, { status: 500, headers: NO_STORE });
  }
}

import * as Sentry from '@sentry/nextjs';
import { createBookingIntent, getPool, withTransaction } from '@openbookings/db';
import type { LifecycleDb } from '@openbookings/db/booking-lifecycle';
import { isTestingMode } from '@openbookings/demo';
import { expireBookingCheckout } from '@openbookings/stripe';
import { getServerSession } from '@/lib/auth';
import { parseIntentRequest } from '@/lib/booking/intent-request';
import { loadVisibleProperty, priceSelection } from '@/lib/booking/quote';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';

/**
 * "Book now": re-price the guest's selection on the server, hold the rooms for
 * HOLD_MINUTES in a booking intent, and send the guest to pay for it.
 *
 * POST /api/booking-intents { propertyId, checkIn, checkOut, rooms, expectedTotal }
 * → 201 { intentId, holdExpiresAt, checkoutUrl }
 * → 409 { error: 'price_changed', quote } when the total moved since the guest saw it
 * → 409 { error: 'unavailable', ... } when the rooms are gone
 */
export const dynamic = 'force-dynamic';

/** Pennies of rounding between what the page added up and what we did. */
const PRICE_TOLERANCE = 0.005;

const NO_STORE = { 'Cache-Control': 'no-store' };

const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE });

const poolDb: LifecycleDb = {
  query: (text, values) => getPool().query(text, values),
  transaction: (fn) => withTransaction((client) => fn(client)),
};

export async function POST(request: Request) {
  const session = await getServerSession().catch(() => null);
  if (!session?.user?.id) return json({ error: 'auth_required' }, 401);
  const userId = session.user.id;

  // Each intent locks rooms and may expire Stripe sessions: cheap to ask for,
  // not cheap to serve. A guest changing their mind a few times is fine.
  const byUser = checkRateLimit(`booking-intents:user:${userId}`, 20, 10 * 60 * 1000);
  const byIp = checkRateLimit(`booking-intents:ip:${getClientIP(request)}`, 60, 10 * 60 * 1000);
  if (!byUser.allowed || !byIp.allowed) return json({ error: 'rate_limited' }, 429);

  const parsed = parseIntentRequest(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: 'invalid_request', errors: parsed.errors }, 400);
  const body = parsed.value;

  const testing = isTestingMode();
  const now = new Date();
  try {
    const db = getPool();
    if (!(await loadVisibleProperty(db, { id: body.propertyId }, testing))) {
      return json({ error: 'not_found' }, 404);
    }

    const priced = await priceSelection(db, {
      propertyId: body.propertyId,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      selection: body.rooms,
      now,
      testing,
    });
    if (!priced.ok) {
      return json({ error: priced.error, detail: priced.detail }, priced.error === 'unavailable' ? 409 : 400);
    }
    if (Math.abs(body.expectedTotal - priced.snapshot.total) > PRICE_TOLERANCE) {
      return json({ error: 'price_changed', quote: priced.snapshot }, 409);
    }

    const created = await createBookingIntent(poolDb, {
      userId,
      propertyId: body.propertyId,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      rooms: priced.rooms,
      snapshot: priced.snapshot,
      now,
    });
    if (!created.ok) return json({ error: 'unavailable', roomIds: created.roomIds }, 409);

    // The guest's previous selection must not stay payable. A failure here is
    // logged, not the guest's problem: the session lapses on its own, and a
    // payment on an abandoned intent is caught when it is confirmed.
    await Promise.all(
      created.abandoned.map((s) =>
        expireBookingCheckout(s.sessionId, s.accountId).catch((err) => {
          Sentry.captureException(err, { tags: { area: 'booking-intents' }, extra: { intentId: s.intentId } });
          console.error('[booking-intents] expire abandoned session', s.intentId, err instanceof Error ? err.message : err);
        }),
      ),
    );

    return json(
      {
        intentId: created.intentId,
        holdExpiresAt: created.holdExpiresAt.toISOString(),
        checkoutUrl: `/checkout/${created.intentId}`,
      },
      201,
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'booking-intents' }, extra: { propertyId: body.propertyId } });
    console.error('[booking-intents]', err instanceof Error ? err.message : err);
    return json({ error: 'server_error' }, 500);
  }
}

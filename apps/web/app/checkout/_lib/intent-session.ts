import { attachPaymentSession, IntentNotOpenError, type Queryable } from '@openbookings/db';

/** A payment session as checkout needs it: enough to mount the form. */
export type PaymentSession = { id: string; clientSecret: string | null; expiresAt: number };

export type IntentSessionDeps = {
  /** One transaction, so the intent row stays locked from the check to the attach. */
  transaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
  /** Stripe's view of a session already made for the intent. */
  retrieve: (sessionId: string, accountId: string) => Promise<{ status: string | null; clientSecret: string | null; expiresAt: number }>;
  /** Makes a new session on `accountId` (the caller has the lines and metadata). */
  create: () => Promise<PaymentSession & { amountTotal: number }>;
  /** Stops a session from taking payment. Throws when Stripe could not be told. */
  expire: (sessionId: string, accountId: string) => Promise<void>;
  /** Records a failure that must not change the guest's answer. */
  report: (err: unknown, context: { sessionId: string }) => void;
};

/**
 * Why an intent gets no session. `already_paid` and `oversold` both mean the
 * guest was charged: neither may be answered as "nothing has been charged".
 */
export type IntentSessionRefusal = 'not_found' | 'hold_expired' | 'already_paid' | 'oversold';

export type IntentSessionResult =
  | { ok: true; session: PaymentSession; reused: boolean }
  | { ok: false; code: IntentSessionRefusal };

type LockedIntent = {
  status: string;
  hold_expires_at: Date;
  payment_session_id: string | null;
  payment_account_id: string | null;
};

/**
 * What an intent that is not open, or whose hold has run out, tells the
 * guest. Paid and oversold intents were charged; every other status was not.
 */
export function refusalFor(status: string): Exclude<IntentSessionRefusal, 'not_found'> {
  if (status === 'paid') return 'already_paid';
  if (status === 'oversold' || status === 'refunded_oversold') return 'oversold';
  return 'hold_expired';
}

/**
 * The one payable session of an open intent: the one it already has while
 * Stripe still says `open`, otherwise a new one recorded on the intent.
 *
 * Never two payable sessions. The intent row is locked `FOR UPDATE` for the
 * whole exchange, so two requests for the same intent (two tabs, React's
 * development double-mount) run one after the other and the second reuses the
 * first's session instead of making its own. An old session that cannot be
 * reused but may still take payment is expired before a new one is made; if
 * that fails, no new one is made. If the intent stopped being open anyway
 * before the attach, the session just made is expired before answering, or it
 * would stay payable with nothing holding the rooms.
 */
export async function openIntentSession(
  deps: IntentSessionDeps,
  i: { intentId: string; userId: string; accountId: string; now: Date },
): Promise<IntentSessionResult> {
  return deps.transaction(async (tx): Promise<IntentSessionResult> => {
    const { rows } = await tx.query(
      `SELECT status, hold_expires_at, payment_session_id, payment_account_id
       FROM booking_intents WHERE id = $1::uuid AND user_id = $2
       FOR UPDATE`,
      [i.intentId, i.userId],
    );
    const intent = rows[0] as LockedIntent | undefined;
    if (!intent) return { ok: false, code: 'not_found' };
    if (intent.status !== 'open') return { ok: false, code: refusalFor(intent.status) };
    if (intent.hold_expires_at.getTime() <= i.now.getTime()) return { ok: false, code: 'hold_expired' };

    if (intent.payment_session_id && intent.payment_account_id) {
      const existing = await deps.retrieve(intent.payment_session_id, intent.payment_account_id);
      if (existing.status === 'open' && existing.clientSecret) {
        return {
          ok: true,
          reused: true,
          session: { id: intent.payment_session_id, clientSecret: existing.clientSecret, expiresAt: existing.expiresAt },
        };
      }
      // Paid, and the webhook has not caught up yet: a new session would be a
      // second payment for the same rooms.
      if (existing.status === 'complete') return { ok: false, code: 'already_paid' };
      // Open but unusable here (no client secret): still payable, so it is
      // stopped before another is made. A failure throws, and nothing is made.
      if (existing.status === 'open') await deps.expire(intent.payment_session_id, intent.payment_account_id);
      // Expired: nothing can be paid on it, so a new one replaces it.
    }

    const created = await deps.create();
    try {
      await attachPaymentSession(tx, { intentId: i.intentId, sessionId: created.id, accountId: i.accountId, amountCents: created.amountTotal });
    } catch (err) {
      // Not recorded anywhere, so nothing else would ever stop it.
      await deps.expire(created.id, i.accountId).catch((expireErr) => deps.report(expireErr, { sessionId: created.id }));
      if (err instanceof IntentNotOpenError) return { ok: false, code: 'hold_expired' };
      throw err;
    }
    return { ok: true, reused: false, session: created };
  });
}

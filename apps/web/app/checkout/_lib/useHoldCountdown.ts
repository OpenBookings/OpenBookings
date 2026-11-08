'use client';

import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/nextjs';

/** `setTimeout` treats delays past this as zero and fires immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** The server ends a hold only once its own clock agrees; a browser clock running ahead gets a few more tries. */
const EXPIRE_RETRY_MS = 5_000;
const EXPIRE_ATTEMPTS = 3;

/**
 * Ends the hold on the server: the intent stops holding its rooms and its
 * payment session stops taking payment. Best effort — the hold ends on its
 * own clock either way, and a late payment is re-checked when it is confirmed.
 */
async function expireHold(intentId: string, attempt = 1): Promise<void> {
  try {
    const response = await fetch(`/api/booking-intents/${encodeURIComponent(intentId)}/expire`, {
      method: 'POST',
      // Still sent if the guest closes the tab on the notice.
      keepalive: true,
    });
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    // `open`: the server's clock says the hold has not run out yet.
    if (response.ok && body?.status === 'open' && attempt < EXPIRE_ATTEMPTS) {
      setTimeout(() => void expireHold(intentId, attempt + 1), EXPIRE_RETRY_MS);
    }
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: { area: 'checkout', stage: 'expire-hold' } });
  }
}

/**
 * Counts down to the end of the intent's hold and reports when it has lapsed,
 * ending it on the server at that moment.
 *
 * A guest who opens checkout and comes back later would otherwise fill in a
 * card for rooms that are no longer held. Timers are throttled in background
 * tabs and stop entirely while a laptop sleeps, so the wall clock is rechecked
 * whenever the tab becomes visible again rather than trusted to have fired.
 *
 * `open` false means the hold was already over when the page was rendered:
 * lapsed from the start, with nothing left to end.
 */
export function useHoldCountdown({
  intentId,
  holdExpiresAt,
  open,
}: {
  intentId: string;
  /** Unix milliseconds. */
  holdExpiresAt: number;
  open: boolean;
}): boolean {
  const [lapsed, setLapsed] = useState(!open);

  useEffect(() => {
    if (!open) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;

    const check = () => {
      if (ended) return;
      const remaining = holdExpiresAt - Date.now();
      if (remaining <= 0) {
        ended = true;
        void expireHold(intentId);
        setLapsed(true);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
    };

    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      ended = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [intentId, holdExpiresAt, open]);

  return lapsed;
}

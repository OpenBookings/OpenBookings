/**
 * When the analytics loader shows and how long it stays. It shows on every
 * page switch and period change, and stays at least HOLD_MS, even when the
 * figures arrive in 3 ms, so it never flashes. GRACE_MS would delay it so
 * fast loads skip it; it is 0 because the loader should always be seen
 * (decided 2026-11-09).
 */
export const GRACE_MS = 0;
export const HOLD_MS = 1000;
/** How long each line under the logo stays before the next one comes in. */
export const LINE_MS = 1800;

/** How much longer a loader that started at `startedAt` must stay up. 0 when it never became visible. */
export function holdRemaining(startedAt: number, now: number): number {
  const elapsed = now - startedAt;
  if (elapsed < GRACE_MS) return 0;
  return Math.max(0, GRACE_MS + HOLD_MS - elapsed);
}

/** Which line to show `elapsed` ms after the loader started. Counted from when it became visible; the last line stays. */
export function lineIndex(elapsed: number, count: number): number {
  const step = Math.floor(Math.max(0, elapsed - GRACE_MS) / LINE_MS);
  return Math.min(Math.max(count - 1, 0), step);
}

/** A loader that ended this recently handed over to whatever replaced it in the same commit. */
const HANDOVER_MS = 100;

/**
 * The route loader (loading.tsx) and the page content are different
 * components: when the data arrives, React swaps one for the other in a
 * single commit. The clock carries the loader's start time across that swap,
 * so the content can hold the loader up for the rest of the second, and a tab
 * clicked mid-load carries on the same animation instead of restarting it.
 */
export function createLoaderClock() {
  let startedAt: number | null = null;
  let endedAt: number | null = null;

  return {
    /** A route loader mounted. Returns its start time: the running one when another loader just made way for it. */
    begin(now: number): number {
      if (startedAt !== null && (endedAt === null || now - endedAt <= HANDOVER_MS)) {
        endedAt = null;
        return startedAt;
      }
      startedAt = now;
      endedAt = null;
      return now;
    },
    /** The route loader unmounted. */
    end(now: number): void {
      if (startedAt !== null) endedAt = now;
    },
    /** The page content mounted. Returns when the loader it replaced started, or null if none just did. */
    handover(now: number): number | null {
      const started = startedAt;
      const ended = endedAt;
      startedAt = null;
      endedAt = null;
      if (started === null) return null;
      if (ended !== null && now - ended > HANDOVER_MS) return null;
      return started;
    },
  };
}

/** One per browser tab. Only ever touched from effects, never during a server render. */
export const loaderClock = createLoaderClock();

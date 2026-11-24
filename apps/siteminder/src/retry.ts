/**
 * One retry schedule for everything the app sends (inbox batches to core, reservations to SiteMinder): wait 5, 15,
 * 30 and 60 s after the 1st to 4th failure, and 60 s after every later one (SiteMinder's integration requirements:
 * attempts at 0, 5, 15, 30, 60 s; guides_error-handling.md:248: then every minute).
 */
export const RETRY_SECONDS = [5, 15, 30, 60] as const;

/** Seconds to wait after the `attempts`-th failure in a row (1-based). */
export const retryDelaySeconds = (attempts: number): number => RETRY_SECONDS[Math.min(Math.max(attempts, 1), RETRY_SECONDS.length) - 1] as number;

/** Our own alert (not a hotel's) when something fails this many times in a row. */
export const ALERT_AFTER_FAILURES = 5;

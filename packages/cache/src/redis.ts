import { Redis } from "@upstash/redis";
import type { RedisLike } from "./types";

/**
 * How long any single Redis call may take before the caller gives up.
 *
 * This is a cache on a ~10ms hop, so a quarter of a second is already an
 * enormous allowance. The number that matters is not this one — it is that
 * there IS one.
 */
const DEADLINE_MS = Number(process.env.CACHE_REDIS_TIMEOUT_MS) || 250;

/**
 * Retry policy, overriding the SDK's default of 5 attempts backing off by
 * `Math.exp(i) * 50` — 50 + 136 + 369 + 1004 + 2730 ms, about 4.3 seconds of
 * sleeping before a failing call gives up, and roughly 8.6 seconds for a page
 * that fails both a read and a write.
 *
 * That default is reasonable for a queue and wrong for a read-through cache:
 * it makes a Redis outage far more expensive than having no cache at all,
 * which is precisely the failure this package promises it cannot have. One
 * retry covers a dropped packet; anything beyond that should fall through to
 * Postgres, which costs about 12ms.
 */
export const REDIS_RETRY_POLICY = {
  retries: 1,
  // The SDK passes the attempt index; the delay is deliberately flat, because
  // a second failure here means fall through to Postgres, not back off further.
  backoff: (_retryCount: number) => 50,
};

/**
 * Bound a promise by wall-clock time.
 *
 * Needed because the SDK takes `signal` at client construction, not per call,
 * so one `AbortSignal.timeout()` there would abort every later request through
 * that client. Racing per call is the only per-call deadline available.
 *
 * The underlying fetch is not cancelled, so a hung request still occupies a
 * socket until the runtime's own connect timeout fires. What this guarantees
 * is that no *caller* waits on it, which is the property the page needs.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`redis ${label} exceeded ${ms}ms`)),
      ms,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __upstashRedis: RedisLike | null | undefined;
}

/**
 * The shared Upstash client, or `null` when the process has no credentials.
 *
 * Pinned to `globalThis` for the same reason `packages/db` pins its pool: Next
 * re-evaluates modules across dev recompiles, and a per-module singleton would
 * quietly become one client per reload.
 *
 * `null` rather than a throw is what makes the cache optional. Local dev, CI,
 * and a production container whose variables have not been set yet all run the
 * loader directly, with no branching at any call site.
 *
 * `undefined` on the global means "not yet decided"; `null` means "decided: no
 * credentials". Without that distinction a null result would be recomputed on
 * every call, re-reading env forever.
 */
export function getRedis(): RedisLike | null {
  if (globalThis.__upstashRedis !== undefined) return globalThis.__upstashRedis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Half-configured counts as unconfigured: a client with one of the two would
  // 401 on every request, turning a config slip into a flood of reports.
  if (!url || !token) {
    globalThis.__upstashRedis = null;
    return null;
  }

  const client = new Redis({
    url,
    token,
    retry: REDIS_RETRY_POLICY,
    // The SDK reports platform and runtime headers upstream by default. This
    // is a cache, not a product analytics surface; opt out explicitly.
    enableTelemetry: false,
    // Upstash parses JSON on `get` by default, which would hand us objects in
    // production and strings from any fake. Owning the parsing keeps the two
    // identical and keeps the stored format something we chose.
    automaticDeserialization: false,
  });

  // Adapted rather than cast: the adapter is where a signature change in the
  // SDK shows up as a type error instead of a runtime surprise.
  // Every method carries its own deadline: the retry cap bounds the sleeping
  // between attempts, and this bounds the attempts themselves.
  globalThis.__upstashRedis = {
    get: (key) => withDeadline(client.get<string>(key), DEADLINE_MS, "get"),
    set: (key, value, opts) =>
      withDeadline(client.set(key, value, { ex: opts.ex }), DEADLINE_MS, "set"),
    del: (...keys) => withDeadline(client.del(...keys), DEADLINE_MS, "del"),
  };

  return globalThis.__upstashRedis;
}

/** Drops the memoised client so the next `getRedis()` re-reads the environment. */
export function resetRedisForTests(): void {
  globalThis.__upstashRedis = undefined;
}

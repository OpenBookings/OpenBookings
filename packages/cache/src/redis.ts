import { Redis } from "@upstash/redis";
import type { RedisLike } from "./types";

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
    // Upstash parses JSON on `get` by default, which would hand us objects in
    // production and strings from any fake. Owning the parsing keeps the two
    // identical and keeps the stored format something we chose.
    automaticDeserialization: false,
  });

  // Adapted rather than cast: the adapter is where a signature change in the
  // SDK shows up as a type error instead of a runtime surprise.
  globalThis.__upstashRedis = {
    get: (key) => client.get<string>(key),
    set: (key, value, opts) => client.set(key, value, { ex: opts.ex }),
    del: (...keys) => client.del(...keys),
  };

  return globalThis.__upstashRedis;
}

/** Drops the memoised client so the next `getRedis()` re-reads the environment. */
export function resetRedisForTests(): void {
  globalThis.__upstashRedis = undefined;
}

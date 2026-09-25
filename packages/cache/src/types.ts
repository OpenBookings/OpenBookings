/**
 * The slice of a Redis client this package uses.
 *
 * Narrow on purpose: it is the whole contract a test fake has to satisfy, and
 * it keeps `@upstash/redis` out of every signature so the store can be swapped
 * (or faked) without touching callers.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts: { ex: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

/**
 * What actually lives at a cache key.
 *
 * Two clocks: `freshUntil` is when we would rather ask the database again,
 * while the key's Redis TTL is much longer. The gap between them is the window
 * in which a stale copy is still available to absorb a database failure.
 */
export interface Envelope<T> {
  /** `null` is a cached *absence* — a slug we know has no active property. */
  data: T | null;
  /** Epoch milliseconds. */
  freshUntil: number;
}

export type CacheOutcome = "hit" | "stale" | "miss" | "negative" | "bypass";

export type CachePhase = "read" | "write" | "load" | "purge";

export interface CacheErrorContext {
  key: string;
  phase: CachePhase;
}

/**
 * How a caller learns something went wrong. The package deliberately does not
 * import Sentry: it has no business knowing which reporter an app uses, and a
 * framework-free package is testable without stubbing one.
 */
export type CacheReporter = (error: unknown, context: CacheErrorContext) => void;

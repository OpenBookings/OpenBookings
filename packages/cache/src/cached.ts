import { getRedis } from "./redis";
import type { CacheOutcome, CacheReporter, Envelope, RedisLike } from "./types";

export interface CachedOptions {
  /** How long the value is served without asking the loader. */
  freshSeconds: number;
  /** The key's Redis TTL. Longer than `freshSeconds`; the gap is the stale window. */
  maxAgeSeconds: number;
  /** Freshness for a cached absence. Defaults to `freshSeconds`. */
  missFreshSeconds?: number;
  /** Redis TTL for a cached absence. Defaults to its freshness — no stale window for a 404. */
  missMaxAgeSeconds?: number;
  onError?: CacheReporter;
  /** Injectable clock, so expiry is decided rather than waited for. */
  now?: () => number;
  /** Injectable store. Omit in production; pass a fake in tests, or `null` for no cache. */
  redis?: RedisLike | null;
  log?: (line: string) => void;
}

export interface PurgeOptions {
  onError?: CacheReporter;
  redis?: RedisLike | null;
  log?: (line: string) => void;
}

/**
 * Is this the shape we wrote?
 *
 * Anything else — a truncated write, a hand-run SET, an envelope from a
 * version we have since bumped past — is treated as absent rather than
 * trusted. The alternative is handing a guest a 500 because of a bad byte in a
 * cache we introduced to make the page *more* reliable.
 */
function isEnvelope(value: unknown): value is Envelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "freshUntil" in value &&
    typeof (value as { freshUntil: unknown }).freshUntil === "number"
  );
}

/**
 * Read-through cache with a stale-on-error fallback.
 *
 * The invariant that matters: this function fails the way the uncached code
 * would, never worse. Every Redis interaction is wrapped, and the loader's
 * result is returned whatever the cache did. A cache outage costs the latency
 * it was saving and nothing else.
 *
 * `null` from the loader means "no such row" and is cached as a negative entry,
 * so a crawler walking invented slugs does not run the loader for every 404.
 * That is why the return type admits null rather than the loader's `T`.
 */
export async function cached<T>(
  key: string,
  loader: () => Promise<T | null>,
  opts: CachedOptions,
): Promise<T | null> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  const report = opts.onError;
  // `undefined` means "use the shared client"; an explicit `null` means "no
  // cache". Distinguishing them is what lets a test force the bypass path.
  const redis = opts.redis !== undefined ? opts.redis : getRedis();

  const emit = (outcome: CacheOutcome, startedAt: number | null) => {
    const took = startedAt === null ? "" : ` loader_ms=${Math.round(now() - startedAt)}`;
    log(`[cache] outcome=${outcome} key=${key}${took}`);
  };

  if (!redis) {
    const startedAt = now();
    const data = await loader();
    emit("bypass", startedAt);
    return data;
  }

  let envelope: Envelope<T> | null = null;
  try {
    const raw = await redis.get(key);
    if (raw !== null && raw !== undefined) {
      const parsed: unknown = JSON.parse(raw);
      if (isEnvelope(parsed)) envelope = parsed as Envelope<T>;
    }
  } catch (error) {
    // Unreachable store, or a value we cannot use. Same consequence either way.
    report?.(error, { key, phase: "read" });
  }

  if (envelope && now() < envelope.freshUntil) {
    emit(envelope.data === null ? "negative" : "hit", null);
    return envelope.data;
  }

  const startedAt = now();
  let data: T | null;
  try {
    data = await loader();
  } catch (error) {
    // The stale window earns its keep here: past freshness we asked the
    // database, and the database is the thing that is broken.
    if (envelope) {
      report?.(error, { key, phase: "load" });
      emit("stale", startedAt);
      return envelope.data;
    }
    throw error;
  }

  const isAbsent = data === null;
  const fresh = isAbsent ? (opts.missFreshSeconds ?? opts.freshSeconds) : opts.freshSeconds;
  const maxAge = isAbsent ? (opts.missMaxAgeSeconds ?? fresh) : opts.maxAgeSeconds;

  try {
    const next: Envelope<T> = { data, freshUntil: now() + fresh * 1000 };
    await redis.set(key, JSON.stringify(next), { ex: maxAge });
  } catch (error) {
    // An oversized payload, a quota, a blip. The caller already has its data.
    report?.(error, { key, phase: "write" });
  }

  emit(envelope ? "stale" : "miss", startedAt);
  return data;
}

/**
 * Delete cache keys. Best-effort by contract.
 *
 * Callers are write paths that have already succeeded — a host's property has
 * been saved by the time we get here. Throwing would turn "the cache is
 * unreachable" into "your save failed", which is a strictly worse outcome than
 * a page that stays stale until its TTL expires.
 *
 * This deletes rather than marking stale, which forfeits the stale-on-error
 * fallback for that key until something repopulates it. That is deliberate:
 * after an edit the old copy is known-wrong, and serving known-wrong content
 * to survive a database outage is the worse of the two failures.
 */
export async function purge(keys: string[], opts: PurgeOptions = {}): Promise<void> {
  if (keys.length === 0) return;

  const redis = opts.redis !== undefined ? opts.redis : getRedis();
  if (!redis) return;

  const log = opts.log ?? ((line: string) => console.log(line));
  try {
    await redis.del(...keys);
    log(`[cache] outcome=purge keys=${keys.length}`);
  } catch (error) {
    opts.onError?.(error, { key: keys.join(","), phase: "purge" });
  }
}

# Upstash Redis Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/p/[hotel_slug]` in `apps/web` from Upstash Redis instead of three Postgres queries per request, with explicit purging from every `apps/business` write that changes what the page renders.

**Architecture:** A new dependency-free-ish workspace package `packages/cache` owns the mechanism: an `@upstash/redis` singleton, a read-through `cached()` helper with stale-on-error fallback, `purge()`, and the key builder both apps share. `apps/web` wraps its three existing queries in one `getHotelPage(slug)` call. `apps/business` calls `purgePropertyPage()` at four write sites. Nothing in the rendered output changes.

**Tech Stack:** TypeScript, Bun (test runner and package manager), Next.js 16, `@upstash/redis` (HTTP/REST client), Drizzle + `pg`, Sentry.

**Spec:** `docs/superpowers/specs/2026-09-25-upstash-redis-caching-design.md`

## Global Constraints

- **Key format is `ob:v1:prop-page:<slug>`.** `v1` is a payload-shape version; changing the payload shape means bumping that constant, never migrating or flushing.
- **The cache must never be able to break the page.** Every Redis failure — unreachable, corrupt value, failed write, quota — is caught, reported, and falls through to Postgres. A cache outage degrades to current behaviour.
- **A purge failure must never fail a host's save.** Purging is best-effort inside an already-successful write path.
- **`getRedis()` returns `null` when `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` is absent**, and `cached()` then just runs the loader. Local dev and CI work uncached with no branching at call sites.
- **No test talks to a real Redis or a real Postgres.** Every test in this plan uses an injected fake. CI needs no new secrets and no new service.
- **The client is constructed with `automaticDeserialization: false`.** Upstash's client parses JSON on `get` by default, which would make the test fake (returning strings) diverge from production (returning objects). We store and read strings and own the parsing.
- **Default TTLs:** fresh 3600s (`CACHE_TTL_PROPERTY_PAGE_S`), physical 86400s (`CACHE_MAX_AGE_PROPERTY_PAGE_S`), negative 60s (`CACHE_TTL_PROPERTY_PAGE_MISS_S`).
- **Logging is `console.log` for outcomes, Sentry for errors** — by decision, so the first deploy's real hit ratio informs the eventual Sentry instrumentation instead of guessing it now.
- **Existing style:** tests use `import { describe, expect, test } from "bun:test"` and colocate as `*.test.ts`; packages expose `"exports": { ".": "./src/index.ts" }` and extend `@openbookings/config/tsconfig.base.json`; comments explain *why*, not *what*.

## Review Focus

Five things the spec implies but which no task's happy path would exercise. Each has a test assigned to the task that owns the code.

1. **Slug case mismatch between read and purge.** `apps/web` lowercases the URL segment; `apps/business` purges using the `slug` column verbatim. If those disagree in case, every purge silently misses and hosts see stale pages forever. → `propertyPageKey` normalises; test in Task 1.
2. **A corrupt or foreign value at the key.** A truncated write, a hand-run `SET`, or an older envelope shape must behave as "no usable entry" and fall through to Postgres — never throw a 500 at a guest. → tests in Task 2.
3. **A failed write, including an oversized payload.** Upstash enforces a maximum record size; a property with twenty gallery images and many rooms is the plausible offender. A rejected `SET` must still return the freshly loaded data. → test in Task 2.
4. **Purging a property or room that no longer exists.** The id lookup returns no row. This runs inside a host's save action, so it must return quietly rather than throw and fail the save. → test in Task 4.
5. **A cached absence versus an absent key.** Both look falsy. Conflating them either re-queries Postgres for every 404 (losing the negative cache) or returns `null` for keys that were merely missing. → tests in Task 2.

---

### Task 1: `packages/cache` scaffold, client singleton, and key builder

**Files:**
- Create: `packages/cache/package.json`
- Create: `packages/cache/tsconfig.json`
- Create: `packages/cache/src/types.ts`
- Create: `packages/cache/src/keys.ts`
- Create: `packages/cache/src/redis.ts`
- Create: `packages/cache/src/index.ts`
- Test: `packages/cache/src/keys.test.ts`
- Test: `packages/cache/src/redis.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RedisLike { get(key: string): Promise<string | null>; set(key: string, value: string, opts: { ex: number }): Promise<unknown>; del(...keys: string[]): Promise<unknown>; }`
  - `interface Envelope<T> { data: T | null; freshUntil: number }`
  - `type CacheOutcome = "hit" | "stale" | "miss" | "negative" | "bypass"`
  - `type CachePhase = "read" | "write" | "load" | "purge"`
  - `interface CacheErrorContext { key: string; phase: CachePhase }`
  - `type CacheReporter = (error: unknown, context: CacheErrorContext) => void`
  - `const CACHE_SCHEMA_VERSION = "v1"`
  - `function propertyPageKey(slug: string): string`
  - `function getRedis(): RedisLike | null`
  - `function resetRedisForTests(): void`

- [ ] **Step 1: Create the package manifest and tsconfig**

`packages/cache/package.json`:

```json
{
  "name": "@openbookings/cache",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@upstash/redis": "^1.36.0"
  },
  "devDependencies": {
    "@openbookings/config": "workspace:*",
    "@types/bun": "^1.3.14",
    "typescript": "^5.9.3"
  }
}
```

`packages/cache/tsconfig.json`:

```json
{
  "extends": "@openbookings/config/tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 2: Install the dependency**

Run from the repo root: `bun install`

Expected: `node_modules/@upstash/redis` exists. Verify with `ls -d node_modules/@upstash/redis`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
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
```

- [ ] **Step 4: Write the failing test for the key builder**

`packages/cache/src/keys.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { CACHE_SCHEMA_VERSION, propertyPageKey } from "./keys";

describe("propertyPageKey", () => {
  test("uses the ob:<version>:prop-page:<slug> shape", () => {
    expect(propertyPageKey("terme-di-saturnia")).toBe("ob:v1:prop-page:terme-di-saturnia");
  });

  /**
   * The read side lowercases the URL segment (`page.tsx` does `.toLowerCase()`)
   * while the purge side passes the `slug` column verbatim. If those two ever
   * disagree in case, every purge misses its key and hosts see a stale page
   * until the TTL expires — a silent, hours-long bug. Normalising in one place
   * is what makes the two callers agree by construction.
   */
  test("normalises case, so the reader and the purger agree", () => {
    expect(propertyPageKey("Terme-Di-Saturnia")).toBe(propertyPageKey("terme-di-saturnia"));
  });

  test("carries the schema version, so a shape change orphans old entries", () => {
    expect(propertyPageKey("x")).toContain(`:${CACHE_SCHEMA_VERSION}:`);
  });
});
```

- [ ] **Step 5: Run it to make sure it fails**

Run: `cd packages/cache && bun test src/keys.test.ts`
Expected: FAIL — cannot resolve `./keys`.

- [ ] **Step 6: Write `src/keys.ts`**

```ts
/**
 * The *payload shape* version, not an API version.
 *
 * Bump it when the cached value's shape changes. Every old entry is then
 * orphaned and expires on its own TTL, so a shape change is a deploy rather
 * than a migration or a manual flush — and there is never a window in which
 * new code parses an old-shaped value.
 */
export const CACHE_SCHEMA_VERSION = "v1";

/**
 * The key for one property's public listing page.
 *
 * Exported from this package, rather than spelled out at each call site,
 * because `apps/web` reads this key and `apps/business` deletes it. Two string
 * literals in two apps is exactly the kind of thing that drifts.
 *
 * The slug is lowercased because the two sides arrive at it differently: the
 * web page lowercases the URL segment, the business app reads the `slug`
 * column. Normalising here means they cannot disagree.
 */
export function propertyPageKey(slug: string): string {
  return `ob:${CACHE_SCHEMA_VERSION}:prop-page:${slug.toLowerCase()}`;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd packages/cache && bun test src/keys.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Write the failing test for `getRedis()`**

`packages/cache/src/redis.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getRedis, resetRedisForTests } from "./redis";

const URL_VAR = "UPSTASH_REDIS_REST_URL";
const TOKEN_VAR = "UPSTASH_REDIS_REST_TOKEN";

let savedUrl: string | undefined;
let savedToken: string | undefined;

beforeEach(() => {
  savedUrl = process.env[URL_VAR];
  savedToken = process.env[TOKEN_VAR];
  resetRedisForTests();
});

afterEach(() => {
  if (savedUrl === undefined) delete process.env[URL_VAR];
  else process.env[URL_VAR] = savedUrl;
  if (savedToken === undefined) delete process.env[TOKEN_VAR];
  else process.env[TOKEN_VAR] = savedToken;
  resetRedisForTests();
});

describe("getRedis", () => {
  test("returns null when neither variable is set", () => {
    delete process.env[URL_VAR];
    delete process.env[TOKEN_VAR];
    expect(getRedis()).toBeNull();
  });

  /**
   * Half-configured is a real deployment state — someone sets the URL and
   * forgets the token. Returning a client that 401s on every request would
   * turn a config slip into a stream of Sentry noise; returning null makes it
   * behave exactly like "no cache configured".
   */
  test("returns null when only the URL is set", () => {
    process.env[URL_VAR] = "https://example.upstash.io";
    delete process.env[TOKEN_VAR];
    expect(getRedis()).toBeNull();
  });

  test("returns null when only the token is set", () => {
    delete process.env[URL_VAR];
    process.env[TOKEN_VAR] = "token";
    expect(getRedis()).toBeNull();
  });

  test("builds a client when both are set, and memoises it", () => {
    process.env[URL_VAR] = "https://example.upstash.io";
    process.env[TOKEN_VAR] = "token";
    const first = getRedis();
    expect(first).not.toBeNull();
    expect(getRedis()).toBe(first);
  });

  /**
   * Env is read per call rather than at module load, so a process that learns
   * its configuration late (or a test that changes it) is not stuck with the
   * answer computed at import time.
   */
  test("re-reads env after a reset", () => {
    delete process.env[URL_VAR];
    delete process.env[TOKEN_VAR];
    expect(getRedis()).toBeNull();

    process.env[URL_VAR] = "https://example.upstash.io";
    process.env[TOKEN_VAR] = "token";
    resetRedisForTests();
    expect(getRedis()).not.toBeNull();
  });
});
```

- [ ] **Step 9: Run it to make sure it fails**

Run: `cd packages/cache && bun test src/redis.test.ts`
Expected: FAIL — cannot resolve `./redis`.

- [ ] **Step 10: Write `src/redis.ts`**

```ts
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
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `cd packages/cache && bun test src/redis.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 12: Write `src/index.ts`**

```ts
export { CACHE_SCHEMA_VERSION, propertyPageKey } from "./keys";
export { getRedis, resetRedisForTests } from "./redis";
export type {
  CacheErrorContext,
  CacheOutcome,
  CachePhase,
  CacheReporter,
  Envelope,
  RedisLike,
} from "./types";
```

- [ ] **Step 13: Typecheck and run the whole package suite**

Run: `cd packages/cache && bun run typecheck && bun test`
Expected: no type errors; 8 tests pass.

- [ ] **Step 14: Commit**

```bash
git add packages/cache bun.lock package.json
git commit -m "Add a cache package with an optional Upstash client

The client is optional by design: getRedis() returns null when the
credentials are absent, so local dev, CI and an unconfigured container all
run uncached with no branching at any call site. Half-configured counts as
unconfigured, because a client holding one of the two values would 401 on
every request and turn a config slip into a flood of reports.

propertyPageKey lives here rather than at its two call sites because
apps/web reads the key and apps/business deletes it, and the slug reaches
those two sides by different routes -- a lowercased URL segment on one, the
slug column on the other. Normalising in one place is what stops a
case mismatch turning every purge into a silent no-op."
```

---

### Task 2: The `cached()` read-through helper and `purge()`

**Files:**
- Create: `packages/cache/src/cached.ts`
- Modify: `packages/cache/src/index.ts`
- Test: `packages/cache/src/cached.test.ts`

**Interfaces:**
- Consumes: `RedisLike`, `Envelope`, `CacheOutcome`, `CachePhase`, `CacheReporter` from `./types`; `getRedis` from `./redis`.
- Produces:
  - `interface CachedOptions { freshSeconds: number; maxAgeSeconds: number; missFreshSeconds?: number; missMaxAgeSeconds?: number; onError?: CacheReporter; now?: () => number; redis?: RedisLike | null; log?: (line: string) => void }`
  - `function cached<T>(key: string, loader: () => Promise<T | null>, opts: CachedOptions): Promise<T | null>`
  - `interface PurgeOptions { onError?: CacheReporter; redis?: RedisLike | null; log?: (line: string) => void }`
  - `function purge(keys: string[], opts?: PurgeOptions): Promise<void>`

- [ ] **Step 1: Write the failing test file**

`packages/cache/src/cached.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { cached, purge } from "./cached";
import type { RedisLike } from "./types";

/**
 * A fake store with an explicit clock, so expiry is decided by the test rather
 * than by waiting. It speaks the same string-in/string-out contract as the
 * real adapter, which is the point of `automaticDeserialization: false`.
 */
function fakeRedis(seed: Record<string, string> = {}) {
  const store = new Map<string, { value: string; expiresAt: number }>(
    Object.entries(seed).map(([k, v]) => [k, { value: v, expiresAt: Infinity }]),
  );
  const calls = { get: 0, set: 0, del: 0 };
  const redis: RedisLike = {
    async get(key) {
      calls.get++;
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, opts) {
      calls.set++;
      store.set(key, { value, expiresAt: Date.now() + opts.ex * 1000 });
      return "OK";
    },
    async del(...keys) {
      calls.del++;
      let n = 0;
      for (const key of keys) if (store.delete(key)) n++;
      return n;
    },
  };
  return { redis, store, calls };
}

const envelope = (data: unknown, freshUntil: number) => JSON.stringify({ data, freshUntil });

const TTL = { freshSeconds: 60, maxAgeSeconds: 600 };
const silent = { log: () => {} };

describe("cached", () => {
  test("a fresh hit returns the cached value and never calls the loader", async () => {
    const { redis } = fakeRedis({ k: envelope({ n: 1 }, 2_000) });
    let loaderCalls = 0;

    const result = await cached<{ n: number }>(
      "k",
      async () => {
        loaderCalls++;
        return { n: 2 };
      },
      { ...TTL, ...silent, redis, now: () => 1_000 },
    );

    expect(result).toEqual({ n: 1 });
    expect(loaderCalls).toBe(0);
  });

  test("a miss runs the loader and writes the envelope through", async () => {
    const { redis, store, calls } = fakeRedis();

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
    });

    expect(result).toEqual({ n: 2 });
    expect(calls.set).toBe(1);
    expect(JSON.parse(store.get("k")!.value)).toEqual({ data: { n: 2 }, freshUntil: 61_000 });
  });

  test("a stale hit refreshes from the loader and writes through", async () => {
    const { redis, store } = fakeRedis({ k: envelope({ n: 1 }, 500) });

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
    });

    expect(result).toEqual({ n: 2 });
    expect(JSON.parse(store.get("k")!.value).data).toEqual({ n: 2 });
  });

  /**
   * The resilience goal, and the only reason the two TTLs differ. Past
   * freshness we ask the database; if the database is the thing that is broken,
   * a slightly old page beats an error page.
   */
  test("a stale hit whose loader throws serves the stale copy and reports", async () => {
    const { redis } = fakeRedis({ k: envelope({ n: 1 }, 500) });
    const reported: string[] = [];

    const result = await cached<{ n: number }>(
      "k",
      async () => {
        throw new Error("neon is cold");
      },
      {
        ...TTL,
        ...silent,
        redis,
        now: () => 1_000,
        onError: (_error, ctx) => reported.push(ctx.phase),
      },
    );

    expect(result).toEqual({ n: 1 });
    expect(reported).toEqual(["load"]);
  });

  test("a loader that throws with nothing cached propagates the error", async () => {
    const { redis } = fakeRedis();

    await expect(
      cached("k", async () => {
        throw new Error("neon is cold");
      }, { ...TTL, ...silent, redis, now: () => 1_000 }),
    ).rejects.toThrow("neon is cold");
  });

  test("with no store configured it runs the loader directly", async () => {
    let loaderCalls = 0;

    const result = await cached<{ n: number }>(
      "k",
      async () => {
        loaderCalls++;
        return { n: 2 };
      },
      { ...TTL, ...silent, redis: null, now: () => 1_000 },
    );

    expect(result).toEqual({ n: 2 });
    expect(loaderCalls).toBe(1);
  });

  test("a read that throws falls through to the loader and reports", async () => {
    const { redis } = fakeRedis();
    redis.get = async () => {
      throw new Error("upstash unreachable");
    };
    const reported: string[] = [];

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
      onError: (_error, ctx) => reported.push(ctx.phase),
    });

    expect(result).toEqual({ n: 2 });
    expect(reported).toEqual(["read"]);
  });

  /**
   * Review Focus 3. Upstash caps record size, and a property with twenty
   * gallery images and a long room list is the plausible offender. A rejected
   * write must cost us the caching, not the page.
   */
  test("a write that throws still returns the loaded data, and reports", async () => {
    const { redis } = fakeRedis();
    redis.set = async () => {
      throw new Error("max request size exceeded");
    };
    const reported: string[] = [];

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
      onError: (_error, ctx) => reported.push(ctx.phase),
    });

    expect(result).toEqual({ n: 2 });
    expect(reported).toEqual(["write"]);
  });

  /**
   * Review Focus 2. A truncated write, a hand-run SET, or an envelope from a
   * shape we no longer use. All three mean the same thing: no usable entry.
   * None of them may reach a guest as a 500.
   */
  test("an unparseable value is treated as a miss, not an error", async () => {
    const { redis } = fakeRedis({ k: "{not json" });
    const reported: string[] = [];

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
      onError: (_error, ctx) => reported.push(ctx.phase),
    });

    expect(result).toEqual({ n: 2 });
    expect(reported).toEqual(["read"]);
  });

  test("a value that parses but is not an envelope is treated as a miss", async () => {
    const { redis } = fakeRedis({ k: JSON.stringify({ hotel: "no envelope here" }) });

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
    });

    expect(result).toEqual({ n: 2 });
  });

  test("an envelope with a non-numeric freshUntil is treated as a miss", async () => {
    const { redis } = fakeRedis({ k: JSON.stringify({ data: { n: 1 }, freshUntil: "soon" }) });

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
    });

    expect(result).toEqual({ n: 2 });
  });

  /**
   * Review Focus 5, both directions. A cached absence and an absent key are
   * both falsy, and conflating them either re-queries Postgres for every 404
   * or invents 404s for keys that were merely missing.
   */
  test("a fresh negative entry returns null without calling the loader", async () => {
    const { redis } = fakeRedis({ k: envelope(null, 2_000) });
    let loaderCalls = 0;

    const result = await cached<{ n: number }>(
      "k",
      async () => {
        loaderCalls++;
        return { n: 2 };
      },
      { ...TTL, ...silent, redis, now: () => 1_000 },
    );

    expect(result).toBeNull();
    expect(loaderCalls).toBe(0);
  });

  test("a loader returning null is cached with the shorter negative TTL", async () => {
    const { redis, store } = fakeRedis();

    const result = await cached<{ n: number }>("k", async () => null, {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
      missFreshSeconds: 10,
    });

    expect(result).toBeNull();
    expect(JSON.parse(store.get("k")!.value)).toEqual({ data: null, freshUntil: 11_000 });
  });

  test("logs one line per resolution, naming the outcome", async () => {
    const { redis } = fakeRedis({ k: envelope({ n: 1 }, 2_000) });
    const lines: string[] = [];

    await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      redis,
      now: () => 1_000,
      log: (line) => lines.push(line),
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("outcome=hit");
    expect(lines[0]).toContain("key=k");
  });
});

describe("purge", () => {
  test("deletes the given keys", async () => {
    const { redis, store } = fakeRedis({ a: envelope({ n: 1 }, 2_000), b: envelope({ n: 2 }, 2_000) });

    await purge(["a"], { redis, ...silent });

    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(true);
  });

  test("does nothing, and touches no store, for an empty key list", async () => {
    const { redis, calls } = fakeRedis();
    await purge([], { redis, ...silent });
    expect(calls.del).toBe(0);
  });

  test("is a no-op when no store is configured", async () => {
    await purge(["a"], { redis: null, ...silent });
  });

  /**
   * purge() runs inside a host's save. A Redis failure there must not become a
   * failed save, so it reports and returns rather than throwing.
   */
  test("swallows and reports a delete failure", async () => {
    const { redis } = fakeRedis();
    redis.del = async () => {
      throw new Error("upstash unreachable");
    };
    const reported: string[] = [];

    await purge(["a"], { redis, ...silent, onError: (_e, ctx) => reported.push(ctx.phase) });

    expect(reported).toEqual(["purge"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd packages/cache && bun test src/cached.test.ts`
Expected: FAIL — cannot resolve `./cached`.

- [ ] **Step 3: Write `src/cached.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/cache && bun test src/cached.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Export the new surface from `src/index.ts`**

Replace the contents of `packages/cache/src/index.ts`:

```ts
export { cached, purge } from "./cached";
export type { CachedOptions, PurgeOptions } from "./cached";
export { CACHE_SCHEMA_VERSION, propertyPageKey } from "./keys";
export { getRedis, resetRedisForTests } from "./redis";
export type {
  CacheErrorContext,
  CacheOutcome,
  CachePhase,
  CacheReporter,
  Envelope,
  RedisLike,
} from "./types";
```

- [ ] **Step 6: Typecheck and run the whole package suite**

Run: `cd packages/cache && bun run typecheck && bun test`
Expected: no type errors; 26 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/cache
git commit -m "Add a read-through cache helper that cannot break its caller

The invariant is that cached() fails the way the uncached code would and
never worse: an unreachable store, an unparseable value, an envelope from a
shape we have moved past, and a rejected write all fall through to the
loader with a report. A cache introduced to make the page faster and more
reliable must not be able to turn a bad byte into a 500.

Two TTLs, because they answer different questions. freshUntil is when we
would rather ask the database again; the key's Redis TTL is much longer, and
the gap is a window in which a stale copy can absorb a Neon cold start
instead of showing an error page.

A null loader result is cached as an absence, so a crawler walking invented
slugs does not run three queries per 404 forever. purge() deletes rather
than marking stale and swallows its failures: it runs inside a host's save,
where throwing would turn an unreachable cache into a failed save."
```

---

### Task 3: Read the page through the cache

**Files:**
- Create: `apps/web/lib/hotel-page-data.ts`
- Test: `apps/web/lib/hotel-page-data.test.ts`
- Modify: `apps/web/package.json` (add the `@openbookings/cache` dependency)
- Modify: `apps/web/app/p/[hotel_slug]/page.tsx` (lines 1–14 imports, 16–65 query builders, 67–90 the data fetch)

**Interfaces:**
- Consumes: `cached`, `propertyPageKey` from `@openbookings/cache`; `buildHeroQuery`, `HotelPageData` from `./hotel-page-query`; `DbRoom` from the page's `_components/constants`.
- Produces:
  - `interface RawAmenity { label: string; icon: string; category: string; sort_order: number }`
  - `interface PropertyPagePayload { hotel: HotelPageData; amenities: RawAmenity[]; rooms: DbRoom[] }`
  - `function getHotelPage(slug: string): Promise<PropertyPagePayload | null>`
  - `const PROPERTY_PAGE_TTL: { freshSeconds: number; maxAgeSeconds: number; missFreshSeconds: number }`

- [ ] **Step 1: Add the dependency**

In `apps/web/package.json`, add to `"dependencies"`, keeping the existing alphabetical grouping of `@openbookings/*` entries:

```json
    "@openbookings/cache": "workspace:*",
```

It goes immediately after `"@openbookings/auth": "workspace:*",` and before `"@openbookings/db": "workspace:*",`.

Then run from the repo root: `bun install`

- [ ] **Step 2: Write the failing test**

`apps/web/lib/hotel-page-data.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { PROPERTY_PAGE_TTL, type PropertyPagePayload } from "./hotel-page-data";

/**
 * A payload shaped like a real row set, including the fields most likely to
 * break a JSON round trip if a future query changes: the `to_char` times, the
 * numeric coordinates, and the nested JSON aggregates.
 */
const fixture: PropertyPagePayload = {
  hotel: {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Terme di Saturnia",
    subtitle: "Thermal springs",
    hero_image_url: "https://cdn.example/hero.jpg",
    logo_image_url: null,
    gallery_images: [{ url: "https://cdn.example/1.jpg", alt_text: null }],
    lat: 42.6584,
    lon: 11.5041,
    address_line_1: "Via della Follonata",
    address_line_2: null,
    postal_code: "58014",
    city: "Saturnia",
    country: "IT",
    check_in_time: "15:00",
    check_in_until: null,
    check_out_time: "11:00",
    overview_headline: null,
    overview_description: null,
    location_about: null,
    cta_headline: null,
    cta_body: null,
    fine_print: null,
    reception_24h: null,
    free_cancellation_days: null,
    prepayment_required: null,
    children_welcome: null,
    min_check_in_age: null,
    cot_policy: null,
    cot_fee: null,
    extra_bed_fee: null,
    pets_allowed: null,
    payment_methods: [
      { code: "visa", label: "Visa", artwork_url: "https://cdn.example/visa.svg", note: null },
    ],
    legal_company_name: null,
    contact_email: null,
    contact_phone: null,
    company_registration: null,
    vat_number: null,
    highlights: [{ label: "Springs", icon: "droplet", distance: "50 m" }],
  },
  amenities: [{ label: "Wi-Fi", icon: "wifi", category: "General", sort_order: 1 }],
  rooms: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Deluxe",
      description: null,
      room_type: "double",
      bed_type: "king",
      size_sqm: 32,
      max_occupancy: 2,
      images: ["https://cdn.example/room.jpg"],
      rate_plans: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          name: "Flexible",
          bar: 240,
          currency: "EUR",
        },
      ],
      tags: ["Balcony"],
    } as PropertyPagePayload["rooms"][number],
  ],
};

describe("PropertyPagePayload", () => {
  /**
   * The cache stores JSON, so the payload must survive a round trip with no
   * custom reviver. It does today only because every timestamp leaves Postgres
   * as a `to_char` string. A future SELECT that adds a bare timestamptz would
   * start handing callers strings where they expect Date objects, and this is
   * the test that says so before production does.
   */
  test("survives a JSON round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });

  test("contains no Date instances, which JSON would silently stringify", () => {
    const seen: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (value instanceof Date) seen.push(path);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(fixture, "payload");
    expect(seen).toEqual([]);
  });
});

describe("PROPERTY_PAGE_TTL", () => {
  test("keeps a stale window, so a database outage has something to serve", () => {
    expect(PROPERTY_PAGE_TTL.maxAgeSeconds).toBeGreaterThan(PROPERTY_PAGE_TTL.freshSeconds);
  });

  test("caches an absence far more briefly than a hit", () => {
    expect(PROPERTY_PAGE_TTL.missFreshSeconds).toBeLessThan(PROPERTY_PAGE_TTL.freshSeconds);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apps/web && bun test lib/hotel-page-data.test.ts`
Expected: FAIL — cannot resolve `./hotel-page-data`.

- [ ] **Step 4: Write `apps/web/lib/hotel-page-data.ts`**

The two query builders move here from `page.tsx` verbatim. They stay out of
`hotel-page-query.ts` because that file exists to be *shared* with
`/api/query/pr`, and these two have exactly one consumer.

```ts
import * as Sentry from "@sentry/nextjs";
import { cached, propertyPageKey } from "@openbookings/cache";
import { getDb, sql } from "@openbookings/db";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
import { buildHeroQuery, type HotelPageData } from "./hotel-page-query";

/** One `amenities` row as the page groups it; the grouping itself stays in the page. */
export interface RawAmenity {
  label: string;
  icon: string;
  category: string;
  sort_order: number;
}

/**
 * Everything the listing page needs, in one cacheable value.
 *
 * The three query results are stored verbatim rather than pre-shaped. The
 * page's amenity grouping is presentational and cheap, and caching its output
 * would tie the cached shape to a rendering decision.
 */
export interface PropertyPagePayload {
  hotel: HotelPageData;
  amenities: RawAmenity[];
  rooms: DbRoom[];
}

/**
 * Freshness is an hour rather than a minute because every write that changes
 * this page purges the key (see apps/business/lib/purge-property-page.ts), so
 * the TTL is a backstop, not the invalidation mechanism.
 *
 * The physical TTL is a day: the gap above freshness is the window in which a
 * stale copy can absorb a Neon cold start instead of erroring.
 *
 * An absence is cached for a minute only. It exists to stop a crawler walking
 * invented slugs from running three queries per 404, not to remember 404s.
 */
export const PROPERTY_PAGE_TTL = {
  freshSeconds: Number(process.env.CACHE_TTL_PROPERTY_PAGE_S) || 3600,
  maxAgeSeconds: Number(process.env.CACHE_MAX_AGE_PROPERTY_PAGE_S) || 86400,
  missFreshSeconds: Number(process.env.CACHE_TTL_PROPERTY_PAGE_MISS_S) || 60,
};

function buildAmenitiesQuery(slug: string) {
  return sql`
  SELECT a.label, a.icon, a.category, a.sort_order
  FROM amenities a
  JOIN property_amenities pa ON pa.amenity_id = a.id
  JOIN properties p ON p.id = pa.property_id
  WHERE p.slug = ${slug} AND p.is_active
  ORDER BY a.category, a.sort_order, a.label
`;
}

function buildRoomsQuery(slug: string) {
  return sql`
  SELECT
    r.id,
    r.name,
    r.description,
    r.room_type,
    r.bed_type,
    r.size_sqm,
    r.max_adults,
    COALESCE(
      (SELECT json_agg(ri.url ORDER BY ri.sort_order ASC, ri.created_at ASC)
       FROM room_images ri WHERE ri.room_id = r.id),
      '[]'::json
    ) AS images,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', rp.id,
        'name', rp.name,
        'bar', rp.bar,
        'currency', rp.currency,
        'is_refundable', rp.is_refundable,
        'cancellation_policy', rp.cancellation_policy,
        'meal_plan', 'Breakfast included'
      ) ORDER BY rp.bar ASC)
      FROM rate_plans rp WHERE rp.room_id = r.id AND rp.is_active = true),
      '[]'::json
    ) AS rate_plans,
    COALESCE(
      (SELECT array_agg(a.label ORDER BY a.sort_order ASC, a.label ASC)
       FROM room_amenities ra JOIN amenities a ON a.id = ra.amenity_id
       WHERE ra.room_id = r.id),
      ARRAY[]::text[]
    ) AS tags
  FROM rooms r
  JOIN properties p ON p.id = r.property_id
  WHERE p.slug = ${slug} AND p.is_active AND r.is_active = true
  ORDER BY r.name
`;
}

/** The three round trips this cache exists to avoid. Still one Promise.all. */
async function loadFromDb(slug: string): Promise<PropertyPagePayload | null> {
  const db = getDb();
  const [heroResult, amenitiesResult, roomsResult] = await Promise.all([
    db.execute(buildHeroQuery(slug)),
    db.execute(buildAmenitiesQuery(slug)),
    db.execute(buildRoomsQuery(slug)),
  ]);

  const hotel = (heroResult.rows[0] as unknown as HotelPageData) ?? null;
  // `null` is the caller's 404 *and* the cache's negative entry. Returning the
  // amenities and rooms of a property that does not exist would be worse than
  // useless — it would be cached.
  if (!hotel) return null;

  return {
    hotel,
    amenities: amenitiesResult.rows as unknown as RawAmenity[],
    rooms: roomsResult.rows as unknown as DbRoom[],
  };
}

/**
 * The listing page's data, from Redis when it can be and Postgres when it
 * cannot. Returns `null` for a slug with no active property.
 */
export function getHotelPage(slug: string): Promise<PropertyPagePayload | null> {
  return cached<PropertyPagePayload>(propertyPageKey(slug), () => loadFromDb(slug), {
    ...PROPERTY_PAGE_TTL,
    onError: (error, ctx) =>
      Sentry.captureException(error, {
        tags: { area: "cache", surface: "property-page", phase: ctx.phase },
        extra: { key: ctx.key },
      }),
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && bun test lib/hotel-page-data.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Rewrite the page's data fetch**

In `apps/web/app/p/[hotel_slug]/page.tsx`:

Replace the first two imports (lines 1–2) and delete the two query-builder
functions (lines 16–65), which now live in `hotel-page-data.ts`. The import
block becomes:

```tsx
import { notFound } from "next/navigation";
import { getHotelPage } from "@/lib/hotel-page-data";
import type { DbAmenityCategory } from "./_components/constants";
```

Note that `sql`, `getDb`, `buildHeroQuery`, `HotelPageData` and `DbRoom` are no
longer referenced by this file. Leave the `_components/*` imports untouched.

Then replace the body from `const db = getDb();` through the `if (!hotel) notFound();`
line with:

```tsx
  const page = await getHotelPage(slug);
  if (!page) notFound();

  const { hotel, amenities: rawAmenities, rooms } = page;
```

Everything from `const gallery = hotel.gallery_images ?? [];` down is unchanged.

- [ ] **Step 7: Typecheck and lint the app**

Run: `cd apps/web && bun run typecheck && bun run lint`
Expected: no errors. A complaint about an unused import means Step 6's import block was not fully replaced.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/hotel-page-data.ts apps/web/lib/hotel-page-data.test.ts apps/web/app/p/\[hotel_slug\]/page.tsx apps/web/package.json bun.lock
git commit -m "Serve the listing page through the cache

page.tsx no longer talks to Postgres directly: it asks getHotelPage, which
reads Redis and falls back to the same three queries. The rendered output is
unchanged by construction, which is why the page gets no new test -- the
amenity grouping stays in the page, and the cached payload is the three
result sets verbatim rather than anything pre-shaped.

The two query builders moved out of the page and into hotel-page-data.ts,
beside their only consumer. They deliberately did not join buildHeroQuery in
hotel-page-query.ts: that file exists because the hero query is shared with
/api/query/pr, and these two are not shared with anything.

The round-trip test is the load-bearing one. The payload is JSON-safe today
only because every timestamp leaves Postgres as a to_char string; a future
SELECT adding a bare timestamptz would hand callers a string where they
expect a Date, and that test fails before production notices."
```

---

### Task 4: Purge the key from every business write that changes the page

**Files:**
- Create: `apps/business/lib/purge-property-page.ts`
- Test: `apps/business/lib/purge-property-page.test.ts`
- Modify: `apps/business/package.json` (add the `@openbookings/cache` dependency)
- Modify: `apps/business/app/(dashboard)/dashboard/listings/property/_lib/actions.ts:48-58` (`revalidateBoth`)
- Modify: `apps/business/app/(dashboard)/dashboard/listings/rates-availability/_lib/actions.ts:284-315` (`createRatePlan`)
- Modify: `apps/business/app/api/upload/confirm/route.ts:48-93` (both branches)
- Modify: `apps/business/app/api/property-images/[id]/route.ts:16-68` (`PATCH` and `DELETE`)

**Interfaces:**
- Consumes: `propertyPageKey`, `purge` from `@openbookings/cache`; `queryOne` from `@openbookings/db`.
- Produces:
  - `type PurgeTarget = { propertyId: string } | { roomId: string }`
  - `type QueryOneFn = <T>(text: string, values?: unknown[]) => Promise<T | null>`
  - `interface PurgeDeps { queryOne?: QueryOneFn; purge?: (keys: string[]) => Promise<void> }`
  - `function purgePropertyPageBySlug(slug: string): Promise<void>`
  - `function purgePropertyPage(target: PurgeTarget, deps?: PurgeDeps): Promise<void>`

- [ ] **Step 1: Add the dependency**

In `apps/business/package.json`, add `"@openbookings/cache": "workspace:*",` to
`"dependencies"` beside the other `@openbookings/*` entries, then run from the
repo root: `bun install`

- [ ] **Step 2: Write the failing test**

`apps/business/lib/purge-property-page.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { propertyPageKey } from "@openbookings/cache";
import { purgePropertyPage } from "./purge-property-page";

/**
 * A fake `queryOne` that answers the two lookups this module makes, so the
 * test needs no database. Recording the SQL lets us assert that a roomId is
 * resolved through `rooms`, not guessed at.
 */
function fakeQueryOne(rows: Record<string, { slug: string } | null>) {
  const seen: string[] = [];
  const queryOne = async <T>(text: string, values?: unknown[]): Promise<T | null> => {
    seen.push(text.replace(/\s+/g, " ").trim());
    const id = String(values?.[0] ?? "");
    return (rows[id] ?? null) as T | null;
  };
  return { queryOne, seen };
}

describe("purgePropertyPage", () => {
  test("resolves a propertyId to its slug and purges that key", async () => {
    const { queryOne, seen } = fakeQueryOne({ "prop-1": { slug: "terme-di-saturnia" } });
    const purged: string[][] = [];

    await purgePropertyPage(
      { propertyId: "prop-1" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([[propertyPageKey("terme-di-saturnia")]]);
    expect(seen[0]).toContain("FROM properties");
  });

  test("resolves a roomId through its property", async () => {
    const { queryOne, seen } = fakeQueryOne({ "room-1": { slug: "terme-di-saturnia" } });
    const purged: string[][] = [];

    await purgePropertyPage(
      { roomId: "room-1" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([[propertyPageKey("terme-di-saturnia")]]);
    expect(seen[0]).toContain("FROM rooms");
  });

  /**
   * Review Focus 4. The row can be gone — a property deleted in another tab, a
   * room removed between the write and this call. This runs inside a host's
   * save, so the only acceptable behaviour is to return quietly.
   */
  test("does nothing when the id resolves to no row", async () => {
    const { queryOne } = fakeQueryOne({});
    const purged: string[][] = [];

    await purgePropertyPage(
      { propertyId: "gone" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([]);
  });

  /**
   * A cache purge must never be the reason a host's save reports failure. The
   * save has already committed by the time we are called.
   */
  test("swallows a lookup failure instead of throwing into the save", async () => {
    const queryOne = async () => {
      throw new Error("pool exhausted");
    };
    let purgeCalled = false;

    await purgePropertyPage(
      { propertyId: "prop-1" },
      { queryOne, purge: async () => void (purgeCalled = true) },
    );

    expect(purgeCalled).toBe(false);
  });

  test("swallows a purge failure too", async () => {
    const { queryOne } = fakeQueryOne({ "prop-1": { slug: "s" } });

    await purgePropertyPage(
      { propertyId: "prop-1" },
      {
        queryOne,
        purge: async () => {
          throw new Error("upstash unreachable");
        },
      },
    );
  });

  test("lowercases a mixed-case slug column, matching the reader's key", async () => {
    const { queryOne } = fakeQueryOne({ "prop-1": { slug: "Terme-Di-Saturnia" } });
    const purged: string[][] = [];

    await purgePropertyPage(
      { propertyId: "prop-1" },
      { queryOne, purge: async (keys) => void purged.push(keys) },
    );

    expect(purged).toEqual([["ob:v1:prop-page:terme-di-saturnia"]]);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd apps/business && bun test lib/purge-property-page.test.ts`
Expected: FAIL — cannot resolve `./purge-property-page`.

- [ ] **Step 4: Write `apps/business/lib/purge-property-page.ts`**

```ts
import * as Sentry from "@sentry/nextjs";
import { propertyPageKey, purge } from "@openbookings/cache";
import { queryOne } from "@openbookings/db";

export type PurgeTarget = { propertyId: string } | { roomId: string };

export type QueryOneFn = <T>(text: string, values?: unknown[]) => Promise<T | null>;

/** Injection seam, following the `{ queryOne }` convention in @openbookings/authz. */
export interface PurgeDeps {
  queryOne?: QueryOneFn;
  purge?: (keys: string[]) => Promise<void>;
}

const report = (error: unknown, phase: string) =>
  Sentry.captureException(error, { tags: { area: "cache", surface: "property-page", phase } });

/**
 * Drop the public listing page's cached copy.
 *
 * Separate from the resolving version below because `revalidateBoth` in the
 * property actions has already looked the slug up for its own reasons, and a
 * second identical query on every save is waste.
 */
export async function purgePropertyPageBySlug(slug: string): Promise<void> {
  await purge([propertyPageKey(slug)], {
    onError: (error, ctx) => report(error, ctx.phase),
  });
}

/**
 * Drop the listing page's cached copy for the property a write just touched.
 *
 * Takes an id rather than a slug because the four call sites hold different
 * ones: the image routes know a property, the rate-plan action knows a room.
 * Resolving here means the `rooms → properties` join exists once.
 *
 * Nothing in here may throw. Every caller is a write that has already
 * committed — the host's property *is* saved — so a failure to purge must cost
 * a stale page until the TTL expires, never a save that reports failure.
 */
export async function purgePropertyPage(
  target: PurgeTarget,
  deps: PurgeDeps = {},
): Promise<void> {
  const one = deps.queryOne ?? queryOne;
  try {
    const row =
      "propertyId" in target
        ? await one<{ slug: string }>(`SELECT slug FROM properties WHERE id = $1`, [
            target.propertyId,
          ])
        : await one<{ slug: string }>(
            `SELECT p.slug FROM rooms r
             JOIN properties p ON p.id = r.property_id
             WHERE r.id = $1`,
            [target.roomId],
          );

    // The row can be gone: a property deleted in another tab, a room removed
    // between the write and this call. There is no key to purge, and nothing
    // here is worth reporting.
    if (!row) return;

    if (deps.purge) {
      await deps.purge([propertyPageKey(row.slug)]);
      return;
    }
    await purgePropertyPageBySlug(row.slug);
  } catch (error) {
    report(error, "purge");
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/business && bun test lib/purge-property-page.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Purge from the property editor's save path**

In `apps/business/app/(dashboard)/dashboard/listings/property/_lib/actions.ts`,
add to the import block near line 7:

```ts
import { purgePropertyPageBySlug } from "@/lib/purge-property-page";
```

Then replace `revalidateBoth` (lines 48–58) with:

```ts
/**
 * The public listing page is server-rendered from these same rows, so a save
 * that only revalidates the dashboard leaves guests looking at stale content.
 *
 * Note which of the two calls below actually does that. `revalidatePath` only
 * reaches routes in *this* app, and `/p/<slug>` belongs to apps/web in a
 * different container — that call has never had any effect on what a guest
 * sees. The purge is what crosses the app boundary, through the one keyspace
 * both apps share.
 */
async function revalidateBoth(propertyId: string) {
  const row = await queryOne<{ slug: string }>(
    `SELECT slug FROM properties WHERE id = $1`,
    [propertyId],
  );
  revalidatePath("/dashboard/listings/property");
  if (row) {
    revalidatePath(`/p/${row.slug}`);
    await purgePropertyPageBySlug(row.slug);
  }
}
```

- [ ] **Step 7: Purge when a rate plan is created**

In `apps/business/app/(dashboard)/dashboard/listings/rates-availability/_lib/actions.ts`,
add to the imports near line 3:

```ts
import { purgePropertyPage } from "@/lib/purge-property-page";
```

Then in `createRatePlan`, replace the `revalidatePath(ROUTE);` at line 313 with:

```ts
  revalidatePath(ROUTE);
  // rate_plans.bar is on the public listing page; the per-date ARI tables are
  // not, which is why setAvailability, setRestriction, clearRestrictions and
  // publishAriChanges deliberately do not purge. Nor do closeRoomType and
  // reopenRoomType: room_closures is not queried by that page either. When the
  // listing page starts showing live availability, this is the comment that
  // says what has to change.
  await purgePropertyPage({ roomId: data.roomId });
```

- [ ] **Step 8: Purge when an image is uploaded**

In `apps/business/app/api/upload/confirm/route.ts`, add to the imports:

```ts
import { purgePropertyPage } from "@/lib/purge-property-page";
```

In the room branch, after the `INSERT INTO room_images` call and before its
`return` (currently lines 57–61):

```ts
    await purgePropertyPage({ roomId });
    return NextResponse.json({ id, url });
```

In the property branch, after the `INSERT INTO property_images` call and before
its `return` (currently lines 87–92):

```ts
    await purgePropertyPage({ propertyId });
    return NextResponse.json({ id, url, group });
```

- [ ] **Step 9: Purge when an image is edited or deleted**

In `apps/business/app/api/property-images/[id]/route.ts`, add to the imports:

```ts
import { purgePropertyPage } from "@/lib/purge-property-page";
```

In `PATCH`, replace the final return (line 53) with:

```ts
  await purgePropertyPage({ propertyId: image.property_id });
  return NextResponse.json({ ok: true });
```

In `DELETE`, replace the final return (line 67) with:

```ts
  await purgePropertyPage({ propertyId: image.property_id });
  return NextResponse.json({ ok: true });
```

- [ ] **Step 10: Typecheck, lint, and run the app's suite**

Run: `cd apps/business && bun run typecheck && bun run lint && bun test lib/`
Expected: no errors; the purge suite plus the existing `lib/` suites pass.

- [ ] **Step 11: Commit**

```bash
git add apps/business/lib/purge-property-page.ts apps/business/lib/purge-property-page.test.ts apps/business/package.json apps/business/app bun.lock
git commit -m "Purge the listing page's cache from every write that changes it

Four sites, because the cached payload spans more than property_content:
the property editor's seven save actions (via revalidateBoth, which already
had the slug), createRatePlan, the upload-confirm route's two branches, and
the property-image PATCH and DELETE. The ARI date tables and room_closures
are deliberately not purged, and the comment in createRatePlan records why,
so whoever puts live availability on that page knows what to revisit.

This also makes revalidateBoth honest. Its comment promised guests would not
see stale content, but revalidatePath('/p/<slug>') only reaches routes in
this app and that page belongs to apps/web in another container. That call
has never done anything; the purge is the first mechanism that crosses the
boundary.

Nothing in the purge path can throw. Every caller is a write that has
already committed, so a failure to purge costs a stale page until the TTL
expires -- never a save that tells the host it failed."
```

---

### Task 5: End-to-end verification against the real database

This task writes no product code. It proves the thing works in a running app,
which no unit test in this plan can do.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-upstash-redis-caching-design.md` (record the measured result)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: measured before/after numbers, and a note on whether the render or the queries dominate.

- [ ] **Step 1: Confirm the whole repo is green**

Run from the repo root: `bun run typecheck && bun run test`
Expected: all workspace typechecks and suites pass.

Note on Turbo: its `envMode` is strict, so a task only sees env it declares. No
change to `turbo.json` is needed here — the cache variables are read at request
time by the running Next server, which loads `.env.local` itself, and no test
requires them. If a test ever fails for a *missing* `UPSTASH_*` variable, that
is a bug in the test, not in `turbo.json`: every test in this plan injects a
fake store.

- [ ] **Step 2: Start the web app and load the page twice**

Run: `cd apps/web && bun run dev`

Then in a second shell:

```bash
curl -s -o /dev/null -w 'first  %{time_total}s\n' http://localhost:3002/p/terme-di-saturnia
curl -s -o /dev/null -w 'second %{time_total}s\n' http://localhost:3002/p/terme-di-saturnia
```

Expected: both return 200. The dev server's log shows `[cache] outcome=miss`
for the first and `[cache] outcome=hit` for the second, and the second `curl` is
faster. Note both numbers — Step 7 records them.

- [ ] **Step 3: Confirm the key exists in Redis with the shape we expect**

```bash
cd /Users/woutervanderwal/GitHub/OpenBookings
eval "$(grep -E '^[[:space:]]*UPSTASH_REDIS_REST_(URL|TOKEN)=' apps/web/.env.local | sed 's/^[[:space:]]*//')"
curl -s -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  -X POST "$UPSTASH_REDIS_REST_URL/pipeline" -H 'Content-Type: application/json' \
  -d '[["KEYS","ob:v1:prop-page:*"],["TTL","ob:v1:prop-page:terme-di-saturnia"]]'
```

Expected: the key is listed, and its TTL is close to 86400. A TTL near 3600
means the physical and logical TTLs were crossed in `cached`.

- [ ] **Step 4: Verify a 404 is cached as an absence**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3002/p/no-such-property-xyz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3002/p/no-such-property-xyz
```

Expected: `404` both times; the log shows `outcome=miss` then `outcome=negative`.
Confirm the negative key's TTL is ~60, not ~86400:

```bash
curl -s -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  "$UPSTASH_REDIS_REST_URL/ttl/ob:v1:prop-page:no-such-property-xyz"
```

- [ ] **Step 5: Verify the purge actually crosses the app boundary**

Start the business app (`cd apps/business && bun run dev`), sign in as the host
who owns Terme di Saturnia, and change the property subtitle in
`/dashboard/listings/property`.

Then:

```bash
curl -s -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  "$UPSTASH_REDIS_REST_URL/exists/ob:v1:prop-page:terme-di-saturnia"
```

Expected: `{"result":0}` — the business app deleted a key the web app wrote.
This is the step that proves the cross-app contract, and the one thing
`revalidatePath` never did. Reload the public page and confirm the new subtitle
appears immediately rather than in an hour.

- [ ] **Step 6: Verify the cache cannot break the page**

With the dev server running, break the credentials and confirm the page still
renders:

```bash
cd apps/web
cp .env.local /tmp/env.local.bak
sed -i '' 's#^UPSTASH_REDIS_REST_URL=.*#UPSTASH_REDIS_REST_URL="https://invalid.upstash.io"#' .env.local
# restart dev, then:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3002/p/terme-di-saturnia
cp /tmp/env.local.bak .env.local
```

Expected: `200`. The page served from Postgres, and the log shows a read
failure. A `500` here means a Redis error escaped `cached`, which is the one
failure mode this design must not have.

- [ ] **Step 7: Record the measured result in the spec**

Add to the spec's Observability section: the two timings from Step 2, the hit
and miss numbers, and one sentence on whether the remaining time looks like
render or query cost. That sentence is the evidence for whether the deferred
`"use cache"` approach is worth doing.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-09-25-upstash-redis-caching-design.md
git commit -m "Record what the cache actually measured

Adds the observed miss and hit timings for /p/terme-di-saturnia to the spec,
and a note on whether the remaining time is render or query cost. That note
is the evidence for whether the deferred rendered-output caching is worth
doing, which the design deliberately left to measurement rather than
guessing at it up front."
```

---

## Production cutover (after the branch merges)

Not a task, because it is not a code change and it is the user's to make.

Both containers need `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
set in the Scaleway console (`nl-ams`): `openbookings-web` and
`openbookings-business`. CI passes no application env at deploy time — it only
rolls images — so this is console work, not a workflow change.

Until they are set, both apps deploy and behave exactly as they do today,
because `getRedis()` returns `null` and `cached()` runs the loader. That makes
the cutover a config change that can be made, and reversed, independently of
the deploy.

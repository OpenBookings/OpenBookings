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

describe("error reporting is bounded per invocation", () => {
  /**
   * Finding #3. The spec is explicit: at most one report per request, not one
   * per failed operation. During an outage every request fails both its read
   * and its write, and two unsampled events per page view buries the issue
   * stream in the window where it most needs to be legible.
   */
  test("reports once when both the read and the write fail", async () => {
    const { redis } = fakeRedis();
    redis.get = async () => {
      throw new Error("upstash unreachable");
    };
    redis.set = async () => {
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
});

describe("a purge landing mid-load", () => {
  /**
   * Finding #2. The sequence that loses a host's edit for a full hour:
   * a loader reads pre-edit rows, the host saves and the purge deletes a key
   * that is not there yet, and then the in-flight loader writes the pre-edit
   * payload back with a fresh one-hour lease. Nothing will purge it again,
   * because the write that would have has already happened.
   */
  test("a purge during the loader suppresses the write-through", async () => {
    const { redis, store } = fakeRedis();

    const result = await cached<{ n: number }>(
      "k",
      async () => {
        // The host saves while we are reading pre-edit rows.
        await purge(["k"], { redis, ...silent, now: () => 1_500 });
        return { n: 1 };
      },
      { ...TTL, ...silent, redis, now: () => 1_000 },
    );

    // The caller still gets what it loaded — only the cache write is skipped.
    expect(result).toEqual({ n: 1 });
    expect(store.has("k")).toBe(false);
  });

  test("a purge that finished before the loader started does not suppress it", async () => {
    const { redis, store } = fakeRedis();
    await purge(["k"], { redis, ...silent, now: () => 500 });

    const result = await cached<{ n: number }>("k", async () => ({ n: 2 }), {
      ...TTL,
      ...silent,
      redis,
      now: () => 1_000,
    });

    expect(result).toEqual({ n: 2 });
    expect(store.has("k")).toBe(true);
  });

  test("purge leaves a guard alongside the delete", async () => {
    const { redis, store } = fakeRedis({ k: envelope({ n: 1 }, 2_000) });

    await purge(["k"], { redis, ...silent, now: () => 1_500 });

    expect(store.has("k")).toBe(false);
    expect(store.get("ob:v1:purged:k")?.value).toBe("1500");
  });
});

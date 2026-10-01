import { describe, expect, test } from "bun:test";
import { createReadinessLoader, type ReadinessDeps } from "./readiness-loader";

const HOST = { id: "p1", is_active: true, stripe_account_id: "acct_1" };

/** Answers the three queries in the order the loader asks them. */
function deps(over: Partial<ReadinessDeps> & { host?: typeof HOST | null; found?: boolean } = {}) {
  const calls = { queries: 0, stripe: 0 };
  const host = over.host === undefined ? HOST : over.host;
  const base: ReadinessDeps = {
    queryOne: async <T,>(sql: string) => {
      calls.queries += 1;
      if (sql.includes("FROM properties")) return host as T | null;
      return { found: over.found ?? true } as T;
    },
    retrieveAccount: async () => {
      calls.stripe += 1;
      return { charges_enabled: true };
    },
    ...over,
  };
  return { load: createReadinessLoader(base), calls };
}

const states = (items: { state: string }[]) => items.map((i) => i.state);

describe("readiness loader", () => {
  test("a host with no property has everything still to do, and Stripe is not asked", async () => {
    const { load, calls } = deps({ host: null });
    expect(states(await load("u1", "2026-10-01"))).toEqual(["todo", "todo", "todo", "todo"]);
    expect(calls.stripe).toBe(0);
  });

  test("a live listing with availability, a rate plan and charges enabled is ready", async () => {
    const { load } = deps();
    expect(states(await load("u1", "2026-10-01"))).toEqual(["done", "done", "done", "done"]);
  });

  test("missing availability and rate plan are to do; an inactive listing too", async () => {
    const { load } = deps({ host: { ...HOST, is_active: false }, found: false });
    expect(states(await load("u1", "2026-10-01"))).toEqual(["todo", "todo", "todo", "done"]);
  });

  test("no Stripe account is to do, without calling Stripe", async () => {
    const { load, calls } = deps({ host: { ...HOST, stripe_account_id: null as unknown as string } });
    expect(states(await load("u1", "2026-10-01"))[3]).toBe("todo");
    expect(calls.stripe).toBe(0);
  });

  test("a Stripe error is unknown, not a false accusation", async () => {
    const { load } = deps({
      retrieveAccount: async () => {
        throw new Error("stripe down");
      },
    });
    expect(states(await load("u1", "2026-10-01"))).toEqual(["done", "done", "done", "unknown"]);
  });

  test("a Stripe call that hangs gives up after the timeout instead of blocking the page", async () => {
    const { load } = deps({ retrieveAccount: () => new Promise(() => {}), timeoutMs: 20 });
    const started = Date.now();
    expect(states(await load("u1", "2026-10-01"))[3]).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("the answer is reused for the same host within the TTL and refetched after it", async () => {
    let clock = 1_000;
    const { load, calls } = deps({ now: () => clock, ttlMs: 60_000 });
    await load("u1", "2026-10-01");
    const afterFirst = calls.queries;
    await load("u1", "2026-10-01");
    expect(calls.queries).toBe(afterFirst);
    expect(calls.stripe).toBe(1);

    await load("u2", "2026-10-01");
    expect(calls.queries).toBe(afterFirst * 2);

    clock += 60_001;
    await load("u1", "2026-10-01");
    expect(calls.queries).toBe(afterFirst * 3);
  });

  test("an unknown answer is not cached, so the next view asks again", async () => {
    let fail = true;
    const { load, calls } = deps({
      retrieveAccount: async () => {
        calls.stripe += 1;
        if (fail) throw new Error("down");
        return { charges_enabled: true };
      },
    });
    expect(states(await load("u1", "2026-10-01"))[3]).toBe("unknown");
    fail = false;
    expect(states(await load("u1", "2026-10-01"))[3]).toBe("done");
  });
});

import { describe, expect, mock, test } from "bun:test";
import type { RedisLike } from "@openbookings/cache";
import { ensureCheckoutDomain, registrableDomain } from "./checkout-domain";

const ACCOUNT = "acct_test_1";
const APP = "https://openbookings.co";
const KEY = "pmd:v1:acct_test_1:openbookings.co";

function fakeRedis(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const set = mock(async (key: string, value: string, _opts: { ex: number }) => {
    store.set(key, value);
    return "OK";
  });
  const redis: RedisLike = { get: async (key) => store.get(key) ?? null, set, del: async () => 0 };
  return { redis, set, store };
}

const active = async () => ({ outcome: "created" as const, applePay: "active" });

describe("registrableDomain", () => {
  test("is the app's hostname", () => {
    expect(registrableDomain("https://openbookings.co")).toBe("openbookings.co");
    expect(registrableDomain("https://staging.openbookings.co/")).toBe("staging.openbookings.co");
  });

  test("is null where Stripe can't register a domain", () => {
    for (const url of [
      "http://localhost:3002",
      "http://web.localhost:3002",
      "http://127.0.0.1:3002",
      "http://[::1]:3002",
      "not a url",
    ]) {
      expect(registrableDomain(url)).toBeNull();
    }
  });
});

describe("ensureCheckoutDomain", () => {
  test("a remembered registration costs no Stripe call", async () => {
    const ensure = mock(active);
    await ensureCheckoutDomain(ACCOUNT, APP, { ensure, redis: fakeRedis({ [KEY]: "1" }).redis, report: () => {} });
    expect(ensure).not.toHaveBeenCalled();
  });

  test("registers once, then remembers it for 30 days", async () => {
    const ensure = mock(active);
    const { redis, set } = fakeRedis();
    await ensureCheckoutDomain(ACCOUNT, APP, { ensure, redis, report: () => {} });
    expect(ensure).toHaveBeenCalledWith(ACCOUNT, "openbookings.co");
    expect(set).toHaveBeenCalledWith(KEY, "1", { ex: 2_592_000 });
  });

  test("a Stripe failure is reported, not thrown, and not remembered", async () => {
    const ensure = mock(async () => {
      throw new Error("No such account");
    });
    const report = mock((_err: unknown) => {});
    const { redis, set } = fakeRedis();
    await ensureCheckoutDomain(ACCOUNT, APP, { ensure, redis, report });
    expect(report).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  test("a Stripe call that hangs gives up at the deadline", async () => {
    const ensure = mock(() => new Promise<never>(() => {}));
    const report = mock((_err: unknown) => {});
    const started = Date.now();
    await ensureCheckoutDomain(ACCOUNT, APP, { ensure, redis: null, report, deadlineMs: 20 });
    expect(Date.now() - started).toBeLessThan(200);
    expect(report).toHaveBeenCalledTimes(1);
  });

  test("an Apple Pay refusal is reported, though the domain counts as registered", async () => {
    const report = mock((_err: unknown) => {});
    const { redis, set } = fakeRedis();
    await ensureCheckoutDomain(ACCOUNT, APP, {
      ensure: async () => ({ outcome: "exists", applePay: "inactive" }),
      redis,
      report,
    });
    expect(report).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
  });

  test("skips local development entirely", async () => {
    const ensure = mock(active);
    await ensureCheckoutDomain(ACCOUNT, "http://localhost:3002", { ensure, redis: null, report: () => {} });
    expect(ensure).not.toHaveBeenCalled();
  });

  test("without Redis it still registers", async () => {
    const ensure = mock(active);
    await ensureCheckoutDomain(ACCOUNT, APP, { ensure, redis: null, report: () => {} });
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});

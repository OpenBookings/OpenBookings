import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getRedis, REDIS_RETRY_POLICY, resetRedisForTests, withDeadline } from "./redis";

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

describe("withDeadline", () => {
  /**
   * Finding #1. The Upstash SDK defaults to 5 retries with an exp(i)*50ms
   * backoff — ~4.3s per failing operation, and a read plus a write makes ~8.6s.
   * It also passes no signal, so the underlying fetch has no timeout at all.
   * Either one turns "Redis is down" into a page far slower than the uncached
   * path, which is the exact inversion of this package's invariant.
   */
  test("rejects when the work outruns the deadline", async () => {
    const never = new Promise<string>(() => {});
    await expect(withDeadline(never, 20, "get")).rejects.toThrow(/exceeded 20ms/);
  });

  test("resolves with the work's value when it finishes in time", async () => {
    await expect(withDeadline(Promise.resolve("v"), 50, "get")).resolves.toBe("v");
  });

  test("propagates the work's own rejection rather than masking it", async () => {
    await expect(
      withDeadline(Promise.reject(new Error("upstash 500")), 50, "get"),
    ).rejects.toThrow("upstash 500");
  });
});

describe("REDIS_RETRY_POLICY", () => {
  test("caps retries so a failing call cannot cost seconds of backoff", () => {
    expect(REDIS_RETRY_POLICY.retries).toBe(1);
    const worst = REDIS_RETRY_POLICY.backoff(0) + REDIS_RETRY_POLICY.backoff(1);
    expect(worst).toBeLessThan(250);
  });
});

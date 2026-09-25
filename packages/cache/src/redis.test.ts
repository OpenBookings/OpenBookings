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

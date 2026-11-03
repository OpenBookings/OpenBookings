import { afterEach, describe, expect, it } from "bun:test";
import { DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR, assertRequiredEnv, env, isLocalBaseUrl, parseRefundThreshold, requiredAtStartup } from "./env";

describe("parseRefundThreshold", () => {
  it("falls back to the default when unset", () => {
    expect(parseRefundThreshold(undefined)).toBe(DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR);
  });

  it("treats a blank value as unset rather than zero", () => {
    // `REFUND_ESCALATION_THRESHOLD_EUR=` in a .env file yields "" — Number("")
    // is 0, which would escalate every payment lookup.
    expect(parseRefundThreshold("")).toBe(DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR);
    expect(parseRefundThreshold("   ")).toBe(DEFAULT_REFUND_ESCALATION_THRESHOLD_EUR);
  });

  it("parses a configured value, tolerating surrounding whitespace", () => {
    expect(parseRefundThreshold("500")).toBe(500);
    expect(parseRefundThreshold(" 125.50 ")).toBe(125.5);
  });

  it("allows an explicit zero (escalate every refund) when asked for", () => {
    expect(parseRefundThreshold("0")).toBe(0);
  });

  it("throws rather than degrading to 0 on a nonsense value", () => {
    expect(() => parseRefundThreshold("abc")).toThrow("non-negative number");
    expect(() => parseRefundThreshold("-10")).toThrow("non-negative number");
  });
});

describe("TASKS_AUTH_DISABLED", () => {
  const KEYS = ["TASKS_AUTH_DISABLED", "SERVICE_BASE_URL", "NODE_ENV"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const restore = () => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  const set = (vars: Partial<Record<(typeof KEYS)[number], string>>) => {
    restore();
    Object.assign(process.env, vars);
  };
  afterEach(restore);

  it("is honoured for a local run against a loopback base URL", () => {
    for (const url of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "http://bot.localhost:8080"]) {
      set({ TASKS_AUTH_DISABLED: "true", SERVICE_BASE_URL: url, NODE_ENV: "development" });
      expect(env.tasksAuthDisabled).toBe(true);
    }
  });

  it("is inert on a deployed (non-loopback) base URL, whatever NODE_ENV says", () => {
    for (const nodeEnv of ["production", "development", undefined]) {
      set({ TASKS_AUTH_DISABLED: "true", SERVICE_BASE_URL: "https://bot.openbookings.co" });
      if (nodeEnv) process.env.NODE_ENV = nodeEnv;
      expect(env.tasksAuthDisabled).toBe(false);
    }
  });

  it("is inert in production even on a loopback URL", () => {
    set({ TASKS_AUTH_DISABLED: "true", SERVICE_BASE_URL: "http://localhost:8080", NODE_ENV: "production" });
    expect(env.tasksAuthDisabled).toBe(false);
  });

  it("lookalike hosts are not local", () => {
    for (const url of ["https://localhost.evil.example", "https://evil.example/localhost", "https://127.0.0.1.evil.example", "not a url", ""]) {
      expect(isLocalBaseUrl(url)).toBe(false);
    }
    expect(isLocalBaseUrl(undefined)).toBe(false);
  });

  it("the boot check refuses a flag that would not be honoured", () => {
    // Fill every required variable so the only thing wrong is the flag.
    const filled: string[] = [];
    set({ TASKS_AUTH_DISABLED: "true", SERVICE_BASE_URL: "https://bot.openbookings.co" });
    for (const name of requiredAtStartup()) {
      if (!process.env[name]) {
        process.env[name] = "x";
        filled.push(name);
      }
    }
    try {
      expect(() => assertRequiredEnv()).toThrow("refusing to start with task authentication off");
      // ...and boots when the same flag is paired with a loopback URL.
      process.env.SERVICE_BASE_URL = "http://localhost:8080";
      expect(() => assertRequiredEnv()).not.toThrow();
    } finally {
      for (const name of filled) delete process.env[name];
    }
  });

  it("off by default", () => {
    set({ SERVICE_BASE_URL: "http://localhost:8080" });
    delete process.env.TASKS_AUTH_DISABLED;
    expect(env.tasksAuthDisabled).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { assertRequiredEnv, env, parsePollSeconds, requiredAtStartup } from "./env";

const saved = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("env getters", () => {
  it("throw naming the missing variable", () => {
    delete process.env.SITEMINDER_DATABASE_URL;
    expect(() => env.databaseUrl).toThrow("SITEMINDER_DATABASE_URL is not set");
    delete process.env.SITEMINDER_INBOUND_USERNAME;
    expect(() => env.soapUsername).toThrow("SITEMINDER_INBOUND_USERNAME is not set");
  });

  it("treat a blank value as missing", () => {
    process.env.SITEMINDER_REQUESTOR_ID = "   ";
    expect(() => env.requestorId).toThrow("SITEMINDER_REQUESTOR_ID is not set");
  });

  it("read the configured value", () => {
    process.env.SITEMINDER_DATABASE_URL = "postgres://x";
    process.env.SERVICE_BASE_URL = "https://sm.example.com/";
    expect(env.databaseUrl).toBe("postgres://x");
    expect(env.serviceBaseUrl).toBe("https://sm.example.com");
  });
});

describe("run mode and polling", () => {
  it("defaults to scale-to-zero polling every 300 s", () => {
    delete process.env.SITEMINDER_RUN_MODE;
    delete process.env.SITEMINDER_POLL_SECONDS;
    expect(env.runMode).toBe("scale-to-zero");
    expect(env.pollSeconds).toBe(300);
  });

  it("polls every 60 s when always-on", () => {
    process.env.SITEMINDER_RUN_MODE = "always-on";
    delete process.env.SITEMINDER_POLL_SECONDS;
    expect(env.runMode).toBe("always-on");
    expect(env.pollSeconds).toBe(60);
  });

  it("rejects an unknown mode and a nonsense poll interval", () => {
    process.env.SITEMINDER_RUN_MODE = "sometimes";
    expect(() => env.runMode).toThrow("SITEMINDER_RUN_MODE");
    expect(() => parsePollSeconds("0", "always-on")).toThrow("SITEMINDER_POLL_SECONDS");
    expect(() => parsePollSeconds("abc", "always-on")).toThrow("SITEMINDER_POLL_SECONDS");
    expect(parsePollSeconds("45", "always-on")).toBe(45);
  });
});

describe("assertRequiredEnv", () => {
  it("lists every missing variable, none of them QStash's", () => {
    for (const name of requiredAtStartup()) delete process.env[name];
    for (const mode of ["scale-to-zero", "always-on"]) {
      process.env.SITEMINDER_RUN_MODE = mode;
      expect(() => assertRequiredEnv()).toThrow(/SITEMINDER_DATABASE_URL/);
      expect(requiredAtStartup().join()).not.toMatch(/QSTASH|SERVICE_BASE_URL/);
    }
  });

  it("passes with QStash unconfigured, and the getters are undefined", () => {
    for (const mode of ["scale-to-zero", "always-on"]) {
      process.env.SITEMINDER_RUN_MODE = mode;
      for (const name of requiredAtStartup()) process.env[name] = "x";
      delete process.env.QSTASH_CURRENT_SIGNING_KEY;
      delete process.env.QSTASH_NEXT_SIGNING_KEY;
      delete process.env.SERVICE_BASE_URL;
      expect(() => assertRequiredEnv()).not.toThrow();
      expect(env.qstashCurrentSigningKey).toBeUndefined();
      expect(env.qstashNextSigningKey).toBeUndefined();
      expect(env.serviceBaseUrl).toBeUndefined();
    }
  });

  it("reads QStash settings when present", () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = "cur";
    process.env.SERVICE_BASE_URL = "https://sm.example.com/";
    expect(env.qstashCurrentSigningKey).toBe("cur");
    expect(env.serviceBaseUrl).toBe("https://sm.example.com");
  });
});

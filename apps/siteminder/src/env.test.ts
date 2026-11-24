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
  it("lists every missing variable, and needs queue keys only when scale-to-zero", () => {
    for (const name of requiredAtStartup()) delete process.env[name];
    process.env.SITEMINDER_RUN_MODE = "scale-to-zero";
    expect(() => assertRequiredEnv()).toThrow(/SITEMINDER_DATABASE_URL[\s\S]*QSTASH_NEXT_SIGNING_KEY/);
    process.env.SITEMINDER_RUN_MODE = "always-on";
    expect(requiredAtStartup()).not.toContain("QSTASH_CURRENT_SIGNING_KEY");
  });

  it("passes when everything is set", () => {
    process.env.SITEMINDER_RUN_MODE = "always-on";
    for (const name of requiredAtStartup()) process.env[name] = "x";
    expect(() => assertRequiredEnv()).not.toThrow();
  });
});

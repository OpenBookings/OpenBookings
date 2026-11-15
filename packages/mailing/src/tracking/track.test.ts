import { beforeEach, afterEach, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import type { ServerEvent } from "@openbookings/analytics/server";
import { clickRedirectConfig, trackingConfig, type TrackingConfig } from "./config";
import { LOOKUP_TIMEOUT_MS, isConsented, trackMail } from "./track";
import { openToken } from "./token";

const key = Buffer.alloc(32, 7);
const fullEnv = {
  EMAIL_TRACKING_ENABLED: "true",
  EMAIL_TRACKING_SECRET: key.toString("base64"),
  EMAIL_TRACKING_CONSENT_VERSION: "2",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_x",
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  NEXT_PUBLIC_WEB_URL: "https://openbookings.co",
  NEXT_PUBLIC_BUSINESS_URL: "https://business.openbookings.co",
};

describe("trackingConfig", () => {
  it("builds a config from a full env", () => {
    const c = trackingConfig(fullEnv, false);
    expect(c?.key.equals(key)).toBe(true);
    expect(c?.baseUrl).toBe("https://openbookings.co");
    expect(c?.ownHosts).toEqual(["openbookings.co", "business.openbookings.co"]);
    expect(c?.consentVersion).toBe(2);
  });

  it("uses host incl. port for local dev urls", () => {
    const c = trackingConfig(
      { ...fullEnv, NEXT_PUBLIC_WEB_URL: "http://web.localhost:3002/", NEXT_PUBLIC_BUSINESS_URL: "http://business.localhost:3001" },
      false,
    );
    expect(c?.baseUrl).toBe("http://web.localhost:3002");
    expect(c?.ownHosts).toEqual(["web.localhost:3002", "business.localhost:3001"]);
  });

  for (const name of Object.keys(fullEnv)) {
    it(`is null without ${name}`, () => {
      expect(trackingConfig({ ...fullEnv, [name]: undefined }, false)).toBeNull();
    });
  }
  it("is null when disabled, on console transport, in testing mode, or with a bad secret", () => {
    expect(trackingConfig({ ...fullEnv, EMAIL_TRACKING_ENABLED: "false" }, false)).toBeNull();
    expect(trackingConfig({ ...fullEnv, EMAIL_TRANSPORT: "console" }, false)).toBeNull();
    expect(trackingConfig(fullEnv, true)).toBeNull();
    expect(trackingConfig({ ...fullEnv, EMAIL_TRACKING_SECRET: Buffer.alloc(16).toString("base64") }, false)).toBeNull();
    expect(trackingConfig({ ...fullEnv, EMAIL_TRACKING_CONSENT_VERSION: "two" }, false)).toBeNull();
  });

  it("has no production host fallback: both app urls are required", () => {
    expect(trackingConfig({ ...fullEnv, NEXT_PUBLIC_WEB_URL: "" }, false)).toBeNull();
    expect(trackingConfig({ ...fullEnv, NEXT_PUBLIC_BUSINESS_URL: "" }, false)).toBeNull();
  });

  it("references every NEXT_PUBLIC_ variable literally so Next inlines it at build time", () => {
    const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
    for (const name of [
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_WEB_URL",
      "NEXT_PUBLIC_BUSINESS_URL",
    ]) {
      expect(source).toContain(`process.env.${name}`);
    }
  });
});

describe("clickRedirectConfig", () => {
  const redirectEnv = {
    EMAIL_TRACKING_SECRET: key.toString("base64"),
    NEXT_PUBLIC_WEB_URL: "http://web.localhost:3002/",
    NEXT_PUBLIC_BUSINESS_URL: "http://business.localhost:3001",
  };

  it("needs only the secret and the two app urls", () => {
    const c = clickRedirectConfig(redirectEnv);
    expect(c?.key.equals(key)).toBe(true);
    expect(c?.baseUrl).toBe("http://web.localhost:3002");
    expect(c?.ownHosts).toEqual(["web.localhost:3002", "business.localhost:3001"]);
  });

  it("survives tracking being switched off or half-configured", () => {
    const c = clickRedirectConfig({ ...redirectEnv, EMAIL_TRACKING_ENABLED: "false", EMAIL_TRANSPORT: "console" });
    expect(c?.baseUrl).toBe("http://web.localhost:3002");
  });

  for (const name of Object.keys(redirectEnv)) {
    it(`is null without ${name}`, () => {
      expect(clickRedirectConfig({ ...redirectEnv, [name]: undefined })).toBeNull();
    });
  }

  it("is null with a secret that is not 32 bytes", () => {
    expect(clickRedirectConfig({ ...redirectEnv, EMAIL_TRACKING_SECRET: Buffer.alloc(16).toString("base64") })).toBeNull();
  });
});

let errorSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

const config: TrackingConfig = {
  key,
  baseUrl: "https://openbookings.co",
  ownHosts: ["openbookings.co", "business.openbookings.co"],
  consentVersion: 2,
};
const html = `<html><body><a href="https://openbookings.co/bookings/1">View</a></body></html>`;
const fixed = { newId: () => "send-1", now: () => new Date("2026-11-15T10:00:00Z") };

function harness(over: Partial<Parameters<typeof trackMail>[1]> = {}) {
  const captured: ServerEvent[] = [];
  const consentCalls: string[] = [];
  const deps = {
    config,
    userIdByEmail: async () => "user-1",
    consentAccepted: async (u: string) => {
      consentCalls.push(u);
      return true;
    },
    capture: async (e: ServerEvent) => {
      captured.push(e);
    },
    ...fixed,
    ...over,
  };
  return { captured, consentCalls, deps };
}

describe("trackMail", () => {
  it("returns the html untouched without config", async () => {
    const h = harness({ config: null });
    const r = await trackMail({ kind: "booking_confirmed_guest", to: "a@b.c", html }, h.deps);
    expect(r.html).toBe(html);
    await r.onSent();
    expect(h.captured).toEqual([]);
  });

  it("leaves html untouched without consent", async () => {
    const h = harness({ consentAccepted: async () => false });
    const r = await trackMail({ kind: "booking_confirmed_guest", to: "a@b.c", html }, h.deps);
    expect(r.html).toBe(html);
    await r.onSent();
    expect(h.captured).toEqual([]);
  });

  it("leaves html untouched when no user matches a consented kind", async () => {
    const h = harness({ userIdByEmail: async () => null });
    const r = await trackMail({ kind: "booking_confirmed_guest", to: "a@b.c", html }, h.deps);
    expect(r.html).toBe(html);
  });

  it("instruments consented mail and captures email_sent", async () => {
    const h = harness();
    const r = await trackMail({ kind: "booking_confirmed_guest", to: "a@b.c", html }, h.deps);
    expect(r.html).toContain("/e/o/");
    expect(r.html).toContain("/e/c/");
    const pixel = /src="https:\/\/openbookings\.co\/e\/o\/([^"]+)"/.exec(r.html)![1]!;
    expect(openToken(pixel, key)).toMatchObject({ k: "booking_confirmed_guest", u: "user-1", s: "send-1" });
    const click = /href="https:\/\/openbookings\.co\/e\/c\/([^"]+)"/.exec(r.html)![1]!;
    expect(openToken(click, key)).toMatchObject({ l: "cta", d: "https://openbookings.co/bookings/1" });
    await r.onSent();
    expect(h.captured).toEqual([
      { distinctId: "user-1", event: "email_sent", properties: { email_kind: "booking_confirmed_guest", send_id: "send-1" } },
    ]);
    expect("anonymous" in h.captured[0]!).toBe(false);
  });

  it("tracks team_invitation anonymously without a consent check", async () => {
    const h = harness({ userIdByEmail: async () => null });
    const r = await trackMail({ kind: "team_invitation", to: "a@b.c", html }, h.deps);
    expect(r.html).toContain("/e/o/");
    const pixel = /src="https:\/\/openbookings\.co\/e\/o\/([^"]+)"/.exec(r.html)![1]!;
    expect(openToken(pixel, key)?.u).toBeNull();
    await r.onSent();
    expect(h.captured).toEqual([
      {
        distinctId: "send-1",
        event: "email_sent",
        properties: { email_kind: "team_invitation", send_id: "send-1" },
        anonymous: true,
      },
    ]);
    expect(h.consentCalls).toEqual([]);
  });

  it("falls back to untouched html when a dependency throws", async () => {
    const h = harness({
      userIdByEmail: async () => {
        throw new Error("db down");
      },
    });
    const r = await trackMail({ kind: "booking_confirmed_guest", to: "a@b.c", html }, h.deps);
    expect(r.html).toBe(html);
    await r.onSent();
  });

  it("sends untouched html when the pre-send lookups exceed the time budget", async () => {
    const never = () => new Promise<never>(() => {});
    for (const over of [{ userIdByEmail: never }, { consentAccepted: never }]) {
      const h = harness({ ...over, lookupTimeoutMs: 20 });
      const started = Date.now();
      const r = await trackMail({ kind: "booking_confirmed_guest", to: "a@b.c", html }, h.deps);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(r.html).toBe(html);
      await r.onSent();
      expect(h.captured).toEqual([]);
    }
    expect(warnSpy).toHaveBeenCalledWith("[email-tracking] consent lookup timed out, sending untouched html");
    expect(LOOKUP_TIMEOUT_MS).toBe(1500);
  });

  it("onSent never throws when capture rejects", async () => {
    const h = harness({
      capture: async () => {
        throw new Error("posthog down");
      },
    });
    const r = await trackMail({ kind: "booking_confirmed_guest", to: "a@b.c", html }, h.deps);
    await expect(r.onSent()).resolves.toBeUndefined();
  });
});

describe("isConsented", () => {
  const at = (v: string, analytics = true) => async () => ({ analytics, bannerVersion: v });
  it("is false without a consent row", async () => {
    expect(await isConsented("u", config, async () => null)).toBe(false);
  });
  it("is false for an older banner version", async () => {
    expect(await isConsented("u", config, at("1+privacy@abc"))).toBe(false);
  });
  it("is true for a matching banner version", async () => {
    expect(await isConsented("u", config, at("2+privacy@abc"))).toBe(true);
  });
  it("is false when analytics is declined", async () => {
    expect(await isConsented("u", config, at("3", false))).toBe(false);
  });
  it("is false for an unparseable banner version", async () => {
    expect(await isConsented("u", config, at("x+y"))).toBe(false);
  });
});

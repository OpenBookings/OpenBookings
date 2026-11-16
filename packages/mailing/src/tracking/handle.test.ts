import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ServerEvent } from "@openbookings/analytics/server";
import { clickRedirectConfig, type TrackingConfig } from "./config";
import { PIXEL_GIF, clickDestination, clientProxy, handleClick, handleOpen } from "./handle";
import { sealToken, type TrackingToken } from "./token";

const key = Buffer.alloc(32, 7);
const config: TrackingConfig = {
  key,
  baseUrl: "https://openbookings.co",
  ownHosts: ["openbookings.co", "business.openbookings.co"],
  consentVersion: 2,
};
const sentAt = 1_800_000_000;
const now = () => new Date((sentAt + 90) * 1000 + 500);
const base: TrackingToken = { v: 1, s: "send-1", k: "booking_confirmed_guest", u: "user-1", t: sentAt };

function harness(consented = true) {
  const events: ServerEvent[] = [];
  let consentCalls = 0;
  return {
    events,
    consentCalls: () => consentCalls,
    deps: {
      config,
      now,
      capture: async (e: ServerEvent) => {
        events.push(e);
      },
      consentAccepted: async () => {
        consentCalls++;
        return consented;
      },
    },
  };
}

describe("PIXEL_GIF / clientProxy", () => {
  it("is the brief base64 decoded (42 bytes, not the 43 the brief states)", () => {
    expect(PIXEL_GIF.length).toBe(42);
    expect(Buffer.from(PIXEL_GIF.subarray(0, 6)).toString("ascii")).toBe("GIF89a");
  });
  it("classifies proxies", () => {
    expect(clientProxy("Mozilla/5.0 (via ggpht.com GoogleImageProxy)")).toBe("google");
    expect(clientProxy("Mozilla/5.0")).toBe("apple_suspected");
    expect(clientProxy("Mozilla/5.0 (Macintosh)")).toBeNull();
    expect(clientProxy(null)).toBeNull();
  });
});

describe("handleOpen", () => {
  it("captures email_opened for a consented token", async () => {
    const h = harness();
    await handleOpen(sealToken(base, key), "Mozilla/5.0 (via ggpht.com GoogleImageProxy)", h.deps);
    expect(h.events).toEqual([
      {
        distinctId: "user-1",
        event: "email_opened",
        properties: {
          email_kind: "booking_confirmed_guest",
          send_id: "send-1",
          seconds_after_send: 90,
          client_proxy: "google",
        },
      },
    ]);
  });

  it("captures nothing when consent was withdrawn", async () => {
    const h = harness(false);
    await handleOpen(sealToken(base, key), null, h.deps);
    expect(h.events).toEqual([]);
  });

  it("ignores a tampered token without throwing", async () => {
    const h = harness();
    const token = sealToken(base, key);
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    await handleOpen(tampered, null, h.deps);
    await handleOpen("garbage", null, h.deps);
    expect(h.events).toEqual([]);
  });

  it("is a no-op without config", async () => {
    const h = harness();
    await handleOpen(sealToken(base, key), null, { ...h.deps, config: null });
    expect(h.events).toEqual([]);
  });
});

describe("clickDestination", () => {
  let warnSpy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  const sentEnv = {
    EMAIL_TRACKING_SECRET: key.toString("base64"),
    NEXT_PUBLIC_WEB_URL: "https://openbookings.co",
    NEXT_PUBLIC_BUSINESS_URL: "https://business.openbookings.co",
  };

  it("still redirects a valid token to its own-host destination after tracking was disabled", () => {
    const token = sealToken({ ...base, l: "cta", d: "https://business.openbookings.co/stays" }, key);
    const redirect = clickRedirectConfig({ ...sentEnv, EMAIL_TRACKING_ENABLED: "false" });
    expect(clickDestination(token, redirect).destination).toBe("https://business.openbookings.co/stays");
  });

  it("goes home when the secret is missing", () => {
    const token = sealToken({ ...base, l: "cta", d: "https://business.openbookings.co/stays" }, key);
    const redirect = clickRedirectConfig({ ...sentEnv, EMAIL_TRACKING_SECRET: undefined });
    expect(clickDestination(token, redirect).destination).toBe("https://openbookings.co");
  });

  it("warns without the token when a token is rejected", () => {
    clickDestination("garbage-token-content", config);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toEqual(["[email-tracking] click token rejected"]);
  });

  it("returns an own destination", () => {
    const token = sealToken({ ...base, l: "cta", d: "https://openbookings.co/bookings/1" }, key);
    const r = clickDestination(token, config);
    expect(r.destination).toBe("https://openbookings.co/bookings/1");
    expect(r.payload?.l).toBe("cta");
  });
  it("sends a foreign destination to the web home", () => {
    const token = sealToken({ ...base, l: "cta", d: "https://evil.example/x" }, key);
    expect(clickDestination(token, config).destination).toBe("https://openbookings.co");
  });
  it("sends non-http schemes and garbage to the web home", () => {
    const js = sealToken({ ...base, d: "javascript://openbookings.co/%0Aalert(1)" }, key);
    expect(clickDestination(js, config).destination).toBe("https://openbookings.co");
    expect(clickDestination("garbage", config)).toEqual({ destination: "https://openbookings.co", payload: null });
  });
  it("goes home without config", () => {
    const token = sealToken({ ...base, d: "https://openbookings.co/x" }, key);
    expect(clickDestination(token, null)).toEqual({ destination: "https://openbookings.co", payload: null });
  });
});

describe("handleClick", () => {
  it("captures an anonymous team_invitation click without a consent check", async () => {
    const h = harness();
    const payload: TrackingToken = { ...base, k: "team_invitation", u: null, l: "cta", d: "https://business.openbookings.co/x" };
    await handleClick(payload, null, h.deps);
    expect(h.events).toEqual([
      {
        distinctId: "send-1",
        event: "email_clicked",
        anonymous: true,
        properties: {
          email_kind: "team_invitation",
          send_id: "send-1",
          seconds_after_send: 90,
          client_proxy: null,
          link: "cta",
        },
      },
    ]);
    expect(h.consentCalls()).toBe(0);
  });

  it("captures nothing when consent was withdrawn or payload is null", async () => {
    const h = harness(false);
    await handleClick({ ...base, l: "cta" }, null, h.deps);
    await handleClick(null, null, h.deps);
    expect(h.events).toEqual([]);
  });
});

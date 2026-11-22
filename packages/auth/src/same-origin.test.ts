import { describe, expect, test } from "bun:test";
import { csrfRefusal } from "./same-origin";

const HOST = "business.openbookings.co";

function headers(over: Record<string, string | undefined> = {}): Headers {
  const h = new Headers({ host: HOST, cookie: "__Host-ob-host.session_token=abc" });
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) h.delete(k);
    else h.set(k, v);
  }
  return h;
}

const refused = (method: string, path: string, h: Headers) => csrfRefusal(method, path, h)?.status === 403;

describe("csrfRefusal", () => {
  test("a same-site sibling (cdn.) or a cross-site page cannot POST to the API", () => {
    expect(refused("POST", "/api/threads", headers({ "sec-fetch-site": "same-site", origin: "https://cdn.openbookings.co" }))).toBe(true);
    expect(refused("POST", "/api/threads", headers({ "sec-fetch-site": "cross-site", origin: "https://evil.test" }))).toBe(true);
    expect(refused("POST", "/api/threads", headers({ "sec-fetch-site": "none" }))).toBe(true);
  });

  test("every state-changing method is checked", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(refused(method, "/api/property-images/1", headers({ "sec-fetch-site": "same-site" }))).toBe(true);
    }
  });

  test("without Sec-Fetch-Site, a foreign Origin is refused", () => {
    expect(refused("POST", "/api/checkout", headers({ origin: "https://cdn.openbookings.co" }))).toBe(true);
    expect(refused("POST", "/api/checkout", headers({ origin: "null" }))).toBe(true);
    expect(refused("POST", "/api/checkout", headers({ origin: "https://business.openbookings.co.evil.test" }))).toBe(true);
  });

  test("the app's own pages pass", () => {
    expect(csrfRefusal("POST", "/api/threads", headers({ "sec-fetch-site": "same-origin", origin: `https://${HOST}` }))).toBeNull();
    // An older browser without fetch metadata, Origin equal to the host.
    expect(csrfRefusal("POST", "/api/threads", headers({ origin: `https://${HOST}` }))).toBeNull();
  });

  test("behind the proxy, the public host comes from x-forwarded-host", () => {
    const h = headers({ host: "0.0.0.0:8080", "x-forwarded-host": HOST, origin: `https://${HOST}` });
    expect(csrfRefusal("POST", "/api/threads", h)).toBeNull();
    const evil = headers({ host: "0.0.0.0:8080", "x-forwarded-host": HOST, origin: "https://cdn.openbookings.co" });
    expect(refused("POST", "/api/threads", evil)).toBe(true);
  });

  test("a request with neither header, or with no cookie, passes (webhooks, cron, server-to-server)", () => {
    expect(csrfRefusal("POST", "/api/stripe/webhook", headers())).toBeNull();
    expect(csrfRefusal("POST", "/api/cron/pii-retention", headers({ cookie: undefined, "sec-fetch-site": "cross-site" }))).toBeNull();
  });

  test("better-auth's routes are left to better-auth (Apple posts its callback cross-site)", () => {
    expect(csrfRefusal("POST", "/api/auth/callback/apple", headers({ "sec-fetch-site": "cross-site", origin: "https://appleid.apple.com" }))).toBeNull();
    // ...but only that prefix.
    expect(refused("POST", "/api/authx", headers({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  test("reads and non-API paths are not its business", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(csrfRefusal(method, "/api/threads", headers({ "sec-fetch-site": "cross-site" }))).toBeNull();
    }
    expect(csrfRefusal("POST", "/dashboard", headers({ "sec-fetch-site": "cross-site" }))).toBeNull();
  });

  test("the refusal is a JSON 403 that is not cached", async () => {
    const res = csrfRefusal("POST", "/api/threads", headers({ "sec-fetch-site": "same-site" }))!;
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

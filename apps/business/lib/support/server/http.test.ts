import { beforeEach, describe, expect, test } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

let scopeLookups = 0;

await mockModules(import.meta.dir, {
  "./bootstrap": () => ({
    currentSupportScope: async () => {
      scopeLookups++;
      return { userId: "host-1" };
    },
  }),
  "./service": () => ({ SupportError: class SupportError extends Error {} }),
  "@/lib/rateLimit": () => ({ checkRateLimit: () => ({ allowed: true }) }),
  // The real bootstrap and service need the auth env just to import.
}, ["./bootstrap", "./service"]);

const { supportRoute } = await import("./http");

const LIMIT = { key: "t", max: 10, windowMs: 1000 };
const HOST = "business.openbookings.co";

function post(headers: Record<string, string>) {
  return new Request(`https://${HOST}/api/support/tickets`, {
    method: "POST",
    headers: { host: HOST, cookie: "__Host-ob-host.session_token=abc", ...headers },
  });
}

describe("supportRoute CSRF check (these routes sit outside the proxy matcher)", () => {
  beforeEach(() => {
    scopeLookups = 0;
  });

  test("a multipart POST from a sibling subdomain is refused before the session is read", async () => {
    let ran = false;
    const res = await supportRoute(post({ "sec-fetch-site": "same-site", origin: "https://cdn.openbookings.co" }), LIMIT, async () => {
      ran = true;
    });
    expect(res.status).toBe(403);
    expect(ran).toBe(false);
    expect(scopeLookups).toBe(0);
  });

  test("the app's own page gets through", async () => {
    const res = await supportRoute(post({ "sec-fetch-site": "same-origin" }), LIMIT, async () => "ok");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: "ok" });
  });
});

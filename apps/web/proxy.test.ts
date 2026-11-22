import { beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
// Not next/experimental/testing/server: importing it patches console in a way
// that breaks console.error for every test file that runs after this one.
// Next compiles matchers with this same (untyped) path-to-regexp build.
// @ts-expect-error Next ships this build without type declarations.
import { pathToRegexp as compileMatcher } from "next/dist/compiled/path-to-regexp";
const pathToRegexp = compileMatcher as (source: string) => RegExp;
import { mockModules } from "@/lib/mock-modules";

const calls: string[] = [];

await mockModules(
  import.meta.dir,
  {
    "@openbookings/auth/env": () => ({
      readAuthEnv: () => ({ BETTER_AUTH_SECRET: "x".repeat(32), AUTH_COOKIE_PREFIX: "ob-guest", AUTH_BASE_URL: "https://openbookings.co" }),
    }),
    "@/lib/auth": () => ({
      auth: {
        api: {
          getSession: async () => {
            calls.push("getSession");
            return null;
          },
        },
      },
      // Same export shape as the other tests' mocks of this module: bun keeps
      // the first shape, so a missing export would stay missing for them.
      getServerSession: async () => null,
    }),
  },
  ["@/lib/auth"],
);

const { proxy, config } = await import("./proxy");

const HOST = "openbookings.co";

function post(path: string, headers: Record<string, string>) {
  return new NextRequest(`https://${HOST}${path}`, {
    method: "POST",
    headers: { host: HOST, cookie: "__Host-ob-guest.session_token=abc", ...headers },
  });
}

describe("web proxy: CSRF on /api", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test("a POST from a sibling subdomain (business., cdn.) is refused", async () => {
    for (const path of ["/api/booking-intents", "/api/threads", "/api/checkout", "/api/realtime/token"]) {
      const res = await proxy(post(path, { "sec-fetch-site": "same-site", origin: "https://business.openbookings.co" }));
      expect(res.status).toBe(403);
    }
    expect(calls).toEqual([]);
  });

  test("a same-origin API request passes through without the /bookings sign-in redirect", async () => {
    const res = await proxy(post("/api/booking-intents", { "sec-fetch-site": "same-origin", origin: `https://${HOST}` }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(calls).toEqual([]);
  });

  test("the matcher covers /api except better-auth's routes, and still /bookings", () => {
    const matches = (path: string) => config.matcher.some((source) => pathToRegexp(source).test(path));
    for (const path of ["/api/threads", "/api/booking-intents/i-1/expire", "/api/checkout", "/bookings", "/bookings/b-1"]) {
      expect(matches(path)).toBe(true);
    }
    for (const path of ["/api/auth/callback/apple", "/api/auth/login-link", "/", "/p/some-hotel"]) {
      expect(matches(path)).toBe(false);
    }
  });
});

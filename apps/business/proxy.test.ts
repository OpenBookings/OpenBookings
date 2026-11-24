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
      readAuthEnv: () => ({ BETTER_AUTH_SECRET: "x".repeat(32), AUTH_COOKIE_PREFIX: "ob-host", AUTH_BASE_URL: "https://business.openbookings.co" }),
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
    "@/lib/onboarding-facts": () => ({
      getOnboardingFacts: async () => {
        calls.push("getOnboardingFacts");
        return {};
      },
      wizardInProgress: () => false,
    }),
    "@openbookings/demo": () => ({
      ensureDemoMembership: async () => calls.push("ensureDemoMembership"),
      isTestingMode: () => true,
    }),
  },
  ["@/lib/auth"],
);

const { proxy, config } = await import("./proxy");

const HOST = "business.openbookings.co";

function post(path: string, headers: Record<string, string>) {
  return new NextRequest(`https://${HOST}${path}`, {
    method: "POST",
    headers: { host: HOST, cookie: "__Host-ob-host.session_token=abc", ...headers },
  });
}

describe("business proxy: CSRF on /api", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test("a same-site POST from a sibling subdomain is refused before anything runs", async () => {
    const res = await proxy(post("/api/threads/t-1/messages", { "sec-fetch-site": "same-site", origin: "https://cdn.openbookings.co" }));
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("a same-origin API request passes straight through: no session lookup, no onboarding or demo work", async () => {
    const res = await proxy(post("/api/upload/presign", { "sec-fetch-site": "same-origin", origin: `https://${HOST}` }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(calls).toEqual([]);
  });

  test("a cookie-less app request (Apps API v1) is never refused, whatever its origin headers", async () => {
    for (const [method, path] of [["POST", "/api/apps/v1/ari"], ["PUT", "/api/apps/v1/bookings/b-1/delivery"]] as const) {
      const res = await proxy(
        new NextRequest(`https://${HOST}${path}`, { method, headers: { host: HOST, authorization: `Bearer obk_${"a".repeat(40)}` } }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    expect(calls).toEqual([]);
  });

  test("the matcher covers /api, except better-auth and the multipart support uploads", () => {
    const matches = (path: string) => config.matcher.some((source) => pathToRegexp(source).test(path));
    for (const path of ["/api/threads", "/api/threads/t-1/messages", "/api/upload/confirm", "/api/stripe/account-link", "/api/realtime/token", "/dashboard/listings"]) {
      expect(matches(path)).toBe(true);
    }
    for (const path of ["/api/auth/callback/apple", "/api/auth/sign-in/email", "/api/support/tickets", "/api/support/tickets/t-1/messages", "/"]) {
      expect(matches(path)).toBe(false);
    }
  });
});

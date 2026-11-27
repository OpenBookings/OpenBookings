import { describe, expect, test } from "bun:test";
import { databaseHost, stripeKeyAllowed, isSuperAdminEnabled } from "./super-admin";

describe("isSuperAdminEnabled", () => {
  test('on only with "1" in development', () => {
    expect(isSuperAdminEnabled({ ADMIN_SUPER_MODE: "1", NODE_ENV: "development" })).toBe(true);
  });

  test("off for look-alike values", () => {
    for (const v of ["true", " 1", "0", "", undefined]) {
      expect(isSuperAdminEnabled({ ADMIN_SUPER_MODE: v, NODE_ENV: "development" })).toBe(false);
    }
  });

  test("off in production and test", () => {
    for (const env of ["production", "test"]) {
      expect(isSuperAdminEnabled({ ADMIN_SUPER_MODE: "1", NODE_ENV: env })).toBe(false);
    }
  });
});

describe("databaseHost", () => {
  test("extracts the host", () => {
    expect(databaseHost("postgres://u:p@ep-x.neon.tech/db?sslmode=require")).toBe("ep-x.neon.tech");
  });
  test("unknown for missing or invalid", () => {
    expect(databaseHost(undefined)).toBe("unknown");
    expect(databaseHost("not a url")).toBe("unknown");
  });
});

describe("stripeKeyAllowed", () => {
  test("production allows a live key", () => {
    expect(stripeKeyAllowed({ NODE_ENV: "production", STRIPE_SECRET_KEY: "sk_live_abc" })).toEqual({ ok: true });
  });
  test("development refuses a live key", () => {
    for (const key of ["sk_live_abc", "rk_live_abc"]) {
      expect(stripeKeyAllowed({ NODE_ENV: "development", STRIPE_SECRET_KEY: key })).toEqual({
        ok: false,
        error: "Stripe is not in test mode here, so real booking actions are off.",
      });
    }
  });
  test("development allows a test key", () => {
    for (const key of ["sk_test_abc", "rk_test_abc"]) {
      expect(stripeKeyAllowed({ NODE_ENV: "development", STRIPE_SECRET_KEY: key })).toEqual({ ok: true });
    }
  });
  test("development without a key is refused", () => {
    expect(stripeKeyAllowed({ NODE_ENV: "development" }).ok).toBe(false);
  });
});

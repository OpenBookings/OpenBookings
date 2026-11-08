import { describe, expect, test } from "bun:test";
import { assertModeMatch, ModeMismatchError } from "./guards";

const LIVE = "sk_live_" + "x".repeat(24);
const TEST = "sk_test_" + "x".repeat(24);

describe("assertModeMatch", () => {
  test("live key against a non-production database is refused", () => {
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: LIVE, INVOICE_DB_ENV: "test" })).toThrow(ModeMismatchError);
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: "rk_live_abc", INVOICE_DB_ENV: "test" })).toThrow(ModeMismatchError);
  });

  test("an unset, empty or mistyped database label is refused for either key", () => {
    for (const key of [LIVE, TEST]) {
      expect(() => assertModeMatch({ STRIPE_SECRET_KEY: key })).toThrow(ModeMismatchError);
      expect(() => assertModeMatch({ STRIPE_SECRET_KEY: key })).toThrow(/INVOICE_DB_ENV/);
      expect(() => assertModeMatch({ STRIPE_SECRET_KEY: key, INVOICE_DB_ENV: "" })).toThrow(ModeMismatchError);
      expect(() => assertModeMatch({ STRIPE_SECRET_KEY: key, INVOICE_DB_ENV: "prod" })).toThrow(ModeMismatchError);
      expect(() => assertModeMatch({ STRIPE_SECRET_KEY: key, INVOICE_DB_ENV: "Production" })).toThrow(ModeMismatchError);
      expect(() => assertModeMatch({ STRIPE_SECRET_KEY: key, INVOICE_DB_ENV: "dev" })).toThrow(ModeMismatchError);
    }
  });

  test("test key against the production database is refused", () => {
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: TEST, INVOICE_DB_ENV: "production" })).toThrow(ModeMismatchError);
  });

  test("matching key and database give the mode", () => {
    expect(assertModeMatch({ STRIPE_SECRET_KEY: LIVE, INVOICE_DB_ENV: "production" })).toBe("live");
    expect(assertModeMatch({ STRIPE_SECRET_KEY: TEST, INVOICE_DB_ENV: "test" })).toBe("test");
  });

  test("a missing or unrecognised key is refused", () => {
    expect(() => assertModeMatch({})).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: "pk_live_abc", INVOICE_DB_ENV: "production" })).toThrow(/STRIPE_SECRET_KEY/);
  });
});

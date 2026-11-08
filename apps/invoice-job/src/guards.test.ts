import { describe, expect, test } from "bun:test";
import { assertModeMatch, ModeMismatchError } from "./guards";

const LIVE = "sk_live_" + "x".repeat(24);
const TEST = "sk_test_" + "x".repeat(24);

describe("assertModeMatch", () => {
  test("live key against a non-production database is refused", () => {
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: LIVE })).toThrow(ModeMismatchError);
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: LIVE, INVOICE_DB_ENV: "test" })).toThrow(ModeMismatchError);
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: "rk_live_abc", INVOICE_DB_ENV: "dev" })).toThrow(ModeMismatchError);
  });

  test("test key against the production database is refused", () => {
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: TEST, INVOICE_DB_ENV: "production" })).toThrow(ModeMismatchError);
  });

  test("matching key and database give the mode", () => {
    expect(assertModeMatch({ STRIPE_SECRET_KEY: LIVE, INVOICE_DB_ENV: "production" })).toBe("live");
    expect(assertModeMatch({ STRIPE_SECRET_KEY: TEST })).toBe("test");
    expect(assertModeMatch({ STRIPE_SECRET_KEY: TEST, INVOICE_DB_ENV: "test" })).toBe("test");
  });

  test("a missing or unrecognised key is refused", () => {
    expect(() => assertModeMatch({})).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => assertModeMatch({ STRIPE_SECRET_KEY: "pk_live_abc", INVOICE_DB_ENV: "production" })).toThrow(/STRIPE_SECRET_KEY/);
  });
});

import { describe, expect, test } from "bun:test";
import { assertTestingModeSafe, isTestingMode } from "./mode";

describe("isTestingMode", () => {
  test("true with TESTING=true and a test key", () => {
    expect(
      isTestingMode({ TESTING: "true", STRIPE_SECRET_KEY: "sk_test_x" }),
    ).toBe(true);
  });

  test("false with a live key", () => {
    expect(
      isTestingMode({ TESTING: "true", STRIPE_SECRET_KEY: "sk_live_x" }),
    ).toBe(false);
  });

  test("false when unset", () => {
    expect(isTestingMode({})).toBe(false);
  });

  test("false for TESTING values other than 'true'", () => {
    expect(
      isTestingMode({ TESTING: "1", STRIPE_SECRET_KEY: "sk_test_x" }),
    ).toBe(false);
  });
});

describe("assertTestingModeSafe", () => {
  test("throws with TESTING=true and a live key", () => {
    expect(() =>
      assertTestingModeSafe({ TESTING: "true", STRIPE_SECRET_KEY: "sk_live_x" }),
    ).toThrow(/TESTING=true requires a Stripe test key/);
  });

  test("throws with TESTING=true and no key", () => {
    expect(() => assertTestingModeSafe({ TESTING: "true" })).toThrow(
      /TESTING=true requires a Stripe test key/,
    );
  });

  test("does not throw with a test key", () => {
    expect(() =>
      assertTestingModeSafe({ TESTING: "true", STRIPE_SECRET_KEY: "sk_test_x" }),
    ).not.toThrow();
  });

  test("does not throw when TESTING is unset or not 'true'", () => {
    expect(() => assertTestingModeSafe({})).not.toThrow();
    expect(() =>
      assertTestingModeSafe({ TESTING: "1", STRIPE_SECRET_KEY: "sk_live_x" }),
    ).not.toThrow();
  });
});

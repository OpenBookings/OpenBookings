import { describe, expect, test } from "bun:test";
import { assertApplicationFeeSafe } from "./application-fee-guard";

describe("assertApplicationFeeSafe", () => {
  test("throws with a live key and the fee flag unset", () => {
    expect(() => assertApplicationFeeSafe({ STRIPE_SECRET_KEY: "sk_live_x" })).toThrow(
      /requires STRIPE_APPLICATION_FEE_ENABLED=true/,
    );
  });

  test("throws with a live key and the fee flag off or not exactly 'true'", () => {
    for (const flag of ["false", "1", "TRUE", ""]) {
      expect(() =>
        assertApplicationFeeSafe({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_APPLICATION_FEE_ENABLED: flag }),
      ).toThrow();
    }
  });

  test("passes with a live key and the fee flag on", () => {
    expect(() =>
      assertApplicationFeeSafe({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_APPLICATION_FEE_ENABLED: "true" }),
    ).not.toThrow();
  });

  test("passes with a test key or no key, whatever the flag", () => {
    expect(() => assertApplicationFeeSafe({ STRIPE_SECRET_KEY: "sk_test_x" })).not.toThrow();
    expect(() =>
      assertApplicationFeeSafe({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_APPLICATION_FEE_ENABLED: "false" }),
    ).not.toThrow();
    expect(() => assertApplicationFeeSafe({})).not.toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import { completionPrecheck } from "./onboarding-completion";

describe("completionPrecheck", () => {
  test("a wizard with no Stripe account cannot complete", () => {
    expect(completionPrecheck({ stripeAccountId: null, completedOrg: null })).toBe("no-account");
  });

  test("a wizard whose account is on no completed organisation goes on to the readiness check", () => {
    expect(completionPrecheck({ stripeAccountId: "acct_1", completedOrg: null })).toBe("proceed");
  });

  test("a removed owner cannot provision a second organisation on the same Stripe account", () => {
    expect(completionPrecheck({ stripeAccountId: "acct_1", completedOrg: { callerIsMember: false } })).toBe(
      "account-taken",
    );
  });

  test("completing again while still a member is a no-op, not an error", () => {
    expect(completionPrecheck({ stripeAccountId: "acct_1", completedOrg: { callerIsMember: true } })).toBe(
      "already-complete",
    );
  });
});

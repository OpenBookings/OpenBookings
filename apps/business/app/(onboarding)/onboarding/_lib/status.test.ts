import { describe, expect, test } from "bun:test";
import { resolveOnboardingRedirect, summariseStripeAccount, type OnboardingRow } from "./status";

const allSteps = ["core-info-location", "core-info-text", "legal-n-boring"];
const row = (over: Partial<OnboardingRow> = {}): OnboardingRow => ({
  completed_steps: allSteps,
  stripe_account_id: "acct_1",
  wizardFinished: false,
  hasCompletedOrg: false,
  ...over,
});

describe("resolveOnboardingRedirect", () => {
  test("a host whose wizard finished goes to the dashboard", () => {
    expect(resolveOnboardingRedirect(row({ wizardFinished: true, hasCompletedOrg: true }))).toBe("/dashboard");
  });

  test("a host whose wizard finished but who belongs to no completed organisation has no access", () => {
    expect(resolveOnboardingRedirect(row({ wizardFinished: true, hasCompletedOrg: false }))).toBe("no-access");
  });

  test("a member of another organisation running the wizard still gets step routing", () => {
    expect(resolveOnboardingRedirect(row({ completed_steps: [], hasCompletedOrg: true }))).toBe("/onboarding/core-info");
  });

  test("a host with every step done and a Stripe account belongs on the verify step", () => {
    expect(resolveOnboardingRedirect(row())).toBeNull();
  });

  test("a host with every step done but no Stripe account goes back to legal", () => {
    expect(resolveOnboardingRedirect(row({ stripe_account_id: null }))).toBe("/onboarding/legal");
  });
});

describe("summariseStripeAccount", () => {
  test("maps a Stripe account to the readiness shape, treating missing fields as not ready", () => {
    expect(summariseStripeAccount({ id: "acct_1" } as never)).toEqual({
      accountId: "acct_1",
      currentlyDue: [],
      eventuallyDue: [],
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });
});

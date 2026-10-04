import { describe, expect, test } from "bun:test";
import { onboardingWallDecision } from "./onboarding-wall";

// The five kinds of user from the design, by the two facts the wall reads.
const users = {
  "host mid-wizard": { hasCompletedOrg: false, wizardInProgress: true },
  "host who finished": { hasCompletedOrg: true, wizardInProgress: false },
  "invited member who never ran the wizard": { hasCompletedOrg: true, wizardInProgress: false },
  "member of one org onboarding their own business": { hasCompletedOrg: true, wizardInProgress: true },
  "owner removed from their organisation": { hasCompletedOrg: false, wizardInProgress: false },
} as const;

const expected: Record<keyof typeof users, { dashboard: string; onboarding: string }> = {
  "host mid-wizard": { dashboard: "/onboarding", onboarding: "allow" },
  "host who finished": { dashboard: "allow", onboarding: "/dashboard" },
  "invited member who never ran the wizard": { dashboard: "allow", onboarding: "/dashboard" },
  "member of one org onboarding their own business": { dashboard: "allow", onboarding: "allow" },
  "owner removed from their organisation": { dashboard: "/onboarding", onboarding: "allow" },
};

describe("onboardingWallDecision", () => {
  for (const [name, facts] of Object.entries(users) as [keyof typeof users, (typeof users)[keyof typeof users]][]) {
    test(`${name}: /dashboard → ${expected[name].dashboard}, /onboarding → ${expected[name].onboarding}`, () => {
      expect(onboardingWallDecision({ path: "/dashboard/finance", ...facts })).toBe(expected[name].dashboard as never);
      expect(onboardingWallDecision({ path: "/onboarding/stripe", ...facts })).toBe(expected[name].onboarding as never);
    });
  }

  test("anyone without a completed organisation may always reach onboarding, so no redirect loops", () => {
    for (const wizardInProgress of [true, false]) {
      expect(onboardingWallDecision({ path: "/onboarding", hasCompletedOrg: false, wizardInProgress })).toBe("allow");
    }
  });

  test("paths outside the wall are left alone", () => {
    expect(onboardingWallDecision({ path: "/account", hasCompletedOrg: false, wizardInProgress: false })).toBe("allow");
  });
});

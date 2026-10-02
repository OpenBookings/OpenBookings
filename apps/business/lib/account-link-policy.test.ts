import { describe, expect, test } from "bun:test";
import { accountLinkDecision } from "./account-link-policy";

const base = { isOwner: true, stripeAccountId: "acct_1", onboardingComplete: false, requirementsDue: 0 };

describe("accountLinkDecision", () => {
  test("an owner still onboarding gets a link", () => {
    expect(accountLinkDecision(base)).toBe("ok");
  });

  test("an owner whose account needs something again gets a link, even after onboarding", () => {
    expect(accountLinkDecision({ ...base, onboardingComplete: true, requirementsDue: 2 })).toBe("ok");
  });

  test("anyone who is not an owner is refused, whatever the account's state", () => {
    expect(accountLinkDecision({ ...base, isOwner: false })).toBe("forbidden");
    expect(accountLinkDecision({ ...base, isOwner: false, onboardingComplete: true, requirementsDue: 3 })).toBe("forbidden");
  });

  test("no connected account means there is nothing to link to", () => {
    expect(accountLinkDecision({ ...base, stripeAccountId: null })).toBe("no-account");
  });

  test("a finished account with nothing due gets no link: changes happen in the Stripe Dashboard", () => {
    expect(accountLinkDecision({ ...base, onboardingComplete: true })).toBe("complete");
  });
});

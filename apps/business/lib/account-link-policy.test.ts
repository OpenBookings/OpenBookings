import { describe, expect, test } from "bun:test";
import { accountLinkDecision, accountLinkSubject } from "./account-link-policy";

describe("accountLinkSubject", () => {
  test("a host mid-wizard is the owner-to-be of the wizard's account", () => {
    expect(
      accountLinkSubject({ wizard: { stripeAccountId: "acct_new", inProgress: true }, ownedStripeAccountId: "acct_other" }),
    ).toEqual({ stripeAccountId: "acct_new", isOwner: true, onboardingComplete: false });
  });

  test("after the wizard, only an owned organisation's account counts", () => {
    expect(
      accountLinkSubject({ wizard: { stripeAccountId: "acct_1", inProgress: false }, ownedStripeAccountId: "acct_1" }),
    ).toEqual({ stripeAccountId: "acct_1", isOwner: true, onboardingComplete: true });
  });

  test("an ex-owner who still has a wizard row is refused", () => {
    const subject = accountLinkSubject({
      wizard: { stripeAccountId: "acct_1", inProgress: false },
      ownedStripeAccountId: null,
    });
    expect(accountLinkDecision({ ...subject, requirementsDue: 3 })).toBe("forbidden");
  });

  test("someone who never ran the wizard and owns nothing simply has no account", () => {
    const subject = accountLinkSubject({ wizard: null, ownedStripeAccountId: null });
    expect(accountLinkDecision({ ...subject, requirementsDue: 0 })).toBe("no-account");
  });
});

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

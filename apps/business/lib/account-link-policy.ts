/**
 * Whether a Stripe onboarding link may be minted for this caller.
 *
 * The link is for getting a connected account set up, or set up again when
 * Stripe asks for more. It is not how payout details are changed: those live
 * in the host's own Stripe Dashboard, behind Stripe's login. So once the
 * account needs nothing, there is no link to give.
 *
 * Only an owner: the connected account is the organisation's money.
 */
export type AccountLinkDecision = "ok" | "forbidden" | "no-account" | "complete";

/**
 * Which account the caller is asking about, and whether they own it.
 *
 * - Mid-wizard (the wizard's Stripe account is on no completed organisation)
 *   there is no organisation yet. The person onboarding is its owner-to-be,
 *   whatever their role in some other organisation.
 * - Otherwise, only an owner of the organisation the account belongs to. Not
 *   "whoever has a wizard row": a removed or demoted ex-owner still has one,
 *   and a second owner never did.
 */
export function accountLinkSubject(input: {
  wizard: { stripeAccountId: string | null; inProgress: boolean } | null;
  /** An account on an organisation the caller owns, preferring the wizard's. */
  ownedStripeAccountId: string | null;
}): { stripeAccountId: string | null; isOwner: boolean; onboardingComplete: boolean } {
  if (input.wizard?.inProgress) {
    return { stripeAccountId: input.wizard.stripeAccountId, isOwner: true, onboardingComplete: false };
  }
  return {
    stripeAccountId: input.ownedStripeAccountId,
    // No owned organisation with an account. If the user has nothing at all
    // there is simply no account; if they onboarded once but own nothing now,
    // they are no longer entitled to it.
    isOwner: input.ownedStripeAccountId !== null || !input.wizard,
    onboardingComplete: true,
  };
}

export function accountLinkDecision(input: {
  isOwner: boolean;
  stripeAccountId: string | null;
  onboardingComplete: boolean;
  /** How many requirements Stripe currently has outstanding. */
  requirementsDue: number;
}): AccountLinkDecision {
  if (!input.isOwner) return "forbidden";
  if (!input.stripeAccountId) return "no-account";
  if (input.onboardingComplete && input.requirementsDue === 0) return "complete";
  return "ok";
}

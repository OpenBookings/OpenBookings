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

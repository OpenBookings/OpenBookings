/**
 * Whether completeOnboarding() may go ahead, before it asks Stripe whether
 * the account is ready (see isStripeAccountReady).
 *
 * `completedOrg` is the organisation that already finished onboarding with the
 * wizard's Stripe account, if any. Someone who is no longer a member of it is
 * a removed owner: completing again would provision them a second
 * organisation on the same account.
 */
export type CompletionPrecheck = "proceed" | "already-complete" | "no-account" | "account-taken";

export function completionPrecheck(input: {
  stripeAccountId: string | null;
  completedOrg: { callerIsMember: boolean } | null;
}): CompletionPrecheck {
  if (!input.stripeAccountId) return "no-account";
  if (input.completedOrg) return input.completedOrg.callerIsMember ? "already-complete" : "account-taken";
  return "proceed";
}

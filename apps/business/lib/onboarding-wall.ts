/**
 * Which side of the onboarding wall a request belongs on.
 *
 * Both facts derive from `org_profile.onboarding_completed_at` (see
 * lib/onboarding-facts.ts), never from the wizard's own scratchpad row:
 *
 * - `hasCompletedOrg`: the user is a member, in any role, of an organisation
 *   that finished onboarding. That is what the dashboard needs.
 * - `wizardInProgress`: the user has a wizard row whose Stripe account is not
 *   yet on a completed organisation. Such a user may be in onboarding even if
 *   they already belong to another organisation.
 *
 * - `hasDemoMembership`: the user belongs to the demo organisation (testing
 *   mode). It opens the dashboard but is not a completed organisation, so a
 *   demo-only host can still start onboarding for their own.
 *
 * A user without a completed organisation is always allowed into onboarding,
 * so the two redirects can never bounce into each other.
 */
export type OnboardingWallDecision = "allow" | "/onboarding" | "/dashboard";

export function onboardingWallDecision(input: {
  path: string;
  hasCompletedOrg: boolean;
  hasDemoMembership?: boolean;
  wizardInProgress: boolean;
}): OnboardingWallDecision {
  if (input.path.startsWith("/dashboard")) {
    return input.hasCompletedOrg || input.hasDemoMembership ? "allow" : "/onboarding";
  }
  if (input.path.startsWith("/onboarding")) {
    return input.wizardInProgress || !input.hasCompletedOrg ? "allow" : "/dashboard";
  }
  return "allow";
}

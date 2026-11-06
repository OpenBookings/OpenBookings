import { queryOne } from "@openbookings/db";
import { DEMO_ORG_ID } from "@openbookings/demo";

/**
 * What the onboarding wall, the onboarding pages and the account-link route
 * need to know about a user, in one query.
 *
 * Completion lives on the organisation (`org_profile.onboarding_completed_at`,
 * written only by completeOnboarding()). `host_onboarding` is the wizard's
 * scratchpad and is read here only for step progress and the Stripe account
 * the wizard created; its own completion column is not consulted.
 */
export type OnboardingFacts = {
  /** Member, in any role, of an organisation that finished onboarding. */
  hasCompletedOrg: boolean;
  /** Member of the demo organisation, which only exists in testing mode. */
  hasDemoMembership: boolean;
  /** The user's wizard row, or null if they never started the wizard. */
  wizard: {
    completedSteps: string[];
    stripeAccountId: string | null;
    /** The wizard's Stripe account is on an organisation that finished onboarding. */
    finished: boolean;
  } | null;
};

export async function getOnboardingFacts(
  userId: string,
  run: typeof queryOne = queryOne,
): Promise<OnboardingFacts> {
  const row = await run<{
    has_completed_org: boolean;
    has_demo_membership: boolean;
    has_wizard: boolean;
    completed_steps: string[] | null;
    stripe_account_id: string | null;
    wizard_finished: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM "member" m
         JOIN org_profile op ON op.organization_id = m."organizationId"
         WHERE m."userId" = $1 AND op.onboarding_completed_at IS NOT NULL
       ) AS has_completed_org,
       EXISTS (
         SELECT 1 FROM "member" WHERE "userId" = $1 AND "organizationId" = $2
       ) AS has_demo_membership,
       ho.user_id IS NOT NULL AS has_wizard,
       ho.completed_steps,
       ho.step_data->>'stripe_account_id' AS stripe_account_id,
       EXISTS (
         SELECT 1 FROM org_profile op
         WHERE op.stripe_account_id = ho.step_data->>'stripe_account_id'
           AND op.onboarding_completed_at IS NOT NULL
       ) AS wizard_finished
     FROM (SELECT 1) AS one
     LEFT JOIN host_onboarding ho ON ho.user_id = $1`,
    [userId, DEMO_ORG_ID],
  );

  return {
    hasCompletedOrg: row?.has_completed_org ?? false,
    hasDemoMembership: row?.has_demo_membership ?? false,
    wizard: row?.has_wizard
      ? {
          completedSteps: row.completed_steps ?? [],
          stripeAccountId: row.stripe_account_id,
          finished: row.wizard_finished,
        }
      : null,
  };
}

/** A wizard row whose Stripe account is on no completed organisation (or has none yet). */
export function wizardInProgress(facts: OnboardingFacts): boolean {
  return facts.wizard !== null && !facts.wizard.finished;
}

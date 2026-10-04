import { retrieveConnectAccount } from "@openbookings/stripe";
import { getOnboardingFacts } from "@/lib/onboarding-facts";
import type { StripeAccountSummary } from "@/lib/stripe-readiness";
import type { DbStep } from "../actions";

export const SLUG_FOR_DB_STEP: Record<DbStep, string> = {
  "core-info-text": "core-info",
  "core-info-location": "address",
  "legal-n-boring": "legal",
};

export const DATA_STEPS: DbStep[] = ["core-info-text", "core-info-location", "legal-n-boring"];

export interface OnboardingRow {
  completed_steps: string[];
  stripe_account_id: string | null;
  /** The Stripe account this wizard created is on a completed organisation. */
  wizardFinished: boolean;
  /** Member, in any role, of an organisation that finished onboarding. */
  hasCompletedOrg: boolean;
}

export interface OnboardingStatus {
  steps: { coreInfoText: boolean; coreInfoLocation: boolean; legalNBoring: boolean };
  stripe: StripeAccountSummary | null;
  onboardingCompleted: boolean;
}

/** The user's wizard row with its completion facts, or null if they never started the wizard. */
export async function getOnboardingRow(userId: string): Promise<OnboardingRow | null> {
  const facts = await getOnboardingFacts(userId);
  if (!facts.wizard) return null;
  return {
    completed_steps: facts.wizard.completedSteps,
    stripe_account_id: facts.wizard.stripeAccountId,
    wizardFinished: facts.wizard.finished,
    hasCompletedOrg: facts.hasCompletedOrg,
  };
}

/**
 * Where the user should be sent instead of the Stripe verify step, or null if
 * the verify step is the right place for them.
 *
 * "no-access": the wizard finished, but the user no longer belongs to any
 * completed organisation (an owner who was removed). Not a URL: the onboarding
 * index renders it as a page of its own.
 */
export function resolveOnboardingRedirect(row: OnboardingRow | null): string | "no-access" | null {
  if (row?.wizardFinished) return row.hasCompletedOrg ? "/dashboard" : "no-access";

  const completed = new Set(row?.completed_steps ?? []);
  const nextData = DATA_STEPS.find((s) => !completed.has(s));
  if (nextData) return `/onboarding/${SLUG_FOR_DB_STEP[nextData]}`;

  if (!row?.stripe_account_id) return "/onboarding/legal";

  return null;
}

/** The parts of a connected account that decide whether it is ready for bookings. */
export function summariseStripeAccount(
  account: Awaited<ReturnType<typeof retrieveConnectAccount>>,
): StripeAccountSummary {
  return {
    accountId: account.id,
    currentlyDue: account.requirements?.currently_due ?? [],
    eventuallyDue: account.requirements?.eventually_due ?? [],
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  };
}

/** Full onboarding status (including live Stripe requirements) for a row. */
export async function getOnboardingStatus(row: OnboardingRow | null): Promise<OnboardingStatus> {
  const completed = new Set(row?.completed_steps ?? []);

  let stripe: OnboardingStatus["stripe"] = null;
  if (row?.stripe_account_id) {
    stripe = summariseStripeAccount(await retrieveConnectAccount(row.stripe_account_id));
  }

  return {
    steps: {
      coreInfoText: completed.has("core-info-text"),
      coreInfoLocation: completed.has("core-info-location"),
      legalNBoring: completed.has("legal-n-boring"),
    },
    stripe,
    onboardingCompleted: row?.wizardFinished ?? false,
  };
}

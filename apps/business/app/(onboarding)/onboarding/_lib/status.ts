import { queryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";
import type { DbStep } from "../actions";

export const SLUG_FOR_DB_STEP: Record<DbStep, string> = {
  "core-info-text": "core-info",
  "core-info-location": "address",
  "legal-n-boring": "legal",
};

export const DATA_STEPS: DbStep[] = ["core-info-text", "core-info-location", "legal-n-boring"];

export interface OnboardingRow {
  completed_steps: string[];
  onboarding_completed_at: string | null;
  stripe_account_id: string | null;
}

export interface OnboardingStatus {
  steps: { coreInfoText: boolean; coreInfoLocation: boolean; legalNBoring: boolean };
  stripe: {
    accountId: string;
    currentlyDue: string[];
    eventuallyDue: string[];
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
  } | null;
  onboardingCompleted: boolean;
}

export async function getOnboardingRow(userId: string): Promise<OnboardingRow | null> {
  return queryOne<OnboardingRow>(
    `SELECT completed_steps,
            onboarding_completed_at,
            step_data->>'stripe_account_id' AS stripe_account_id
     FROM host_onboarding WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Where the user should be sent instead of the Stripe verify step, or null if
 * the verify step is the right place for them.
 */
export function resolveOnboardingRedirect(row: OnboardingRow | null): string | null {
  if (row?.onboarding_completed_at) return "/dashboard";

  const completed = new Set(row?.completed_steps ?? []);
  const nextData = DATA_STEPS.find((s) => !completed.has(s));
  if (nextData) return `/onboarding/${SLUG_FOR_DB_STEP[nextData]}`;

  if (!row?.stripe_account_id) return "/onboarding/legal";

  return null;
}

/** Full onboarding status (including live Stripe requirements) for a row. */
export async function getOnboardingStatus(row: OnboardingRow | null): Promise<OnboardingStatus> {
  const completed = new Set(row?.completed_steps ?? []);

  let stripe: OnboardingStatus["stripe"] = null;
  if (row?.stripe_account_id) {
    const account = await retrieveConnectAccount(row.stripe_account_id);
    stripe = {
      accountId: account.id,
      currentlyDue: account.requirements?.currently_due ?? [],
      eventuallyDue: account.requirements?.eventually_due ?? [],
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
    };
  }

  return {
    steps: {
      coreInfoText: completed.has("core-info-text"),
      coreInfoLocation: completed.has("core-info-location"),
      legalNBoring: completed.has("legal-n-boring"),
    },
    stripe,
    onboardingCompleted: !!row?.onboarding_completed_at,
  };
}

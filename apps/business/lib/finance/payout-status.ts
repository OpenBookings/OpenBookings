import { roleAllows, type CurrentProperty } from "@openbookings/authz";
import { queryOne as dbQueryOne } from "@openbookings/db";
import { retrieveConnectAccount } from "@openbookings/stripe";

export type PayoutStatus =
  | { state: "hidden" }
  | { state: "none" }
  | { state: "unavailable" }
  | { state: "ok"; payoutsEnabled: boolean; requirementsDue: number };

type StripeAccount = {
  payouts_enabled?: boolean | null;
  requirements?: { currently_due?: string[] | null } | null;
};

export type PayoutDeps = {
  queryOne: <T>(sql: string, values?: unknown[]) => Promise<T | null>;
  retrieveAccount: (accountId: string) => Promise<StripeAccount>;
};

const defaultDeps: PayoutDeps = {
  queryOne: dbQueryOne,
  retrieveAccount: retrieveConnectAccount,
};

/**
 * Where the current hotel's payouts stand, straight from Stripe. Read-only:
 * no bank details are fetched, shown or stored here. Those live in the
 * organization's own Stripe Dashboard, behind Stripe's login.
 *
 * With a current hotel the account is the current organization's
 * (org_profile), else that hotel's own properties.stripe_account_id. Never
 * the user's onboarding account: that belongs to whichever org the user
 * onboarded, and showing it on another org's hotel would mix two orgs on one
 * screen. Without a current hotel the user's own onboarding account is the
 * only source. A role that may not read payouts sees that they are not
 * theirs to view, and Stripe is not asked.
 */
export async function loadPayoutStatus(
  current: CurrentProperty | null,
  userId: string,
  deps: PayoutDeps = defaultDeps,
): Promise<PayoutStatus> {
  if (current && !roleAllows(current.role, { payout: ["read"] }, current.hasPropertyAccess)) {
    return { state: "hidden" };
  }

  const row = current
    ? await deps.queryOne<{ stripe_account_id: string | null }>(
        `SELECT COALESCE(
           (SELECT op.stripe_account_id FROM org_profile op WHERE op.organization_id = $1),
           (SELECT p.stripe_account_id FROM properties p
             WHERE p.id = $2::uuid AND p.organization_id = $1)
         ) AS stripe_account_id`,
        [current.organizationId, current.propertyId],
      )
    : await deps.queryOne<{ stripe_account_id: string | null }>(
        `SELECT step_data->>'stripe_account_id' AS stripe_account_id FROM host_onboarding WHERE user_id = $1`,
        [userId],
      );
  if (!row?.stripe_account_id) return { state: "none" };

  try {
    const account = await deps.retrieveAccount(row.stripe_account_id);
    return {
      state: "ok",
      payoutsEnabled: account.payouts_enabled ?? false,
      requirementsDue: account.requirements?.currently_due?.length ?? 0,
    };
  } catch {
    // Stripe being unreachable must not take the page down.
    return { state: "unavailable" };
  }
}

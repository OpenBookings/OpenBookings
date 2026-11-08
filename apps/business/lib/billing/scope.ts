import { getOrgScopedDb } from "@openbookings/authz";
import { roleAllows, type Permission } from "@openbookings/authz/permissions";
import { activeOrgId } from "@/lib/active-org";
import { billingScope, type BillingScope } from "./queries";

type Session = { user: { id: string; account_type?: string | null }; session: Record<string, unknown> };

/** Test seams: the database the lookups run on. */
export type BillingAccessDeps = {
  query?: <T>(text: string, values?: unknown[]) => Promise<T[]>;
  queryOne?: <T>(text: string, values?: unknown[]) => Promise<T | null>;
  testing?: boolean;
  db?: BillingScope["db"];
};

/**
 * The one way the Billing page, its actions and the download route find out
 * who is asking: the organization is resolved like the rest of the dashboard
 * (the session's active organization, else the user's only real membership),
 * membership is re-verified, and the role must hold `permission`. Called on
 * every request, never cached. `null` means no access. Passing `null` as the permission only resolves membership, for a caller (the download route) that answers a refused role differently.
 */
export async function billingAccess(
  session: Session | null | undefined,
  permission: Permission | null,
  deps: BillingAccessDeps = {},
): Promise<(BillingScope & { memberRole: string }) | null> {
  if (!session) return null;
  const orgId = await activeOrgId(session, { query: deps.query, testing: deps.testing });
  const scoped = await getOrgScopedDb(
    { user: session.user, session: { activeOrganizationId: orgId } },
    { queryOne: deps.queryOne, testing: deps.testing },
  );
  if (!scoped || (permission && !roleAllows(scoped.memberRole, permission, false))) return null;
  const scope = billingScope(scoped);
  return { ...scope, db: deps.db ?? scope.db, memberRole: scoped.memberRole };
}

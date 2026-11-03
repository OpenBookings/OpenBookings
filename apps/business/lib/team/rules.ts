import { isHostRole, isPropertyScoped, type HostRole } from "@openbookings/authz/permissions";
import { assignableRoles } from "@openbookings/authz/role-guide";

/**
 * The Team page's rules, as pure functions so they can be tested without a
 * database. Better Auth enforces the ownership rules again on its own
 * endpoints (only owners make or change owners, the last owner stays); these
 * add ours: property scoping, and no changing your own access.
 */

export type TeamError =
  | "not_allowed"
  | "unknown_role"
  | "choose_properties"
  | "unknown_property"
  | "not_yourself";

export const TEAM_ERRORS: Record<TeamError, string> = {
  not_allowed: "You can't give that role.",
  unknown_role: "Pick one of the roles.",
  choose_properties: "Choose at least one property for this role.",
  unknown_property: "One of those properties isn't part of your organisation.",
  not_yourself: "You can't change your own role or remove yourself. Ask another owner.",
};

/** Owners and general managers manage the team. */
export function canManageTeam(role: string | null | undefined): boolean {
  return !!role && assignableRoles(role).length > 0;
}

/**
 * Whether `actorRole` may give `role` with these properties. Property-scoped
 * roles need at least one of the organisation's properties; org-wide roles
 * ignore the list (and get no property rows). Returns the properties to
 * store, or an error.
 */
export function checkAssignment(input: {
  actorRole: string;
  role: string;
  propertyIds: readonly string[];
  orgPropertyIds: readonly string[];
}): { ok: true; role: HostRole; propertyIds: string[] } | { ok: false; error: TeamError } {
  if (!isHostRole(input.role)) return { ok: false, error: "unknown_role" };
  if (!assignableRoles(input.actorRole).includes(input.role)) return { ok: false, error: "not_allowed" };
  if (!isPropertyScoped(input.role)) return { ok: true, role: input.role, propertyIds: [] };

  const propertyIds = [...new Set(input.propertyIds)];
  if (propertyIds.length === 0) return { ok: false, error: "choose_properties" };
  const known = new Set(input.orgPropertyIds);
  if (propertyIds.some((id) => !known.has(id))) return { ok: false, error: "unknown_property" };
  return { ok: true, role: input.role, propertyIds };
}

/**
 * Whether the actor may change or remove `target` at all. Nobody edits their
 * own membership here (an owner demoting themselves locks themselves out),
 * and only an owner touches an owner.
 */
export function checkTarget(input: {
  actorUserId: string;
  actorRole: string;
  targetUserId: string;
  targetRole: string;
}): TeamError | null {
  if (input.actorUserId === input.targetUserId) return "not_yourself";
  if (!canManageTeam(input.actorRole)) return "not_allowed";
  const targetIsOwner = input.targetRole.split(",").map((r) => r.trim()).includes("owner");
  if (targetIsOwner && !assignableRoles(input.actorRole).includes("owner")) return "not_allowed";
  return null;
}

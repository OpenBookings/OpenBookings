import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * The single permission statement for the host portal. Imported by the org
 * plugin config (packages/auth/host.ts), the API layer, and the client —
 * client-side checks are cosmetic only; the server re-checks everything.
 *
 * Merges the organization plugin's built-in statements (organization,
 * member, invitation, team, ac) so its endpoints keep enforcing correctly,
 * then adds our domain resources.
 *
 * Bookings are split by how much trust an action needs:
 * - `operate`: day-of-stay work (check-in, no-show, early departure). Any
 *   refund that follows comes from the booking's cancellation policy.
 * - `cancel`: cancel rooms or the whole booking. A host cancellation
 *   refunds the guest in full, whatever the policy.
 * - `refund`: money back at the host's discretion (goodwill). Owner and
 *   general manager only.
 *
 * NOTE: `better-auth/plugins/access` and `.../organization/access` are pure
 * data modules — importing them pulls no Better Auth server code, so this
 * package stays safe for the API layer, background jobs, and the support
 * bot.
 */
export const statement = {
  ...defaultStatements,
  property: ["create", "update", "delete", "publish"],
  rate: ["read", "update"],
  booking: ["read", "operate", "cancel", "refund"],
  payout: ["read", "update"],
  member: ["invite", "remove", "update-role", ...defaultStatements.member],
  org: ["update", "delete"],
} as const;

export const ac = createAccessControl(statement);

const ALL_PROPERTY = ["create", "update", "delete", "publish"] as const;
const ALL_BOOKING = ["read", "operate", "cancel", "refund"] as const;

/**
 * The ready-made roles. Owners and general managers pick one per person;
 * there are no custom roles yet.
 *
 * `admin` is the general manager. The key stays `admin` because Better Auth
 * and existing member rows use it; people only ever see "General manager".
 * An owner holds everything a general manager does, so one person running
 * the hotel needs only the owner role.
 *
 * Manager, reservations and front desk are additionally property-scoped:
 * their grants only apply to properties they have a property_access row
 * for (Better Auth's team feature still has no per-team permission scoping —
 * verified against plugin source — so property scoping lives in our own
 * schema; see PROPERTY_SCOPED_ROLES).
 */
export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    property: [...ALL_PROPERTY],
    rate: ["read", "update"],
    booking: [...ALL_BOOKING],
    payout: ["read", "update"],
    member: ["invite", "remove", "update-role", ...ownerAc.statements.member],
    org: ["update", "delete"],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    property: [...ALL_PROPERTY],
    rate: ["read", "update"],
    booking: [...ALL_BOOKING],
    payout: ["read", "update"],
    member: ["invite", "remove", "update-role", ...adminAc.statements.member],
    // org update yes, delete is owner-only.
    org: ["update"],
  }),
  manager: ac.newRole({
    property: ["update", "publish"],
    rate: ["read", "update"],
    booking: ["read", "operate", "cancel"],
  }),
  reservations: ac.newRole({
    rate: ["read"],
    booking: ["read", "operate", "cancel"],
  }),
  frontdesk: ac.newRole({
    rate: ["read"],
    booking: ["read", "operate"],
  }),
  finance: ac.newRole({
    payout: ["read"],
    booking: ["read"],
    rate: ["read"],
  }),
} as const;

export type HostRole = keyof typeof roles;

export const HOST_ROLES = Object.keys(roles) as HostRole[];

/** Roles whose grants only apply to properties they were given access to. */
export const PROPERTY_SCOPED_ROLES: readonly HostRole[] = [
  "manager",
  "reservations",
  "frontdesk",
];

export function isHostRole(role: unknown): role is HostRole {
  return typeof role === "string" && Object.hasOwn(roles, role);
}

export function isPropertyScoped(role: HostRole): boolean {
  return PROPERTY_SCOPED_ROLES.includes(role);
}

/** One or more actions on our resources, e.g. `{ booking: ["refund"] }`. */
export type Permission = {
  [R in keyof typeof statement]?: Array<(typeof statement)[R][number]>;
};

/**
 * Whether a member with `role` may do `permission` on one property.
 * `hasPropertyAccess` is whether they hold a property_access row for it;
 * it only matters for property-scoped roles.
 *
 * Pure, so the UI can hide what the server would refuse (cosmetic only —
 * the server re-checks with userCan). Unknown roles fail closed. A
 * comma-separated role string (Better Auth allows several) passes if any
 * one of its roles passes on its own.
 */
export function roleAllows(
  role: string | null | undefined,
  permission: Permission,
  hasPropertyAccess: boolean,
): boolean {
  if (!role) return false;
  return role
    .split(",")
    .map((r) => r.trim())
    .some(
      (r) =>
        isHostRole(r) &&
        (!isPropertyScoped(r) || hasPropertyAccess) &&
        roles[r].authorize(permission as never).success,
    );
}

/** Roles that hold `permission` (before any property scoping). */
export function rolesWith(permission: Permission): HostRole[] {
  return HOST_ROLES.filter((role) => roles[role].authorize(permission as never).success);
}

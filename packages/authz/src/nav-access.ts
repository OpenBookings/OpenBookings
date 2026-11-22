import { isHostRole, isPropertyScoped, roleAllows, type HostRole, type Permission } from "./permissions";
import { ROLE_ORDER } from "./role-guide";

/**
 * What each console page asks of a role, in one table. The sidebar greys out
 * what a role can't open, each page shows its no-access state from it, and
 * pages that a role may only look at render their edit controls disabled.
 *
 * Cosmetic only, like roleAllows: server actions keep their own userCan
 * checks. Client-safe: no database imports.
 */

export type NavKey =
  | "overview"
  | "reservations"
  | "messages"
  | "reviews"
  | "property"
  | "rooms"
  | "rates"
  | "pricingRules"
  | "analytics"
  | "payouts"
  | "billing"
  | "team";

/** "edit": open and change; "view": open but not change; "none": can't open. */
export type AccessLevel = "edit" | "view" | "none";

/**
 * `view` is any-of: one matching permission opens the page. "member" means
 * any member of the hotel, by a known role. A page with no `edit` has nothing
 * to restrict once it is open, so its level is "edit".
 */
export const NAV_ACCESS: Record<NavKey, { view: Permission[] | "member"; edit?: Permission }> = {
  overview: { view: [{ booking: ["read"] }] },
  reservations: { view: [{ booking: ["read"] }], edit: { booking: ["operate"] } },
  messages: { view: [{ booking: ["read"] }], edit: { booking: ["operate"] } },
  reviews: { view: [{ booking: ["read"] }], edit: { booking: ["operate"] } },
  property: { view: "member", edit: { property: ["update"] } },
  rooms: { view: "member", edit: { property: ["update"] } },
  rates: { view: [{ rate: ["read"] }], edit: { rate: ["update"] } },
  pricingRules: { view: [{ rate: ["read"] }], edit: { rate: ["update"] } },
  analytics: { view: [{ payout: ["read"] }, { rate: ["update"] }] },
  payouts: { view: [{ payout: ["read"] }], edit: { payout: ["update"] } },
  billing: { view: [{ billing: ["read"] }], edit: { billing: ["update"] } },
  team: { view: "member", edit: { member: ["invite"] } },
};

export const NAV_KEYS = Object.keys(NAV_ACCESS) as NavKey[];

/**
 * Pages about the organization rather than one hotel. A property-scoped role
 * (manager, reservations, front desk) reaches these without a property_access
 * row for the current hotel; everywhere else it needs one.
 */
const ORG_LEVEL: ReadonlySet<NavKey> = new Set<NavKey>(["team", "payouts", "billing"]);

function knownRoles(role: string | null | undefined): HostRole[] {
  if (!role) return [];
  return role
    .split(",")
    .map((r) => r.trim())
    .filter(isHostRole);
}

function levelFor(roles: HostRole[], key: NavKey, hasPropertyAccess: boolean): AccessLevel {
  const rule = NAV_ACCESS[key];
  const access = ORG_LEVEL.has(key) || hasPropertyAccess;
  // Checked one role at a time: a comma-separated role gets the best level any one of its roles has.
  const can = (permission: Permission) => roles.some((r) => roleAllows(r, permission, access));
  const canView =
    rule.view === "member"
      ? roles.some((r) => access || !isPropertyScoped(r))
      : rule.view.some((permission) => can(permission));
  if (!canView) return "none";
  if (!rule.edit) return "edit";
  return can(rule.edit) ? "edit" : "view";
}

/**
 * Every page's level for `role` at one hotel. `role` is the member.role
 * string (may be comma-separated); `hasPropertyAccess` is whether the member
 * holds a property_access row for the hotel. Unknown or missing role: all
 * "none".
 */
export function navAccess(role: string | null | undefined, hasPropertyAccess: boolean): Record<NavKey, AccessLevel> {
  const roles = knownRoles(role);
  return Object.fromEntries(NAV_KEYS.map((key) => [key, levelFor(roles, key, hasPropertyAccess)])) as Record<
    NavKey,
    AccessLevel
  >;
}

/** The roles that can open `key` (given access to the hotel), in the Team page's order. */
export function rolesForView(key: NavKey): HostRole[] {
  return ROLE_ORDER.filter((role) => levelFor([role], key, true) !== "none");
}

/** Longest prefix first, so billing is not taken for payouts. */
const BY_PATH: ReadonlyArray<readonly [string, NavKey]> = [
  ["/dashboard/bookings/reservations", "reservations"],
  ["/dashboard/bookings/messages", "messages"],
  ["/dashboard/bookings/reviews", "reviews"],
  ["/dashboard/listings/property", "property"],
  ["/dashboard/listings/rooms", "rooms"],
  ["/dashboard/listings/rates-availability", "rates"],
  ["/dashboard/listings/pricing-rules", "pricingRules"],
  ["/dashboard/analytics", "analytics"],
  ["/dashboard/finance/billing", "billing"],
  ["/dashboard/finance", "payouts"],
  ["/dashboard/team", "team"],
  ["/dashboard", "overview"],
];

/** The menu key a console path belongs to (sub-pages count as their parent), or null. */
export function navKeyForPath(pathname: string): NavKey | null {
  const path = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, "") || "/";
  for (const [prefix, key] of BY_PATH) {
    if (key === "overview" ? path === prefix : path === prefix || path.startsWith(`${prefix}/`)) return key;
  }
  return null;
}

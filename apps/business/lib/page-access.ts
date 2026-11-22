import type { CurrentProperty } from "@openbookings/authz";
import { NAV_KEYS, navAccess, rolesForView, type AccessLevel, type NavKey } from "@openbookings/authz/nav-access";
import { roleLabel } from "@openbookings/authz/role-guide";
import { listSentence, type NoAccessProps } from "@/components/dashboard/no-access";
import { getCurrentProperty } from "@/lib/current-property";

export { listSentence };

/**
 * What the signed-in host may do on a console page at the current hotel, from
 * the one rule table in @openbookings/authz/nav-access. Cosmetic, like the
 * sidebar: server actions keep their own userCan checks.
 */

/** The page names the no-access state uses, in the words of the menu. */
export const PAGE_NAMES: Record<NavKey, string> = {
  overview: "Overview",
  reservations: "Reservations",
  messages: "Messages",
  reviews: "Reviews",
  property: "Property",
  rooms: "Rooms",
  rates: "Rates & availability",
  pricingRules: "Pricing rules",
  analytics: "Analytics",
  payouts: "Payouts",
  billing: "Billing",
  team: "Team",
};

/**
 * The level at `current` for `key`. With no current hotel at all the page is
 * left to its own empty state ("edit" here only means "don't block"), so a
 * host who has no hotel yet never sees a no-access page.
 */
export function accessLevel(current: CurrentProperty | null, key: NavKey): AccessLevel {
  if (!current) return "edit";
  return navAccess(current.role, current.hasPropertyAccess)[key];
}

/** Every page's level at `current`, for the sidebar. */
export function accessLevels(current: CurrentProperty | null): Record<NavKey, AccessLevel> {
  return Object.fromEntries(NAV_KEYS.map((key) => [key, accessLevel(current, key)])) as Record<NavKey, AccessLevel>;
}

/** "none" always comes with the hotel it is about. */
export type PageAccess =
  | { level: "none"; current: CurrentProperty }
  | { level: Exclude<AccessLevel, "none">; current: CurrentProperty | null };

/** Pages call this first: "none" renders <NoAccess> and loads nothing else. */
export async function pageAccess(key: NavKey): Promise<PageAccess> {
  const current = await getCurrentProperty();
  if (!current) return { level: "edit", current: null };
  return { level: accessLevel(current, key), current };
}

type Query = <T>(sql: string, values?: unknown[]) => Promise<T[]>;

async function defaultQuery<T>(sql: string, values?: unknown[]): Promise<T[]> {
  const { query } = await import("@openbookings/db");
  return query<T>(sql, values);
}

/**
 * The names (email when there is none) of the org's owners and general
 * managers: the people who can give access. `organizationId` is the current
 * hotel's, resolved server-side, never client input.
 */
export async function loadOrgAdmins(organizationId: string, deps: { query?: Query } = {}): Promise<string[]> {
  const query = deps.query ?? defaultQuery;
  const rows = await query<{ name: string }>(
    `SELECT COALESCE(NULLIF(trim(u.name), ''), u.email) AS name
     FROM "member" m
     JOIN "user" u ON u.id = m."userId"
     WHERE m."organizationId" = $1
       AND string_to_array(replace(m.role, ' ', ''), ',') && ARRAY['owner', 'admin']
     ORDER BY ('owner' = ANY(string_to_array(replace(m.role, ' ', ''), ','))) DESC, m."createdAt", m.id`,
    [organizationId],
  );
  return rows.map((r) => r.name);
}

/** Everything <NoAccess> says about `key` at `current`. */
export async function noAccessProps(
  key: NavKey,
  current: CurrentProperty,
  deps: { query?: Query } = {},
): Promise<NoAccessProps> {
  const roles = current.role
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return {
    hotelName: current.propertyName,
    roleLabel: listSentence(roles.map(roleLabel)),
    pageName: PAGE_NAMES[key],
    neededRoles: rolesForView(key).map(roleLabel),
    admins: await loadOrgAdmins(current.organizationId, deps).catch((error) => {
      console.error("[page-access] loading the org's admins failed:", error instanceof Error ? error.message : error);
      return [];
    }),
  };
}

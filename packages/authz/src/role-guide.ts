import { HOST_ROLES, isPropertyScoped, roles, type HostRole, type Permission } from "./permissions";

/**
 * What each ready-made role is called and what it can do, in the words the
 * Team page shows. Client-safe: no database imports.
 *
 * The "can / can't" lists are worked out from the role grants in
 * permissions.ts, never written by hand, so the page cannot promise
 * something the server refuses (or the other way round).
 */

export type RoleInfo = {
  role: HostRole;
  label: string;
  /** One line: what this role covers. */
  summary: string;
  /** "All properties" or "Only the properties you choose". */
  scope: string;
};

export const ROLE_INFO: Record<HostRole, RoleInfo> = {
  owner: {
    role: "owner",
    label: "Owner",
    summary: "Owns the business on OpenBookings. Everything a general manager can do, plus closing the account.",
    scope: "All properties",
  },
  admin: {
    role: "admin",
    label: "General manager",
    summary:
      "Runs the hotel day to day: bookings, refunds, rates, listings and the team. If you run the hotel yourself as owner, you don't need this role too.",
    scope: "All properties",
  },
  manager: {
    role: "manager",
    label: "Manager",
    summary:
      "Runs one or more properties: their listings, rates and bookings. No refunds beyond the cancellation policy, no team or payouts.",
    scope: "Only the properties you choose",
  },
  reservations: {
    role: "reservations",
    label: "Reservations",
    summary: "Handles bookings: checks guests in and cancels bookings when needed. Can see rates but not change them.",
    scope: "Only the properties you choose",
  },
  frontdesk: {
    role: "frontdesk",
    label: "Front desk",
    summary: "Works the desk: sees bookings, checks guests in, marks no-shows and early departures.",
    scope: "Only the properties you choose",
  },
  finance: {
    role: "finance",
    label: "Back office",
    summary: "Keeps the books: sees bookings, rates and payout status, but changes nothing.",
    scope: "All properties",
  },
};

/** Roles in the order the Team page lists them. */
export const ROLE_ORDER: readonly HostRole[] = [
  "owner",
  "admin",
  "manager",
  "reservations",
  "frontdesk",
  "finance",
];

export const ABILITY_GROUPS = ["Bookings", "Rates & property", "Finance", "Team & account"] as const;
export type AbilityGroup = (typeof ABILITY_GROUPS)[number];

/**
 * The abilities the roles table lists, each tied to the grant that enforces
 * it. Labels use the words of the dashboard itself (its menu and buttons),
 * not the grant names.
 */
export const ABILITIES: ReadonlyArray<{
  label: string;
  /** A short note under the label. */
  hint?: string;
  group: AbilityGroup;
  permission: Permission;
}> = [
  { label: "View bookings", group: "Bookings", permission: { booking: ["read"] } },
  {
    // Break the glass (apps/business/lib/reservations/break-glass.ts) checks booking read.
    label: "View guest phone and address",
    hint: "Each view is logged",
    group: "Bookings",
    permission: { booking: ["read"] },
  },
  {
    label: "Check guests in",
    hint: "Also no-shows and early departures",
    group: "Bookings",
    permission: { booking: ["operate"] },
  },
  { label: "Cancel booking", hint: "The guest gets a full refund", group: "Bookings", permission: { booking: ["cancel"] } },
  { label: "Refund booking", hint: "Any amount you choose", group: "Bookings", permission: { booking: ["refund"] } },
  { label: "View rates & availability", group: "Rates & property", permission: { rate: ["read"] } },
  { label: "Change rates & availability", group: "Rates & property", permission: { rate: ["update"] } },
  { label: "Edit property and rooms", group: "Rates & property", permission: { property: ["update"] } },
  { label: "View payouts", group: "Finance", permission: { payout: ["read"] } },
  { label: "Change payout details", group: "Finance", permission: { payout: ["update"] } },
  {
    label: "Manage team",
    hint: "Invite and remove people, change roles",
    group: "Team & account",
    permission: { member: ["invite"] },
  },
  { label: "Close account", group: "Team & account", permission: { org: ["delete"] } },
];

/** Whether `role` holds `permission` (before any property scoping). */
export function roleHas(role: HostRole, permission: Permission): boolean {
  return roles[role].authorize(permission as never).success;
}

export function roleLabel(role: string): string {
  return (role in ROLE_INFO ? ROLE_INFO[role as HostRole].label : null) ?? role;
}

export function roleAbilities(role: HostRole): { can: string[]; cannot: string[] } {
  const can: string[] = [];
  const cannot: string[] = [];
  for (const ability of ABILITIES) {
    (roleHas(role, ability.permission) ? can : cannot).push(ability.label);
  }
  return { can, cannot };
}

/**
 * Which roles a member with `actorRole` may hand out. Only owners make
 * owners (Better Auth enforces the same rule on its endpoints).
 */
export function assignableRoles(actorRole: string): HostRole[] {
  const actor = actorRole.split(",").map((r) => r.trim());
  if (actor.includes("owner")) return [...ROLE_ORDER];
  if (actor.includes("admin")) return ROLE_ORDER.filter((r) => r !== "owner");
  return [];
}

export { HOST_ROLES, isPropertyScoped };

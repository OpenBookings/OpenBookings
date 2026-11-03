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
  /** A few words: who this role is for, for the roles table. */
  short: string;
  /** One line: what this role covers. */
  summary: string;
  /** "All properties" or "Only the properties you choose". */
  scope: string;
};

export const ROLE_INFO: Record<HostRole, RoleInfo> = {
  owner: {
    role: "owner",
    label: "Owner",
    short: "Owns the business",
    summary: "Owns the business on OpenBookings. Everything a general manager can do, plus closing the account.",
    scope: "All properties",
  },
  admin: {
    role: "admin",
    label: "General manager",
    short: "Runs the hotel day to day",
    summary:
      "Runs the hotel day to day: bookings, refunds, rates, listings and the team. If you run the hotel yourself as owner, you don't need this role too.",
    scope: "All properties",
  },
  manager: {
    role: "manager",
    label: "Manager",
    short: "Runs one or more properties",
    summary:
      "Runs one or more properties: their listings, rates and bookings. No refunds beyond the cancellation policy, no team or payouts.",
    scope: "Only the properties you choose",
  },
  reservations: {
    role: "reservations",
    label: "Reservations",
    short: "Handles bookings",
    summary: "Handles bookings: checks guests in and cancels bookings when needed. Can see rates but not change them.",
    scope: "Only the properties you choose",
  },
  frontdesk: {
    role: "frontdesk",
    label: "Front desk",
    short: "Works the desk",
    summary: "Works the desk: sees bookings, checks guests in, marks no-shows and early departures.",
    scope: "Only the properties you choose",
  },
  finance: {
    role: "finance",
    label: "Back office",
    short: "Keeps the books",
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

export const ABILITY_GROUPS = ["Bookings", "Rates & property", "Money", "Team & account"] as const;
export type AbilityGroup = (typeof ABILITY_GROUPS)[number];

/** The abilities the roles table lists, each tied to the grant that enforces it. */
export const ABILITIES: ReadonlyArray<{
  label: string;
  /** A short note under the label. */
  hint?: string;
  group: AbilityGroup;
  permission: Permission;
}> = [
  { label: "See bookings", group: "Bookings", permission: { booking: ["read"] } },
  {
    // Break the glass (apps/business/lib/reservations/break-glass.ts) checks booking read.
    label: "Open guest contact details",
    hint: "Each view is logged",
    group: "Bookings",
    permission: { booking: ["read"] },
  },
  { label: "Check guests in, mark no-shows and early departures", group: "Bookings", permission: { booking: ["operate"] } },
  {
    label: "Cancel bookings",
    hint: "The guest gets a full refund",
    group: "Bookings",
    permission: { booking: ["cancel"] },
  },
  { label: "Give goodwill refunds", group: "Bookings", permission: { booking: ["refund"] } },
  { label: "See rates and availability", group: "Rates & property", permission: { rate: ["read"] } },
  { label: "Change rates and availability", group: "Rates & property", permission: { rate: ["update"] } },
  { label: "Edit the property and its rooms", group: "Rates & property", permission: { property: ["update"] } },
  { label: "See payout status", group: "Money", permission: { payout: ["read"] } },
  { label: "Change payout settings", group: "Money", permission: { payout: ["update"] } },
  { label: "Add and remove people, change roles", group: "Team & account", permission: { member: ["invite"] } },
  { label: "Close the organisation's account", group: "Team & account", permission: { org: ["delete"] } },
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

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
  /** One line: who this role is for. */
  summary: string;
  /** "All properties" or "Only the properties you choose". */
  scope: string;
};

export const ROLE_INFO: Record<HostRole, RoleInfo> = {
  owner: {
    role: "owner",
    label: "Owner",
    summary:
      "Owns the business on OpenBookings. Everything a general manager can do, plus payouts set-up and closing the account.",
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

/** The abilities a role card lists, each tied to the grant that enforces it. */
export const ABILITIES: ReadonlyArray<{ label: string; permission: Permission }> = [
  { label: "See bookings", permission: { booking: ["read"] } },
  {
    label: "Check guests in, mark no-shows and early departures",
    permission: { booking: ["operate"] },
  },
  {
    label: "Cancel bookings (refund follows the cancellation policy)",
    permission: { booking: ["cancel"] },
  },
  { label: "Give goodwill refunds", permission: { booking: ["refund"] } },
  { label: "See rates and availability", permission: { rate: ["read"] } },
  { label: "Change rates and availability", permission: { rate: ["update"] } },
  { label: "Edit the property and its rooms", permission: { property: ["update"] } },
  { label: "See payout status", permission: { payout: ["read"] } },
  { label: "Add and remove people, change roles", permission: { member: ["invite"] } },
  { label: "Close the organisation's account", permission: { org: ["delete"] } },
];

export function roleLabel(role: string): string {
  return (role in ROLE_INFO ? ROLE_INFO[role as HostRole].label : null) ?? role;
}

export function roleAbilities(role: HostRole): { can: string[]; cannot: string[] } {
  const can: string[] = [];
  const cannot: string[] = [];
  for (const ability of ABILITIES) {
    (roles[role].authorize(ability.permission as never).success ? can : cannot).push(ability.label);
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

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
 * NOTE: `better-auth/plugins/access` and `.../organization/access` are pure
 * data modules — importing them pulls no Better Auth server code, so this
 * package stays safe for the API layer, background jobs, and the support
 * bot.
 */
export const statement = {
  ...defaultStatements,
  property: ["create", "update", "delete", "publish"],
  rate: ["read", "update"],
  booking: ["read", "modify", "cancel"],
  payout: ["read", "update"],
  member: ["invite", "remove", "update-role", ...defaultStatements.member],
  org: ["update", "delete"],
} as const;

export const ac = createAccessControl(statement);

/**
 * Roles. Manager and frontdesk are additionally property-scoped: their
 * org-wide grants below only apply to properties they have a
 * property_access row for (Better Auth's team feature still has no per-team
 * permission scoping as of 1.6.25 — verified against plugin source — so
 * property scoping lives in our own schema and is enforced with
 * `memberHasPropertyAccess`).
 */
export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    property: ["create", "update", "delete", "publish"],
    rate: ["read", "update"],
    booking: ["read", "modify", "cancel"],
    payout: ["read", "update"],
    member: ["invite", "remove", "update-role", ...ownerAc.statements.member],
    org: ["update", "delete"],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    property: ["create", "update", "delete", "publish"],
    rate: ["read", "update"],
    booking: ["read", "modify", "cancel"],
    payout: ["read", "update"],
    member: ["invite", "remove", "update-role", ...adminAc.statements.member],
    // org update yes, delete is owner-only.
    org: ["update"],
  }),
  manager: ac.newRole({
    property: ["update", "publish"],
    rate: ["read", "update"],
    booking: ["read", "modify", "cancel"],
  }),
  frontdesk: ac.newRole({
    rate: ["read"],
    booking: ["read", "modify"],
  }),
  finance: ac.newRole({
    payout: ["read"],
    booking: ["read"],
    rate: ["read"],
  }),
} as const;

export type HostRole = keyof typeof roles;

/** Roles whose grants only apply to properties they were given access to. */
export const PROPERTY_SCOPED_ROLES: readonly HostRole[] = [
  "manager",
  "frontdesk",
];

// This module stays free of database imports on purpose: the host auth
// CLIENT imports it for cosmetic permission checks, so pulling in
// @openbookings/db here would drag pg into the browser bundle. The
// db-backed property scoping check (memberHasPropertyAccess) lives in the
// package's main entry, which is server-only.

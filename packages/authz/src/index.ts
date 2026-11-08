import { query as dbQuery, queryOne as dbQueryOne } from "@openbookings/db";
import { DEMO_ORG_ID, isTestingMode } from "@openbookings/mode";
import {
  PROPERTY_SCOPED_ROLES,
  roleAllows,
  roles,
  rolesWith,
  type HostRole,
  type Permission,
} from "./permissions";

export * from "./rates-confirmation";

export {
  ac,
  roles,
  statement,
  HOST_ROLES,
  PROPERTY_SCOPED_ROLES,
  isHostRole,
  isPropertyScoped,
  roleAllows,
  rolesWith,
  type HostRole,
  type Permission,
} from "./permissions";

/**
 * Ownership / authorization checks. Single choke point per resource type:
 * endpoints call these, never inline their own ownership SQL. Access comes
 * from membership of the property's organization; `properties.owner_user_id`
 * only counts for legacy rows that have no organization yet.
 *
 * All checks fail closed: unknown ids, NULL owners, and missing sessions are
 * all "not owned".
 */

/** The minimal slice of a Better Auth session these checks need. */
export type SessionLike = {
  user: { id: string; account_type?: string | null };
};

type QueryOneFn = <T>(text: string, values?: unknown[]) => Promise<T | null>;

/** Test seam: pass a fake queryOne. Defaults to the shared pg pool. */
export type AuthzDeps = { queryOne?: QueryOneFn; testing?: boolean };

function ownerId(session: SessionLike | null | undefined): string | null {
  const id = session?.user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** `'a', 'b'` for a SQL IN list. Role names are our own constants, never input. */
function sqlRoleList(names: readonly string[]): string {
  return names.map((role) => `'${role}'`).join(", ");
}

/**
 * Access to property `p` for the user bound at `userParam`, for members whose
 * role holds `permission`. Org-wide roles pass on membership alone;
 * property-scoped roles also need a property_access row. Legacy direct
 * ownership (owner_user_id) counts ONLY for pre-org rows (organization_id IS
 * NULL): once a property belongs to an org, a stale owner_user_id must never
 * grant anything — it is set at onboarding, and a removed or demoted founder
 * would otherwise keep full edit, cancel and refund rights.
 *
 * Role lists come from the grants in permissions.ts, so adding a role or a
 * grant there is the whole change. Positive lists on both sides: an unknown
 * role matches nothing (fails closed). Cross-org access fails structurally:
 * the member row must belong to THIS property's organization_id.
 */
function propertyAccessSql(userParam: string, holders: readonly HostRole[], testing: boolean = isTestingMode()): string {
  if (!/^\$\d+$/.test(userParam)) throw new Error(`Not a bind parameter: ${userParam}`);
  const orgWide = holders.filter((role) => !PROPERTY_SCOPED_ROLES.includes(role));
  const scoped = holders.filter((role) => PROPERTY_SCOPED_ROLES.includes(role));
  const clauses = [
    orgWide.length ? `m.role IN (${sqlRoleList(orgWide)})` : null,
    scoped.length
      ? `(m.role IN (${sqlRoleList(scoped)}) AND EXISTS (
          SELECT 1 FROM property_access pa
          WHERE pa.member_id = m.id AND pa.property_id = p.id
        ))`
      : null,
  ].filter(Boolean);
  // A leftover demo membership grants nothing outside testing mode. The
  // decision is a fixed literal from our own constant, never input, and adds
  // no bind parameter, so every caller's parameter numbering stays as it was.
  const demoExclusion = testing ? "" : `\n      AND m."organizationId" <> '${DEMO_ORG_ID}'`;
  return `(
  (p.organization_id IS NULL AND p.owner_user_id = ${userParam})
  OR EXISTS (
    SELECT 1 FROM "member" m
    WHERE m."organizationId" = p.organization_id
      AND m."userId" = ${userParam}${demoExclusion}
      AND (${clauses.length ? clauses.join("\n        OR ") : "FALSE"})
  )
)`;
}

/**
 * Edit access to a property `p` for user `$2` (task 11): members whose role
 * may update the property (today owner and general manager org-wide, manager
 * on their properties). Reservations, front desk and back office never get
 * edit access through this predicate — their narrower grants go through
 * userCan per action.
 */
export function propertyEditAccessSql(testing: boolean = isTestingMode()): string {
  return propertyAccessSql("$2", rolesWith({ property: ["update"] }), testing);
}
export const PROPERTY_EDIT_ACCESS_SQL = propertyEditAccessSql();

/**
 * Read access to a property `p` for the user bound at `userParam` (e.g.
 * `"$1"`). Wider than PROPERTY_EDIT_ACCESS_SQL: every org role can read, and
 * the property-scoped roles (manager, reservations, front desk) still need a
 * property_access row. Legacy direct ownership counts only for pre-org rows
 * (organization_id IS NULL), as in PROPERTY_EDIT_ACCESS_SQL. Used where a
 * member only looks things up — the support panel's booking picker and the
 * support bot's host tools — never to authorize a write.
 */
export function propertyReadAccessSql(userParam: string, testing: boolean = isTestingMode()): string {
  return propertyAccessSql(userParam, Object.keys(roles) as HostRole[], testing);
}

/**
 * Whether the signed-in user may do `permission` on one property — the
 * check for anything narrower than "edit the property", such as checking a
 * guest in or giving a goodwill refund. One query for the member's role in
 * the property's org and their property_access row; the decision itself is
 * roleAllows, the same function the UI uses to hide buttons.
 *
 * A legacy pre-org property (organization_id IS NULL) is its owner_user_id's
 * alone, with every grant an owner has. Fails closed on unknown ids, no
 * membership and unknown roles.
 */
export async function userCan(
  session: SessionLike | null | undefined,
  propertyId: string,
  permission: Permission,
  deps: AuthzDeps = {},
): Promise<boolean> {
  const userId = ownerId(session);
  if (!userId || !propertyId) return false;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ legacy_owner: boolean; role: string | null; has_access: boolean }>(
    `SELECT (p.organization_id IS NULL AND p.owner_user_id = $2) AS legacy_owner,
            m.role,
            EXISTS (
              SELECT 1 FROM property_access pa
              WHERE pa.member_id = m.id AND pa.property_id = p.id
            ) AS has_access
     FROM properties p
     LEFT JOIN "member" m ON m."organizationId" = p.organization_id AND m."userId" = $2
       AND ($3::boolean OR m."organizationId" <> '${DEMO_ORG_ID}')
     WHERE p.id = $1`,
    [propertyId, userId, deps.testing ?? isTestingMode()],
  );
  if (!row) return false;
  if (row.legacy_owner === true) return roleAllows("owner", permission, true);
  return roleAllows(row.role, permission, row.has_access === true);
}

export async function userOwnsProperty(
  session: SessionLike | null | undefined,
  propertyId: string,
  deps: AuthzDeps = {},
): Promise<boolean> {
  const userId = ownerId(session);
  if (!userId || !propertyId) return false;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM properties p
     WHERE p.id = $1 AND ${propertyEditAccessSql(deps.testing)}`,
    [propertyId, userId],
  );
  return row?.ok === true;
}

/** Rooms are owned through their property — no separate ownership data. */
export async function userOwnsRoom(
  session: SessionLike | null | undefined,
  roomId: string,
  deps: AuthzDeps = {},
): Promise<boolean> {
  const userId = ownerId(session);
  if (!userId || !roomId) return false;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok
     FROM rooms r
     JOIN properties p ON p.id = r.property_id
     WHERE r.id = $1 AND ${propertyEditAccessSql(deps.testing)}`,
    [roomId, userId],
  );
  return row?.ok === true;
}

/** Rate plans are owned through their room's property — same chain as rooms. */
export async function userOwnsRatePlan(
  session: SessionLike | null | undefined,
  ratePlanId: string,
  deps: AuthzDeps = {},
): Promise<boolean> {
  const userId = ownerId(session);
  if (!userId || !ratePlanId) return false;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok
     FROM rate_plans rp
     JOIN rooms r      ON r.id = rp.room_id
     JOIN properties p ON p.id = r.property_id
     WHERE rp.id = $1 AND ${propertyEditAccessSql(deps.testing)}`,
    [ratePlanId, userId],
  );
  return row?.ok === true;
}

/** A message_threads row (see packages/db/src/schema.ts). */
export type ThreadRow = {
  id: string;
  booking_id: string | null;
  property_id: string;
  host_id: string;
  guest_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

/**
 * Messaging threads have exactly two participants (host_id, guest_id) — no
 * separate ownership data, same shape as userOwnsRoom above. Returns the
 * thread plus which side the session belongs to, since callers (send
 * message, mark read) need to know the role, not just whether access is
 * allowed.
 */
export async function getThreadForParticipant(
  session: SessionLike | null | undefined,
  threadId: string,
  deps: AuthzDeps = {},
): Promise<{ thread: ThreadRow; role: "host" | "guest" } | null> {
  const userId = ownerId(session);
  if (!userId || !threadId) return null;
  const queryOne = deps.queryOne ?? dbQueryOne;
  // The host side is checked against CURRENT access to the property, not just
  // the host_id stamped when the thread was created: a founder who has since
  // been removed from the organization (or demoted out of reading it) must
  // not keep reading guest messages or replying as the host.
  const thread = await queryOne<ThreadRow>(
    `SELECT t.* FROM message_threads t
     WHERE t.id = $1 AND (
       t.guest_id = $2
       OR (t.host_id = $2 AND EXISTS (
         SELECT 1 FROM properties p
         WHERE p.id = t.property_id AND ${propertyReadAccessSql("$2")}
       ))
     )`,
    [threadId, userId],
  );
  if (!thread) return null;
  return { thread, role: thread.host_id === userId ? "host" : "guest" };
}

/**
 * Host-scoped query helper for apps/business analytics and reads. The scope
 * is derived from the verified session — never from a client-passed id — and
 * is always bound as `$1`; callers write SQL with their own params starting
 * at `$2`.
 *
 *   const host = getHostScopedDb(session);
 *   const rows = await host.query(
 *     `SELECT b.* FROM bookings b
 *      JOIN properties p ON p.id = b.hotel_id
 *      WHERE p.owner_user_id = $1 AND b.status = $2`,
 *     ["confirmed"],
 *   );
 */
/**
 * Property scoping for the property-scoped roles. Owner, admin, and finance are
 * org-wide; property-scoped roles need a property_access row. Fails closed
 * on unknown roles.
 */
export async function memberHasPropertyAccess(
  member: { id: string; role: string },
  propertyId: string,
  deps: AuthzDeps = {},
): Promise<boolean> {
  if (!member.id || !propertyId) return false;
  const role = member.role as HostRole;
  if (!(role in roles)) return false;
  if (!PROPERTY_SCOPED_ROLES.includes(role)) return true;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM property_access WHERE member_id = $1 AND property_id = $2`,
    [member.id, propertyId],
  );
  return row?.ok === true;
}

/** Session slice for org-scoped access: Better Auth's org plugin stores the
 * active org on the session row. */
export type OrgSessionLike = {
  user: { id: string; account_type?: string | null };
  session: { activeOrganizationId?: string | null };
};

/**
 * Org-scoped access (task 11). The org id comes from the session's
 * activeOrganizationId — never from client input; URL params are routing
 * hints only — and membership is re-verified against the member table on
 * every call, so a stale activeOrganizationId (member removed since sign-in)
 * fails closed. Returns null when the session has no verified org.
 *
 * Repository functions built on this take orgId as a required argument via
 * the bound `$1`, same convention as getHostScopedDb.
 */
export async function getOrgScopedDb(
  session: OrgSessionLike | null | undefined,
  deps: AuthzDeps = {},
): Promise<null | {
  organizationId: string;
  memberRole: string;
  query: <T = unknown>(text: string, values?: unknown[]) => Promise<T[]>;
  queryOne: <T = unknown>(text: string, values?: unknown[]) => Promise<T | null>;
}> {
  const userId = ownerId(session);
  const orgId = session?.session?.activeOrganizationId;
  if (!userId || !orgId) return null;
  if (session?.user?.account_type !== "business") return null;
  if (orgId === DEMO_ORG_ID && !(deps.testing ?? isTestingMode())) return null;

  const queryOne = deps.queryOne ?? dbQueryOne;
  const membership = await queryOne<{ role: string }>(
    `SELECT role FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`,
    [orgId, userId],
  );
  if (!membership) return null;

  return {
    organizationId: orgId,
    memberRole: membership.role,
    query<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
      return dbQuery<T>(text, [orgId, ...values]);
    },
    queryOne<T = unknown>(text: string, values: unknown[] = []): Promise<T | null> {
      return dbQueryOne<T>(text, [orgId, ...values]);
    },
  };
}

export function getHostScopedDb(session: SessionLike | null | undefined) {
  const userId = ownerId(session);
  if (!userId) throw new Error("getHostScopedDb requires an authenticated session");
  if (session?.user?.account_type !== "business") {
    throw new Error("getHostScopedDb requires a business account session");
  }

  return {
    ownerUserId: userId,
    query<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
      return dbQuery<T>(text, [userId, ...values]);
    },
    queryOne<T = unknown>(text: string, values: unknown[] = []): Promise<T | null> {
      return dbQueryOne<T>(text, [userId, ...values]);
    },
  };
}

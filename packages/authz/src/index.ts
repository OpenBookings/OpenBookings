import { query as dbQuery, queryOne as dbQueryOne } from "@openbookings/db";
import {
  PROPERTY_SCOPED_ROLES,
  roles,
  type HostRole,
} from "./permissions";

export {
  ac,
  roles,
  statement,
  PROPERTY_SCOPED_ROLES,
  type HostRole,
} from "./permissions";

/**
 * Ownership / authorization checks. Single choke point per resource type:
 * endpoints call these, never inline their own ownership SQL. Ownership is
 * currently `properties.owner_user_id` (single host user); if this moves to
 * org-based ownership later, only this package changes — call sites don't.
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
export type AuthzDeps = { queryOne?: QueryOneFn };

function ownerId(session: SessionLike | null | undefined): string | null {
  const id = session?.user?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Edit access to a property `p` for user `$2` (task 11). Two paths:
 *
 * - legacy direct ownership (owner_user_id), kept while pre-org rows and
 *   call sites migrate;
 * - org membership on the property's organization: owner/admin are
 *   org-wide; manager is property-scoped and needs a property_access row.
 *   frontdesk/finance never get edit access through this predicate — their
 *   narrower grants go through the permission statement per endpoint.
 *
 * Cross-org access fails here structurally: the member row must belong to
 * THIS property's organization_id, so a role in another org matches
 * nothing.
 */
export const PROPERTY_EDIT_ACCESS_SQL = `(
  p.owner_user_id = $2
  OR EXISTS (
    SELECT 1 FROM "member" m
    WHERE m."organizationId" = p.organization_id
      AND m."userId" = $2
      AND (
        m.role IN ('owner', 'admin')
        OR (m.role = 'manager' AND EXISTS (
          SELECT 1 FROM property_access pa
          WHERE pa.member_id = m.id AND pa.property_id = p.id
        ))
      )
  )
)`;

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
     WHERE p.id = $1 AND ${PROPERTY_EDIT_ACCESS_SQL}`,
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
     WHERE r.id = $1 AND ${PROPERTY_EDIT_ACCESS_SQL}`,
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
     WHERE rp.id = $1 AND ${PROPERTY_EDIT_ACCESS_SQL}`,
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
  const thread = await queryOne<ThreadRow>(
    `SELECT * FROM message_threads WHERE id = $1 AND (host_id = $2 OR guest_id = $2)`,
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
 * Property scoping for manager/frontdesk. Owner, admin, and finance are
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

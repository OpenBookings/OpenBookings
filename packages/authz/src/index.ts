import { query as dbQuery, queryOne as dbQueryOne } from "@openbookings/db";

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

export async function userOwnsProperty(
  session: SessionLike | null | undefined,
  propertyId: string,
  deps: AuthzDeps = {},
): Promise<boolean> {
  const userId = ownerId(session);
  if (!userId || !propertyId) return false;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM properties WHERE id = $1 AND owner_user_id = $2`,
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
     WHERE r.id = $1 AND p.owner_user_id = $2`,
    [roomId, userId],
  );
  return row?.ok === true;
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

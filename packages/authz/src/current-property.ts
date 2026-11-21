import { query as dbQuery, queryOne as dbQueryOne } from "@openbookings/db";
import { DEMO_ORG_ID, isTestingMode } from "@openbookings/mode";
import { propertyReadAccessSql, type AuthzDeps } from "./index";

/**
 * The current hotel: which property a business-console session is "on".
 *
 * A user can belong to several hotels across organizations. The session row
 * stores the pointers (`activePropertyId`, `activeOrganizationId`); this module
 * is the one place that reads them, checks them against what the user can
 * reach right now, and falls back when they are stale. Stale or forged values
 * never error: they fall through to another hotel the user can read, or null.
 */

/** A hotel the user can switch to, with what the switcher and menu need. */
export type SwitchableProperty = {
  propertyId: string;
  propertyName: string;
  logoUrl: string | null;
  organizationId: string;
  organizationName: string;
  /** member.role as stored (may be comma-separated). */
  role: string;
  /** A property_access row exists for this member and property. */
  hasPropertyAccess: boolean;
};

export type CurrentProperty = SwitchableProperty;

/** Who is asking, by verified session — never client input. */
export type SessionPointer = { userId: string; sessionId: string };

type StoredPointers = { activePropertyId: string | null; activeOrganizationId: string | null };

type SwitchableRow = {
  property_id: string;
  property_name: string;
  logo_url: string | null;
  organization_id: string;
  organization_name: string;
  role: string;
  has_property_access: boolean;
};

/**
 * Every hotel the user can read, in switcher order: their own organizations
 * first, the demo organization last (it only appears in testing mode), then by
 * organization name and hotel name.
 *
 * Access is decided in SQL by propertyReadAccessSql, exactly as everywhere
 * else in authz. Only properties that belong to an organization are listed:
 * a legacy pre-org property has no org to switch to. One row per property even
 * if the user somehow holds two member rows in the same org (the lateral join
 * takes one, preferring the row with a property_access grant).
 */
export async function listSwitchableProperties(userId: string, deps: AuthzDeps = {}): Promise<SwitchableProperty[]> {
  if (!userId) return [];
  const testing = deps.testing ?? isTestingMode();
  const query = deps.query ?? dbQuery;
  // Same fixed-literal approach as propertyAccessSql: our own constant, never
  // input, and no extra bind parameter.
  const demoExclusion = testing ? "" : `\n         AND m."organizationId" <> '${DEMO_ORG_ID}'`;
  const rows = await query<SwitchableRow>(
    `SELECT p.id AS property_id,
            p.name AS property_name,
            (SELECT i.url FROM property_images i
              WHERE i.property_id = p.id AND i."group" = 'logo'
              ORDER BY i.sort_order, i.created_at, i.id
              LIMIT 1) AS logo_url,
            o.id AS organization_id,
            o.name AS organization_name,
            mm.role,
            mm.has_property_access
     FROM properties p
     JOIN "organization" o ON o.id = p.organization_id
     JOIN LATERAL (
       SELECT m.role,
              EXISTS (
                SELECT 1 FROM property_access pa
                WHERE pa.member_id = m.id AND pa.property_id = p.id
              ) AS has_property_access
       FROM "member" m
       WHERE m."organizationId" = p.organization_id
         AND m."userId" = $1${demoExclusion}
       ORDER BY has_property_access DESC, m.id
       LIMIT 1
     ) mm ON TRUE
     WHERE p.organization_id IS NOT NULL
       AND ${propertyReadAccessSql("$1", testing)}
     ORDER BY (o.id = '${DEMO_ORG_ID}'), o.name, p.name, p.id`,
    [userId],
  );
  return rows.map((r) => ({
    propertyId: r.property_id,
    propertyName: r.property_name,
    logoUrl: r.logo_url,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    role: r.role,
    hasPropertyAccess: r.has_property_access === true,
  }));
}

/**
 * Which hotel of `list` the session is on, given what it stored:
 * (1) the stored property, if still reachable and in the stored org;
 * (2) the first reachable hotel of the stored org;
 * (3) the first reachable hotel overall (own orgs sort before the demo org);
 * (4) null — the user can reach no hotel.
 */
export function pickCurrentProperty(list: SwitchableProperty[], stored: StoredPointers): CurrentProperty | null {
  const { activePropertyId, activeOrganizationId } = stored;
  if (activePropertyId && activeOrganizationId) {
    const exact = list.find((h) => h.propertyId === activePropertyId && h.organizationId === activeOrganizationId);
    if (exact) return exact;
  }
  if (activeOrganizationId) {
    const sameOrg = list.find((h) => h.organizationId === activeOrganizationId);
    if (sameOrg) return sameOrg;
  }
  return list[0] ?? null;
}

/**
 * The session's current hotel. The stored pointers come from the session row
 * in the database (not the cookie cache, which can be up to a minute stale),
 * bound to both the session id and the user id; a missing row means nothing
 * stored. Also returns the stored pointers so callers can tell when the
 * resolved hotel differs from what the session row says.
 */
export async function resolveCurrentProperty(
  ptr: SessionPointer,
  deps: AuthzDeps = {},
): Promise<{ current: CurrentProperty | null; stored: StoredPointers }> {
  const queryOne = deps.queryOne ?? dbQueryOne;
  const [list, row] = await Promise.all([
    listSwitchableProperties(ptr.userId, deps),
    queryOne<StoredPointers>(
      `SELECT "activePropertyId", "activeOrganizationId"
       FROM "session"
       WHERE id = $1 AND "userId" = $2`,
      [ptr.sessionId, ptr.userId],
    ),
  ]);
  const stored: StoredPointers = {
    activePropertyId: row?.activePropertyId ?? null,
    activeOrganizationId: row?.activeOrganizationId ?? null,
  };
  return { current: pickCurrentProperty(list, stored), stored };
}

/**
 * Switch the session to `propertyId`. The property must be one the user can
 * read right now (listSwitchableProperties); its org is taken from that list,
 * never from input. Both pointers are written in one statement, bound to the
 * session id and the user id. Returns the hotel written, or null when the user
 * cannot read it or the session row is not theirs — nothing is written then.
 */
export async function setCurrentProperty(
  ptr: SessionPointer,
  propertyId: string,
  deps: AuthzDeps = {},
): Promise<CurrentProperty | null> {
  if (!propertyId) return null;
  const list = await listSwitchableProperties(ptr.userId, deps);
  const target = list.find((h) => h.propertyId === propertyId);
  if (!target) return null;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const updated = await queryOne<{ id: string }>(
    `UPDATE "session"
     SET "activePropertyId" = $1, "activeOrganizationId" = $2
     WHERE id = $3 AND "userId" = $4
     RETURNING id`,
    [target.propertyId, target.organizationId, ptr.sessionId, ptr.userId],
  );
  return updated ? target : null;
}

import { getOrgScopedDb } from "@openbookings/authz";
import { queryOne } from "@openbookings/db";
import { activeOrgId } from "@/lib/active-org";
import { canManageTeam } from "./rules";

type SessionWithUser = {
  user: { id: string; email: string; account_type?: string | null };
  session: Record<string, unknown>;
};

export type TeamScope = {
  userId: string;
  orgId: string;
  orgName: string;
  role: string;
  canManage: boolean;
  db: NonNullable<Awaited<ReturnType<typeof getOrgScopedDb>>>;
};

/**
 * The org the Team page is about and the viewer's role in it. The org comes
 * from the session, never from input, and membership is re-verified against
 * the member table (getOrgScopedDb), so someone removed since signing in
 * gets null.
 */
export async function teamScope(session: SessionWithUser | null | undefined): Promise<TeamScope | null> {
  if (!session) return null;
  const orgId = await activeOrgId(session);
  const db = await getOrgScopedDb({ user: session.user, session: { activeOrganizationId: orgId } });
  if (!db) return null;
  const org = await db.queryOne<{ name: string }>(`SELECT name FROM "organization" WHERE id = $1`);
  return {
    userId: session.user.id,
    orgId: db.organizationId,
    orgName: org?.name ?? "Your organisation",
    role: db.memberRole,
    canManage: canManageTeam(db.memberRole),
    db,
  };
}

export type TeamMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
  propertyIds: string[];
};

type TeamInvitation = {
  invitationId: string;
  email: string;
  role: string;
  expiresAt: string;
  propertyIds: string[];
};

type TeamProperty = { id: string; name: string };

export type Team = {
  members: TeamMember[];
  invitations: TeamInvitation[];
  properties: TeamProperty[];
};

/** Everyone in the org, open invitations, and the org's properties. `$1` is the org. */
export async function loadTeam(scope: TeamScope): Promise<Team> {
  const [members, invitations, properties] = await Promise.all([
    scope.db.query<TeamMember>(
      `SELECT m.id AS "memberId", u.id AS "userId",
              COALESCE(NULLIF(trim(u.name), ''), u.email) AS name, u.email, m.role,
              m."createdAt"::text AS "joinedAt",
              COALESCE(array_agg(pa.property_id::text ORDER BY pa.property_id)
                       FILTER (WHERE pa.property_id IS NOT NULL), '{}') AS "propertyIds"
       FROM "member" m
       JOIN "user" u ON u.id = m."userId"
       LEFT JOIN property_access pa ON pa.member_id = m.id
       WHERE m."organizationId" = $1
       GROUP BY m.id, u.id
       ORDER BY m."createdAt", m.id`,
    ),
    scope.db.query<TeamInvitation>(
      `SELECT i.id AS "invitationId", i.email, i.role, i."expiresAt"::text AS "expiresAt",
              COALESCE(array_agg(ipa.property_id::text ORDER BY ipa.property_id)
                       FILTER (WHERE ipa.property_id IS NOT NULL), '{}') AS "propertyIds"
       FROM "invitation" i
       LEFT JOIN invitation_property_access ipa ON ipa.invitation_id = i.id
       WHERE i."organizationId" = $1 AND i.status = 'pending' AND i."expiresAt" > now()
       GROUP BY i.id
       ORDER BY i."createdAt" DESC`,
    ),
    scope.db.query<TeamProperty>(
      `SELECT p.id::text AS id, p.name FROM properties p WHERE p.organization_id = $1 ORDER BY p.name`,
    ),
  ]);
  return { members, invitations, properties };
}

/** Whether the signed-in user has a passkey or authenticator, for the step-up prompt. */
export async function stepUpFactors(scope: TeamScope): Promise<{ hasPasskey: boolean; hasAuthenticator: boolean }> {
  // Not scope.db: this is about the user, not the org, and an unused bound
  // org parameter would fail to type in Postgres.
  const row = await queryOne<{ has_passkey: boolean; has_authenticator: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM "passkey" WHERE "userId" = $1) AS has_passkey,
            COALESCE((SELECT "twoFactorEnabled" FROM "user" WHERE id = $1), FALSE) AS has_authenticator`,
    [scope.userId],
  );
  return { hasPasskey: row?.has_passkey === true, hasAuthenticator: row?.has_authenticator === true };
}

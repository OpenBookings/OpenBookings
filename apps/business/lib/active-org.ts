import { queryOne } from "@openbookings/db";

/**
 * The org a dashboard request is about: the session's active org (the org
 * plugin's `activeOrganizationId`), or — for a session minted before the user
 * had an org — their only membership. Never taken from client input. Callers
 * re-verify membership (getOrgScopedDb does), since a stale active org may
 * point at an org the user has since left.
 */
export async function activeOrgId(session: {
  user: { id: string };
  session: Record<string, unknown>;
}): Promise<string | null> {
  const active = session.session.activeOrganizationId;
  if (typeof active === "string" && active) return active;
  const row = await queryOne<{ id: string; n: number }>(
    `SELECT min("organizationId") AS id, count(*)::int AS n FROM "member" WHERE "userId" = $1`,
    [session.user.id],
  );
  return row?.n === 1 ? row.id : null;
}

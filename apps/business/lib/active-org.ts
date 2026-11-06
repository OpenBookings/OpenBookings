import { query } from "@openbookings/db";
import { DEMO_ORG_ID } from "@openbookings/demo";

/**
 * The org a dashboard request is about: the session's active org (the org
 * plugin's `activeOrganizationId`), or — for a session minted before the user
 * had an org — their only membership. The demo organisation (testing mode)
 * never counts against "only": a host with one real organisation gets that
 * one, and a host with nothing else gets the demo one. Never taken from client input. Callers
 * re-verify membership (getOrgScopedDb does), since a stale active org may
 * point at an org the user has since left.
 */
export async function activeOrgId(session: {
  user: { id: string };
  session: Record<string, unknown>;
}): Promise<string | null> {
  const active = session.session.activeOrganizationId;
  if (typeof active === "string" && active) return active;
  const rows = await query<{ id: string }>(
    `SELECT "organizationId" AS id FROM "member" WHERE "userId" = $1
     ORDER BY ("organizationId" = $2), "organizationId"`,
    [session.user.id, DEMO_ORG_ID],
  );
  const own = rows.filter((r) => r.id !== DEMO_ORG_ID);
  if (own.length === 1) return own[0]!.id;
  if (own.length === 0) return rows[0]?.id ?? null;
  return null;
}

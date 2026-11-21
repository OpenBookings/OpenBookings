import { query } from "@openbookings/db";
import { DEMO_ORG_ID, isTestingMode } from "@openbookings/demo";
import { cachedCurrentPropertyFor, currentPropertyFor } from "@/lib/current-property";

type Deps = {
  query?: <T>(text: string, values?: unknown[]) => Promise<T[]>;
  queryOne?: <T>(text: string, values?: unknown[]) => Promise<T | null>;
  testing?: boolean;
};

/**
 * The org a dashboard request is about: the current hotel's org (see
 * current-property.ts), or, for a user with no reachable hotel yet (org created,
 * property not promoted; front desk not yet assigned), the session's active org
 * (the org plugin's `activeOrganizationId`), or — for a session minted before the user
 * had an org — their only membership. The demo organisation (testing mode)
 * never counts against "only": a host with one real organisation gets that
 * one, and a host with nothing else gets the demo one. Never taken from client input. Callers
 * re-verify membership (getOrgScopedDb does), since a stale active org may
 * point at an org the user has since left.
 */
export async function activeOrgId(session: {
  user: { id: string };
  session: Record<string, unknown>;
}, deps: Deps = {}): Promise<string | null> {
  const testing = deps.testing ?? isTestingMode();
  // A caller that fakes only `query` gets a matching single-row reader.
  const queryOne = deps.queryOne ?? (deps.query ? async <T,>(text: string, values?: unknown[]) => (await deps.query!<T>(text, values))[0] ?? null : undefined);
  const asSession = session as Parameters<typeof currentPropertyFor>[0];
  // With the real database, the request's one resolve (shared with the layout
  // and the page); a caller that passes its own database resolves on it.
  const current =
    deps.query || deps.queryOne || deps.testing !== undefined
      ? await currentPropertyFor(asSession, { query: deps.query, queryOne, testing: deps.testing })
      : await cachedCurrentPropertyFor(asSession);
  if (current) return current.organizationId;
  const active = session.session.activeOrganizationId;
  if (typeof active === "string" && active && (testing || active !== DEMO_ORG_ID)) return active;
  const rows = await (deps.query ?? query)<{ id: string }>(
    `SELECT "organizationId" AS id FROM "member" WHERE "userId" = $1
     ORDER BY ("organizationId" = $2), "organizationId"`,
    [session.user.id, DEMO_ORG_ID],
  );
  const own = rows.filter((r) => r.id !== DEMO_ORG_ID);
  if (own.length === 1) return own[0]!.id;
  if (own.length === 0) return testing ? (rows[0]?.id ?? null) : null;
  return null;
}

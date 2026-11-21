import { cache } from "react";
import {
  listSwitchableProperties,
  resolveCurrentProperty,
  setCurrentProperty,
  type AuthzDeps,
  type CurrentProperty,
  type SwitchableProperty,
} from "@openbookings/authz";

/**
 * The business console's current hotel (server-only: it reads the session and
 * writes the session row).
 *
 * `currentPropertyFor` is the uncached core. It resolves the hotel from the
 * session row in the database, and when the pick differs from what the row
 * stores (nothing stored yet, or a pointer gone stale) it writes the pick back
 * so the next request is stable. That is a write on a read path, so callers
 * that render use the React-cached `getCurrentProperty`, which does it at most
 * once per request.
 */

type SessionLike = { user: { id: string }; session: { id?: unknown } & Record<string, unknown> };

export async function currentPropertyFor(session: SessionLike, deps: AuthzDeps = {}): Promise<CurrentProperty | null> {
  const sessionId = session.session.id;
  if (typeof sessionId !== "string" || !sessionId) return null;
  const ptr = { userId: session.user.id, sessionId };
  const { current, stored } = await resolveCurrentProperty(ptr, deps);
  if (
    current &&
    (current.propertyId !== stored.activePropertyId || current.organizationId !== stored.activeOrganizationId)
  ) {
    // A refusal here (null) just means the pick is not persisted; the pick itself stands.
    await setCurrentProperty(ptr, current.propertyId, deps).catch((error) => {
      console.error("[current-property] persisting the pick failed:", error instanceof Error ? error.message : error);
    });
  }
  return current;
}

// Imported lazily: lib/auth reads the auth env at import time, and active-org
// (which uses the core above) is imported by modules that never need a session.
async function serverSession() {
  const { getServerSession } = await import("@/lib/auth");
  return getServerSession();
}

/** The signed-in host's current hotel, or null (no session, or no reachable hotel). */
export const getCurrentProperty = cache(async (): Promise<CurrentProperty | null> => {
  const session = await serverSession();
  if (!session) return null;
  return currentPropertyFor(session);
});

/** Every hotel the signed-in host can switch to, in switcher order. */
export const getSwitchableProperties = cache(async (): Promise<SwitchableProperty[]> => {
  const session = await serverSession();
  if (!session) return [];
  return listSwitchableProperties(session.user.id);
});

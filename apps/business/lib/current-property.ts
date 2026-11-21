import { cache } from "react";
import {
  listSwitchableProperties,
  resolveCurrentProperty,
  setCurrentProperty,
  type AuthzDeps,
  type CurrentProperty,
  type SwitchableProperty,
} from "@openbookings/authz";
import { DEMO_ORG_ID } from "@openbookings/mode";

/**
 * The business console's current hotel (server-only: it reads the session and
 * writes the session row).
 *
 * `currentPropertyFor` is the uncached core. It resolves the hotel from the
 * session row in the database, and when the pick differs from what the row
 * stores (nothing stored yet, or a pointer gone stale) it writes the pick back
 * so the next request is stable. That is a write on a read path, so callers
 * that render use the React-cached `getCurrentProperty` (or
 * `cachedCurrentPropertyFor` with a session in hand), which does it at most
 * once per request.
 *
 * A demo hotel the session only fell back to (testing mode, no hotel of the
 * user's own yet) is not written back: the next request falls back afresh, so
 * the user lands on their own hotel as soon as they have one. A demo hotel
 * picked on purpose in the switcher is stored by setCurrentProperty and stays.
 */

type SessionLike = { user: { id: string }; session: { id?: unknown } & Record<string, unknown> };

export async function currentPropertyFor(
  session: SessionLike,
  deps: AuthzDeps = {},
  known: { list?: Promise<SwitchableProperty[]> } = {},
): Promise<CurrentProperty | null> {
  const sessionId = session.session.id;
  if (typeof sessionId !== "string" || !sessionId) return null;
  const ptr = { userId: session.user.id, sessionId };
  const { current, stored } = await resolveCurrentProperty(ptr, deps, known);
  const differs =
    current !== null &&
    (current.propertyId !== stored.activePropertyId || current.organizationId !== stored.activeOrganizationId);
  const demoFallback = current?.organizationId === DEMO_ORG_ID && current.propertyId !== stored.activePropertyId;
  if (current && differs && !demoFallback) {
    // A refusal here (null) just means the pick is not persisted; the pick itself stands.
    await setCurrentProperty(ptr, current.propertyId, deps).catch((error) => {
      console.error("[current-property] persisting the pick failed:", error instanceof Error ? error.message : error);
    });
  }
  return current;
}

/** Per request: the hotels a user can switch to, listed once. */
const switchableFor = cache((userId: string): Promise<SwitchableProperty[]> => listSwitchableProperties(userId));

/** Per request: one session's current hotel, resolved (and written back) once, on the list above. */
const currentForSession = cache(
  (userId: string, sessionId: string): Promise<CurrentProperty | null> =>
    currentPropertyFor({ user: { id: userId }, session: { id: sessionId } }, {}, { list: switchableFor(userId) }),
);

/**
 * `currentPropertyFor(session)` memoized for the request, for callers that
 * already hold the session (activeOrgId, supportScope). Where React keeps no
 * per-request cache it resolves on every call, exactly as the uncached core.
 */
export function cachedCurrentPropertyFor(session: SessionLike): Promise<CurrentProperty | null> {
  const sessionId = session.session.id;
  if (typeof sessionId !== "string" || !sessionId) return Promise.resolve(null);
  return currentForSession(session.user.id, sessionId);
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
  return cachedCurrentPropertyFor(session);
});

/** Every hotel the signed-in host can switch to, in switcher order. */
export const getSwitchableProperties = cache(async (): Promise<SwitchableProperty[]> => {
  const session = await serverSession();
  if (!session) return [];
  return switchableFor(session.user.id);
});

/**
 * What a write check pins to (authz `deps.currentPropertyId`): the current
 * hotel, so a stale tab still showing hotel A cannot write to A after the user
 * switched to B. With no current hotel the pin is "", which authz refuses as
 * not a UUID: no current hotel, no writes.
 */
export type PropertyPin = { currentPropertyId: string };

export async function currentPropertyPin(): Promise<PropertyPin> {
  return { currentPropertyId: (await getCurrentProperty())?.propertyId ?? "" };
}

export type PinnedAccess = "ok" | "denied" | "property-switched";

/**
 * Runs an authz check pinned to the current hotel. When it refuses, a second,
 * unpinned run tells the two refusals apart: a target the user can reach,
 * just not on the hotel on screen, is "property-switched" (the action can say
 * the hotel changed); anything else is "denied". The second run only happens
 * on a refusal, and only reveals what the user can already reach.
 */
export async function pinnedAccess(
  pin: PropertyPin,
  check: (pin: Partial<PropertyPin>) => Promise<boolean>,
): Promise<PinnedAccess> {
  if (await check(pin)) return "ok";
  return (await check({})) ? "property-switched" : "denied";
}

/** `{ reason: "property-switched" }` for a refusal the pin caused, else nothing, to spread into a result. */
export function switchedReason(access: PinnedAccess): { reason?: "property-switched" } {
  return access === "property-switched" ? { reason: "property-switched" } : {};
}

import * as Sentry from "@sentry/nextjs";
import { userCan, type SessionLike } from "@openbookings/authz";
import { queryOne as dbQueryOne, withTransaction, type Queryable } from "@openbookings/db";
import { activeInstallation, connectApp, disconnectApp } from "@openbookings/db/apps";
import type { InstallationRegistration } from "@openbookings/apps-contract";
import { registerInstallation, unregisterInstallation } from "@/lib/apps/registry";
import { currentPropertyPin, pinnedAccess, switchedReason, type PropertyPin } from "@/lib/current-property";

/**
 * Connect and disconnect SiteMinder for a hotel, minus the Next.js plumbing
 * (actions.ts adds the session, revalidation and the guest-page purge). Kept
 * apart so each path runs against a real database inside a rolled-back
 * transaction, with the app's registry faked.
 */

export type ChannelManagerResult =
  | { ok: true; propertyCode?: string }
  | { ok: false; error: string; reason?: "property-switched" };

export const CONNECT_UNAVAILABLE = "SiteMinder connection is not available right now. Try again in a few minutes.";
const DISCONNECT_UNAVAILABLE = "Could not disconnect SiteMinder right now. Try again in a few minutes.";

/** How long the app gets to accept an installation before the connect is undone. */
export const REGISTRATION_TIMEOUT_MS = 5_000;

export interface ConnectDeps {
  /** Runs `fn` atomically; a throw rolls everything back. */
  tx: <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>;
  queryOne: <T>(text: string, values?: unknown[]) => Promise<T | null>;
  pin: () => Promise<PropertyPin>;
  register: (registration: InstallationRegistration) => Promise<void>;
  unregister: (installationId: string) => Promise<void>;
  /** This app's public URL, as the app should reach the Apps API; undefined when unset. */
  coreBaseUrl: () => string | undefined;
  now: () => Date;
}

const timeoutFetch: typeof fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(REGISTRATION_TIMEOUT_MS) })) as typeof fetch;

export const defaultDeps: ConnectDeps = {
  tx: withTransaction,
  queryOne: dbQueryOne,
  pin: currentPropertyPin,
  register: (registration) => registerInstallation(registration, timeoutFetch),
  unregister: (installationId) => unregisterInstallation(installationId, timeoutFetch),
  coreBaseUrl: () => process.env.APPS_API_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
  now: () => new Date(),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const report = (error: unknown, phase: string) =>
  Sentry.captureException(error, { tags: { area: "apps", surface: "channel-manager", phase } });

/** Who may connect or disconnect: whoever may edit the property, pinned to the current hotel. */
async function mayManage(session: SessionLike, propertyId: string, deps: ConnectDeps) {
  if (!UUID.test(propertyId)) return { ok: false, error: "Property not found" } as const;
  const access = await pinnedAccess(await deps.pin(), (pin) =>
    userCan(session, propertyId, { property: ["update"] }, { queryOne: deps.queryOne, ...pin }),
  );
  if (access === "ok") return { ok: true } as const;
  return { ok: false, error: "Property not found", ...switchedReason(access) } as const;
}

/**
 * Connect SiteMinder: issue the installation's key and tell the app about it,
 * in one transaction. If the app cannot be told (down, refuses, slower than 5
 * seconds) the throw rolls the connection back, so a hotel is never connected
 * to an app that does not know it.
 */
export async function connectChannelManager(
  session: SessionLike & { user: { id: string } },
  input: { propertyId: string; sendUpcoming: boolean },
  deps: ConnectDeps = defaultDeps,
): Promise<ChannelManagerResult> {
  const allowed = await mayManage(session, input.propertyId, deps);
  if (!allowed.ok) return allowed;

  const coreBaseUrl = deps.coreBaseUrl();
  if (!coreBaseUrl) {
    report(new Error("APPS_API_BASE_URL is not set"), "connect");
    return { ok: false, error: CONNECT_UNAVAILABLE };
  }

  try {
    const propertyCode = await deps.tx(async (db) => {
      const { installation, apiKey } = await connectApp(db, {
        propertyId: input.propertyId,
        appKey: "siteminder",
        userId: session.user.id,
        sendUpcoming: input.sendUpcoming === true,
        now: deps.now(),
      });
      const property = (
        await db.query(`SELECT name, channel_code FROM properties WHERE id = $1::uuid`, [input.propertyId])
      ).rows[0] as { name: string; channel_code: string };
      await deps.register({
        installationId: installation.id,
        propertyCode: property.channel_code,
        propertyName: property.name,
        apiKey,
        coreBaseUrl,
      });
      return property.channel_code;
    });
    return { ok: true, propertyCode };
  } catch (error) {
    report(error, "connect");
    return { ok: false, error: CONNECT_UNAVAILABLE };
  }
}

/**
 * Disconnect: switch the installation off (the app's key stops working at
 * once), then tell the app to forget it. Telling the app is best effort: the
 * key is already dead, so a failure is logged and the disconnect stands.
 * Disconnecting a hotel that is not connected is a no-op.
 */
export async function disconnectChannelManager(
  session: SessionLike,
  input: { propertyId: string },
  deps: ConnectDeps = defaultDeps,
): Promise<ChannelManagerResult> {
  const allowed = await mayManage(session, input.propertyId, deps);
  if (!allowed.ok) return allowed;

  let installationId: string | null;
  try {
    installationId = await deps.tx(async (db) => {
      const installation = await activeInstallation(db, input.propertyId);
      if (!installation) return null;
      await disconnectApp(db, { installationId: installation.id, now: deps.now() });
      return installation.id;
    });
  } catch (error) {
    report(error, "disconnect");
    return { ok: false, error: DISCONNECT_UNAVAILABLE };
  }

  if (installationId) {
    try {
      await deps.unregister(installationId);
    } catch (error) {
      report(error, "unregister");
    }
  }
  return { ok: true };
}

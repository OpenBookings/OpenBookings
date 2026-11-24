import { getPool, type Queryable } from "@openbookings/db";
import { activeInstallation } from "@openbookings/db/apps";

/** The ActionResult error code every guarded write returns for a managed property. */
export const MANAGED_BY_APP = "managed-by-app";

export const MANAGED_BY_APP_MESSAGE = "This is managed by SiteMinder. Change it there.";

export type ManagedBy = { appKey: "siteminder"; displayName: "SiteMinder" };

/**
 * The app that runs this property's rates and availability, or null when the
 * hotel manages them itself. A property is managed exactly while it has an
 * active app installation. Pass a transaction to read inside it.
 */
export async function managedBy(propertyId: string, db: Queryable = getPool()): Promise<ManagedBy | null> {
  const installation = await activeInstallation(db, propertyId);
  return installation ? { appKey: installation.appKey, displayName: "SiteMinder" } : null;
}

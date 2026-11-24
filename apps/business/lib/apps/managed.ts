import { getPool, type Queryable } from "@openbookings/db";
import { activeInstallation } from "@openbookings/db/apps";
import { todayInZone } from "@openbookings/pricing";
import type { ManagedRooms } from "./managed-view";

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

/**
 * For the pages that lock or mark things on a managed hotel: null when the
 * hotel manages its own rates, else the rooms SiteMinder has not linked yet,
 * those with no availability from it for today (at the hotel) or later.
 * Drafts count: the grid lists them. Archived rooms are gone. No
 * authorisation: the page checks access and passes the current hotel.
 */
export async function loadManagedRooms(
  propertyId: string,
  db: Queryable = getPool(),
  now: Date = new Date(),
): Promise<ManagedRooms | null> {
  if (!(await managedBy(propertyId, db))) return null;
  const property = (await db.query(`SELECT timezone FROM properties WHERE id = $1::uuid`, [propertyId])).rows[0] as
    | { timezone: string }
    | undefined;
  if (!property) return null;
  const rows = (
    await db.query(
      `SELECT r.id::text AS id
         FROM rooms r
        WHERE r.property_id = $1::uuid
          AND r.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM app_inventory ai WHERE ai.room_id = r.id AND ai.date >= $2::date)`,
      [propertyId, todayInZone(property.timezone, now)],
    )
  ).rows as { id: string }[];
  return { unlinkedRoomIds: rows.map((r) => r.id) };
}

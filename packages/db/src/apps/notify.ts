/**
 * The doorbell on booking changes: tell the booking's app (if the property has
 * one) that there is new work. The ring carries no booking data; the app pulls
 * the change feed. Publishing is best effort: a failure is logged and never
 * touches the booking, and the app's polling covers a missed ring.
 */
import { ringDoorbell } from "@openbookings/apps-contract";
import type { Queryable } from "../reservation-policy";
import { activeInstallation } from "./installations";

export type Ring = (installationId: string, appKey: string) => Promise<void>;

/** Call after the transaction that wrote the booking event has committed. Never throws. */
export async function notifyBookingChanged(db: Queryable, bookingId: string, deps: { ring: Ring }): Promise<void> {
  try {
    const booking = (await db.query(`SELECT hotel_id FROM bookings WHERE id = $1::uuid`, [bookingId])).rows[0] as
      | { hotel_id: string }
      | undefined;
    if (!booking) return;
    const installation = await activeInstallation(db, booking.hotel_id);
    if (!installation) return;
    await deps.ring(installation.id, installation.appKey);
  } catch (error) {
    console.warn("[apps] doorbell failed:", error instanceof Error ? error.message : error);
  }
}

const APP_URL_VARIABLE: Record<string, string> = { siteminder: "APP_SITEMINDER_URL" };

/** The ring for the configured apps, or null when QStash or the app's URL is not set up. */
export function doorbellFromEnv(env: NodeJS.ProcessEnv): Ring | null {
  const qstashToken = env.QSTASH_TOKEN;
  const siteminderUrl = env.APP_SITEMINDER_URL;
  if (!qstashToken || !siteminderUrl) return null;
  const qstashUrl = (env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/+$/, "");
  return async (installationId, appKey) => {
    const variable = APP_URL_VARIABLE[appKey];
    const appBaseUrl = variable ? env[variable] : undefined;
    if (!appBaseUrl) return;
    await ringDoorbell({ qstashUrl, qstashToken, appBaseUrl: appBaseUrl.replace(/\/+$/, ""), installationId });
  };
}

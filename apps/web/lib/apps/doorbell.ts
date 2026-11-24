import { after } from "next/server";
import { getPool } from "@openbookings/db";
import { doorbellFromEnv, notifyBookingChanged } from "@openbookings/db/apps";

/**
 * Ring the booking's app after a change the app must hear about. Call it once
 * the change has committed: the ring runs after the response, never inside a
 * transaction, and never fails the caller (notifyBookingChanged logs and
 * swallows). Does nothing when QStash or the app is not configured.
 */
export function ringBookingChanged(bookingId: string): void {
  const ring = doorbellFromEnv(process.env);
  if (!ring) return;
  after(() => notifyBookingChanged(getPool(), bookingId, { ring }));
}

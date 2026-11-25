import * as Sentry from "@sentry/nextjs";
import type { Queryable } from "@openbookings/db";
import { claimAlert, releaseAlert } from "@openbookings/db/apps";
import { sendChannelDeliveryFailed } from "@openbookings/mailing/booking-send";

export type DeliveryAlert = {
  installationId: string;
  bookingId: string;
  propertyId: string;
  appKey: string;
  detail: string | null;
};

function warnUs(i: DeliveryAlert): void {
  try {
    Sentry.captureMessage(`Booking did not reach ${i.appKey}`, {
      level: "warning",
      tags: { app: i.appKey, property_id: i.propertyId },
      extra: { bookingId: i.bookingId, detail: i.detail?.slice(0, 500) ?? null },
    });
  } catch (error) {
    console.error("[apps] delivery alert failed:", error instanceof Error ? error.message : error);
  }
}

/**
 * A booking is in `needs_attention` with its app: email the hotel and warn
 * us, at most once per move into that state. Run after the report's
 * transaction committed (never inside it).
 *
 * The row's mail is claimed first (`mailed_at`), so the delivery route and the
 * watchdog job never both send it. If the mail fails, the claim is released
 * and the watchdog job tries again on its next run; we hear about it (Sentry)
 * on the first failure only, not on every retry. Never throws.
 *
 * "sent": mailed now. "failed": not mailed, left for a retry. "skipped":
 * mailed already, no longer needs attention, or the claim itself failed (the
 * watchdog picks it up).
 */
export async function alertDeliveryNeedsAttention(db: Queryable, i: DeliveryAlert, now: Date): Promise<"sent" | "failed" | "skipped"> {
  const key = { installationId: i.installationId, bookingId: i.bookingId, now };
  try {
    if (!(await claimAlert(db, key))) return "skipped";
  } catch (error) {
    console.error("[apps] could not claim the delivery alert:", error instanceof Error ? error.message : error);
    return "skipped";
  }

  try {
    await sendChannelDeliveryFailed(i.bookingId, i.detail);
  } catch (error) {
    console.error("[apps] delivery-failed email failed:", error instanceof Error ? error.message : error);
    let first = false;
    try {
      first = await releaseAlert(db, key);
    } catch (releaseError) {
      console.error("[apps] could not release the delivery alert:", releaseError instanceof Error ? releaseError.message : releaseError);
    }
    if (first) {
      try {
        Sentry.captureException(error, { tags: { area: "booking-mail", kind: "channel_delivery_failed" }, extra: { bookingId: i.bookingId } });
      } catch {
        // Reporting must not throw either.
      }
      warnUs(i);
    }
    return "failed";
  }
  warnUs(i);
  return "sent";
}

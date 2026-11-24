import * as Sentry from "@sentry/nextjs";
import { sendChannelDeliveryFailed } from "@openbookings/mailing/booking-send";

/**
 * A booking just moved into `needs_attention` with its app: email the hotel
 * and warn us. Run after the report's transaction committed. Neither step may
 * fail the report: errors are logged and sent to Sentry, never thrown.
 */
export async function alertDeliveryNeedsAttention(i: {
  bookingId: string;
  propertyId: string;
  appKey: string;
  detail: string | null;
}): Promise<void> {
  try {
    await sendChannelDeliveryFailed(i.bookingId, i.detail);
  } catch (error) {
    console.error("[apps] delivery-failed email failed:", error instanceof Error ? error.message : error);
    try {
      Sentry.captureException(error, { tags: { area: "booking-mail", kind: "channel_delivery_failed" }, extra: { bookingId: i.bookingId } });
    } catch {
      // Reporting must not throw either.
    }
  }
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

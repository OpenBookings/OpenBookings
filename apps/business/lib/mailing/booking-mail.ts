import * as Sentry from "@sentry/nextjs";
import { sendBookingCancelled, type CancelledRooms } from "@openbookings/mailing/booking-send";

/** Tells the guest and the host which rooms were cancelled. Never throws. */
export const sendCancellation = (bookingId: string, cancelled: CancelledRooms) =>
  sendBookingCancelled(bookingId, cancelled, (error, extra) =>
    Sentry.captureException(error, { tags: { area: "booking-mail", kind: extra.kind }, extra }),
  );

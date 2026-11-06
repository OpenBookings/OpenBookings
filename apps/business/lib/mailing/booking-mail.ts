import * as Sentry from "@sentry/nextjs";
import { sendBookingCancelled, sendBookingConfirmed, sendOversoldRefunded, type CancelledRooms } from "@openbookings/mailing/booking-send";

/** Tells the guest and the host which rooms were cancelled. Never throws. */
export const sendCancellation = (bookingId: string, cancelled: CancelledRooms) =>
  sendBookingCancelled(bookingId, cancelled, (error, extra) =>
    Sentry.captureException(error, { tags: { area: "booking-mail", kind: extra.kind }, extra }),
  );

/** The guest's confirmation and the host's notice. Throws if a mail fails: the caller reports it. */
export const sendConfirmed = (bookingId: string) => sendBookingConfirmed(bookingId);

export const sendOversold = (intentId: string) => sendOversoldRefunded(intentId);

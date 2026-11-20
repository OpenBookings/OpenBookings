import * as Sentry from "@sentry/nextjs";
import {
  sendBookingCancelled,
  sendRefundIssued,
  type CancelledRooms,
  type IssuedRefund,
} from "@openbookings/mailing/booking-send";

/** Tells the guest and the host which rooms were cancelled. Never throws. */
export const sendCancellation = (bookingId: string, cancelled: CancelledRooms) =>
  sendBookingCancelled(bookingId, cancelled, (error, extra) =>
    Sentry.captureException(error, { tags: { area: "booking-mail", kind: extra.kind }, extra }),
  );

/** Tells the guest about an early-departure or retried refund, as Stripe answered it. Never throws. */
export const sendRefundMail = (bookingId: string, reason: "early_departure" | "retry", refunds: IssuedRefund[]) =>
  sendRefundIssued(bookingId, { reason, refunds }, (error, extra) =>
    Sentry.captureException(error, { tags: { area: "booking-mail", kind: extra.kind }, extra }),
  );

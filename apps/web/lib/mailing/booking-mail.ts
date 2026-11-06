import { sendBookingCancelled } from "@openbookings/mailing/booking-send";

const urls = {
  webUrl: process.env.NEXT_PUBLIC_WEB_URL || "https://openbookings.co",
  businessUrl: process.env.NEXT_PUBLIC_BUSINESS_URL || "https://business.openbookings.co",
};

/** Tells the guest and the host that rooms were cancelled. Never throws. */
export const sendCancellation = (bookingId: string) => sendBookingCancelled(bookingId, urls);

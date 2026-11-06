import { composeActionMail, type ActionMail } from "./action-mail";
import { formatStayDate } from "./format";
import { escapeHtml } from "./template";

/** One booked room as the mail lists it. `guests` and the dates are plain text. */
export type MailRoom = { name: string; ratePlan: string; guests: string; freeCancellationUntil: string | null };

const STRONG = (text: string) => `<strong style="color:#DDDDDD;">${escapeHtml(text)}</strong>`;
const FOOTNOTE = 'Questions? Email <a href="mailto:support@openbookings.co" style="color:#AAAAAA;text-decoration:underline;">support@openbookings.co</a>.';

function roomLines(rooms: MailRoom[]): string {
  return rooms
    .map((r) => {
      const cancel = r.freeCancellationUntil ? `free cancellation until ${r.freeCancellationUntil}` : "non-refundable";
      return `${STRONG(r.name)}<br />${escapeHtml(`${r.ratePlan}, ${r.guests}, ${cancel}`)}`;
    })
    .join("<br /><br />");
}

const roomNames = (rooms: string[]) => rooms.map(STRONG).join(", ");

const stay = (checkIn: string, checkOut: string) => `${escapeHtml(formatStayDate(checkIn))} to ${escapeHtml(formatStayDate(checkOut))}`;

export function guestBookingConfirmed(i: {
  propertyName: string;
  checkIn: string;
  checkOut: string;
  rooms: MailRoom[];
  total: string;
  bookingUrl: string;
}): ActionMail {
  return composeActionMail({
    subject: `Booking confirmed: ${i.propertyName}`,
    preheader: `Your stay at ${i.propertyName} is confirmed.`,
    eyebrow: "Booking",
    headline: "Your booking<br />is confirmed.",
    body: `${STRONG(i.propertyName)}, ${stay(i.checkIn, i.checkOut)}.<br /><br />${roomLines(i.rooms)}<br /><br />Total paid: ${STRONG(i.total)}`,
    ctaUrl: i.bookingUrl,
    ctaLabel: "View your booking",
    footnote: FOOTNOTE,
  });
}

export function guestOversoldRefunded(i: { propertyName: string; amount: string; searchUrl: string }): ActionMail {
  return composeActionMail({
    subject: `Your booking at ${i.propertyName} could not be completed`,
    preheader: "The rooms were taken just before your payment arrived. You were refunded in full.",
    eyebrow: "Booking",
    headline: "Sorry, the rooms<br />were just taken.",
    body: `Someone else booked the rooms at ${STRONG(i.propertyName)} just before your payment arrived, so we could not confirm your stay. We refunded ${STRONG(i.amount)} in full. It can take a few days to show on your statement.`,
    ctaUrl: i.searchUrl,
    ctaLabel: "Find another stay",
    footnote: FOOTNOTE,
  });
}

export function hostNewBooking(i: {
  propertyName: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  rooms: MailRoom[];
  total: string;
  reservationsUrl: string;
}): ActionMail {
  return composeActionMail({
    subject: `New booking at ${i.propertyName}`,
    preheader: `${i.guestName} booked ${i.propertyName}.`,
    eyebrow: "Reservations",
    headline: "You have a<br />new booking.",
    body: `${STRONG(i.guestName)} booked ${STRONG(i.propertyName)}, ${stay(i.checkIn, i.checkOut)}.<br /><br />${roomLines(i.rooms)}<br /><br />Total paid: ${STRONG(i.total)}`,
    ctaUrl: i.reservationsUrl,
    ctaLabel: "Open reservations",
    footnote: FOOTNOTE,
  });
}

export function guestBookingCancelled(i: { propertyName: string; rooms: string[]; refund: string; bookingUrl: string }): ActionMail {
  return composeActionMail({
    subject: `Booking cancelled: ${i.propertyName}`,
    preheader: `Your booking at ${i.propertyName} was cancelled.`,
    eyebrow: "Booking",
    headline: "Your booking<br />was cancelled.",
    body: `Cancelled at ${STRONG(i.propertyName)}: ${roomNames(i.rooms)}.<br /><br />Refund: ${STRONG(i.refund)}. It can take a few days to show on your statement.`,
    ctaUrl: i.bookingUrl,
    ctaLabel: "View your booking",
    footnote: FOOTNOTE,
  });
}

export function hostBookingCancelled(i: { propertyName: string; guestName: string; rooms: string[]; reservationsUrl: string }): ActionMail {
  return composeActionMail({
    subject: `Booking cancelled at ${i.propertyName}`,
    preheader: `A booking at ${i.propertyName} was cancelled.`,
    eyebrow: "Reservations",
    headline: "A booking<br />was cancelled.",
    body: `The booking by ${STRONG(i.guestName)} at ${STRONG(i.propertyName)} was cancelled: ${roomNames(i.rooms)}. The rooms are available again.`,
    ctaUrl: i.reservationsUrl,
    ctaLabel: "Open reservations",
    footnote: FOOTNOTE,
  });
}

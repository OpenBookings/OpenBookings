import { expect, test } from "bun:test";
import {
  formatEuro,
  formatStayDate,
  guestBookingCancelled,
  guestBookingConfirmed,
  guestOversoldRefunded,
  hostBookingCancelled,
  hostNewBooking,
} from "./index";

const EVIL = "<b>&";
const rooms = [
  { name: "Deluxe <Room>", ratePlan: "Flexible", guests: "2 guests", freeCancellationUntil: "Fri 5 Mar 2027" },
  { name: "Garden Suite", ratePlan: "Non-refundable", guests: "1 guest", freeCancellationUntil: null },
];
const stay = { checkIn: "2027-03-12", checkOut: "2027-03-14" };
const mails = {
  confirmed: guestBookingConfirmed({ propertyName: EVIL, ...stay, rooms, total: "€300.00", bookingUrl: "https://web.test/bookings/b1" }),
  oversold: guestOversoldRefunded({ propertyName: EVIL, amount: "€300.00", searchUrl: "https://web.test/search" }),
  hostNew: hostNewBooking({ propertyName: EVIL, guestName: EVIL, ...stay, rooms, total: "€300.00", reservationsUrl: "https://biz.test/r" }),
  cancelled: guestBookingCancelled({ propertyName: EVIL, rooms: ["Deluxe <Room>"], refund: "€100.00", bookingUrl: "https://web.test/bookings/b1" }),
  hostCancelled: hostBookingCancelled({ propertyName: EVIL, guestName: EVIL, rooms: ["Deluxe <Room>"], reservationsUrl: "https://biz.test/r" }),
};

test("every composer escapes the property name", () => {
  for (const [name, mail] of Object.entries(mails)) {
    expect(mail.html, name).toContain("&lt;b&gt;&amp;");
    expect(mail.html, name).not.toContain("<b>&");
  }
});

test("guest and host names and room names are escaped", () => {
  expect(mails.hostNew.html).toContain("Deluxe &lt;Room&gt;");
  expect(mails.hostNew.html).not.toContain("Deluxe <Room>");
  expect(mails.hostCancelled.html).not.toContain("<b>&");
});

test("the confirmation lists every room and links to the booking", () => {
  expect(mails.confirmed.subject).toBe("Booking confirmed: <b>&");
  expect(mails.confirmed.html).toContain("Garden Suite");
  expect(mails.confirmed.html).toContain("Deluxe &lt;Room&gt;");
  expect(mails.confirmed.html).toContain("https://web.test/bookings/b1");
  expect(mails.confirmed.html).toContain("Fri 12 Mar 2027");
  expect(mails.confirmed.html).toContain("non-refundable");
});

test("dates come from the string, never from local time", () => {
  expect(formatStayDate("2027-01-01")).toBe("Fri 1 Jan 2027");
  expect(formatStayDate("2027-12-31")).toBe("Fri 31 Dec 2027");
});

test("euros read in British English", () => {
  expect(formatEuro(1234.5)).toBe("€1,234.50");
});

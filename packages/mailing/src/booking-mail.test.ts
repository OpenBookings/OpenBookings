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
  {
    name: "Deluxe <Room>",
    ratePlan: "Flexible",
    guests: "2 guests",
    freeCancellationUntil: "Fri 5 Mar 2027",
    nights: [
      { date: "2027-03-12", price: 100 },
      { date: "2027-03-13", price: 100 },
    ],
    touristTaxLines: [{ label: "€3.00 per person per night", amount: 12 }],
  },
  {
    name: "Garden Suite",
    ratePlan: "Non-refundable",
    guests: "1 guest",
    freeCancellationUntil: null,
    nights: [
      { date: "2027-03-12", price: 49.5 },
      { date: "2027-03-13", price: 50.5 },
    ],
    touristTaxLines: [],
  },
];
const stay = { checkIn: "2027-03-12", checkOut: "2027-03-14" };
// €300 of rooms + €12 tourist tax.
const money = { roomsCents: 30000, touristTaxCents: 1200, totalCents: 31200 };
const seller = { legalName: "Evil & Sons <BV>", vatNumber: "NL123456789B01" };
const mails = {
  confirmed: guestBookingConfirmed({ propertyName: EVIL, ...stay, rooms, money, seller, reference: "AB12CD34", bookingUrl: "https://web.test/bookings/b1" }),
  oversold: guestOversoldRefunded({ propertyName: EVIL, amount: "€300.00", searchUrl: "https://web.test/search" }),
  hostNew: hostNewBooking({ propertyName: EVIL, guestName: EVIL, ...stay, rooms, money, commissionCents: 1350, reference: "AB12CD34", reservationsUrl: "https://biz.test/r" }),
  cancelled: guestBookingCancelled({ propertyName: EVIL, rooms: ["Deluxe <Room>"], refund: "€100.00", cancelsBooking: true, bookingUrl: "https://web.test/bookings/b1" }),
  hostCancelled: hostBookingCancelled({ propertyName: EVIL, guestName: EVIL, rooms: ["Deluxe <Room>"], cancelsBooking: true, reservationsUrl: "https://biz.test/r" }),
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

test("a partial cancellation does not say the booking was cancelled", () => {
  const part = guestBookingCancelled({ propertyName: "Hotel", rooms: ["A"], refund: "€50.00", cancelsBooking: false, bookingUrl: "https://web.test/b" });
  expect(part.html).not.toContain("Your booking<br />was cancelled");
  expect(part.subject).toBe("Rooms cancelled: Hotel");
  const host = hostBookingCancelled({ propertyName: "Hotel", guestName: "G", rooms: ["A"], cancelsBooking: false, reservationsUrl: "https://biz.test/r" });
  expect(host.subject).toBe("Rooms cancelled at Hotel");
});

test("no refund says so instead of the statement line", () => {
  const none = guestBookingCancelled({ propertyName: "Hotel", rooms: ["A"], refund: null, cancelsBooking: true, bookingUrl: "https://web.test/b" });
  expect(none.html).toContain("No refund is due under your cancellation terms.");
  expect(none.html).not.toContain("statement");
});

test("the confirmation itemises each room's nights and tourist tax", () => {
  const html = mails.confirmed.html;
  // Same-price nights collapse into one line; different prices each get their own.
  expect(html).toContain("Fri 12 Mar 2027 · 2 nights × €100.00");
  expect(html).toContain("€200.00");
  expect(html).toContain("Fri 12 Mar 2027 · 1 night");
  expect(html).toContain("€49.50");
  expect(html).toContain("Sat 13 Mar 2027 · 1 night");
  expect(html).toContain("€50.50");
  expect(html).toContain("Tourist tax (€3.00 per person per night)");
  expect(html).toContain("€12.00");
});

test("the confirmation totals the rooms incl. VAT, the tourist tax and what was paid", () => {
  const html = mails.confirmed.html;
  expect(html).toContain("Rooms, incl. VAT");
  expect(html).toContain("€300.00");
  expect(html).toContain("Total paid");
  expect(html).toContain("€312.00");
  expect(html).toContain("AB12CD34");
});

test("the guest sees who provides the stay, escaped, and never the commission", () => {
  expect(mails.confirmed.html).toContain("Evil &amp; Sons &lt;BV&gt;");
  expect(mails.confirmed.html).toContain("NL123456789B01");
  expect(mails.confirmed.html).not.toContain("Evil & Sons <BV>");
  expect(mails.confirmed.html.toLowerCase()).not.toContain("commission");
});

test("without legal details there is no provider line", () => {
  const plain = guestBookingConfirmed({ propertyName: "Hotel", ...stay, rooms, money, seller: { legalName: null, vatNumber: null }, reference: "AB12CD34", bookingUrl: "https://web.test/b" });
  expect(plain.html).not.toContain("Provided by");
  expect(plain.html).not.toContain("VAT number");
});

test("a stay without tourist tax has no tourist tax total", () => {
  const noTax = guestBookingConfirmed({
    propertyName: "Hotel",
    ...stay,
    rooms: [rooms[1]!],
    money: { roomsCents: 10000, touristTaxCents: 0, totalCents: 10000 },
    seller: { legalName: null, vatNumber: null },
    reference: "AB12CD34",
    bookingUrl: "https://web.test/b",
  });
  expect(noTax.html).not.toContain("Tourist tax");
});

test("the host sees the commission and what they receive", () => {
  const html = mails.hostNew.html;
  expect(html).toContain("OpenBookings commission");
  expect(html).toContain("−€13.50");
  expect(html).toContain("You receive");
  expect(html).toContain("€298.50");
});

test("with the commission off the host has no commission line", () => {
  const off = hostNewBooking({ propertyName: "Hotel", guestName: "G", ...stay, rooms, money, commissionCents: 0, reference: "AB12CD34", reservationsUrl: "https://biz.test/r" });
  expect(off.html).not.toContain("OpenBookings commission");
  expect(off.html).toContain("You receive");
  expect(off.html).toContain("€312.00");
});

test("tourist tax labels are escaped", () => {
  const evil = guestBookingConfirmed({
    propertyName: "Hotel",
    ...stay,
    rooms: [{ ...rooms[0]!, touristTaxLines: [{ label: EVIL, amount: 1 }] }],
    money,
    seller: { legalName: null, vatNumber: null },
    reference: "AB12CD34",
    bookingUrl: "https://web.test/b",
  });
  expect(evil.html).toContain("Tourist tax (&lt;b&gt;&amp;)");
});

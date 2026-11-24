import { expect, test } from "bun:test";
import {
  formatStayDate,
  guestBookingCancelled,
  guestBookingConfirmed,
  guestOversoldRefunded,
  hostBookingCancelled,
  guestRefundIssued,
  hostNewBooking,
} from "./index";

const EVIL = "<b>&";
const rooms = [
  {
    name: "Deluxe <Room>",
    ratePlan: "Flexible",
    guests: "2 guests",
    refundable: true,
    freeCancellationUntil: "Fri 5 Mar 2027",
    nights: [
      { date: "2027-03-12", priceCents: 10_000 },
      { date: "2027-03-13", priceCents: 10_000 },
    ],
    touristTaxLines: [{ label: "€3.00 per person per night", amountCents: 1_200 }],
  },
  {
    name: "Garden Suite",
    ratePlan: "Non-refundable",
    guests: "1 guest",
    refundable: false,
    freeCancellationUntil: null,
    nights: [
      { date: "2027-03-12", priceCents: 4_950 },
      { date: "2027-03-13", priceCents: 5_050 },
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
  refundIssued: guestRefundIssued({ propertyName: EVIL, reason: "goodwill", refund: "€20.00", bookingUrl: "https://web.test/bookings/b1" }),
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

test("nights priced with cents show to the cent", () => {
  const priced = [{ ...rooms[0]!, nights: [{ date: "2027-03-12", priceCents: 9_325 }, { date: "2027-03-13", priceCents: 9_325 }] }];
  const { html } = guestBookingConfirmed({
    propertyName: "Hotel",
    ...stay,
    rooms: priced,
    money: { roomsCents: 18_650, touristTaxCents: 0, totalCents: 123_450 },
    seller: { legalName: null, vatNumber: null },
    reference: "AB12CD34",
    bookingUrl: "https://web.test/b",
  });
  expect(html).toContain("2 nights × €93.25");
  expect(html).toContain("€186.50");
  // Two decimals even on whole euros, and a thousands comma.
  expect(html).toContain("€1,234.50");
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
    rooms: [{ ...rooms[0]!, touristTaxLines: [{ label: EVIL, amountCents: 100 }] }],
    money,
    seller: { legalName: null, vatNumber: null },
    reference: "AB12CD34",
    bookingUrl: "https://web.test/b",
  });
  expect(evil.html).toContain("Tourist tax (&lt;b&gt;&amp;)");
});

test("a refundable room booked inside its window is not called non-refundable", () => {
  const late = guestBookingConfirmed({
    propertyName: "Hotel",
    ...stay,
    rooms: [{ ...rooms[0], freeCancellationUntil: null }],
    money,
    seller,
    reference: "AB12CD34",
    bookingUrl: "https://web.test/b",
  });
  expect(late.html).toContain("free cancellation period has passed");
  expect(late.html).not.toContain("non-refundable");
});

test("cots and extra beds show on the room and as what is left to pay at the hotel", () => {
  const withExtras = { ...money, payAtPropertyCents: 2500 };
  const extrasRooms = [{ ...rooms[0], guests: "2 guests, 1 infant", extras: "1 cot, 1 extra bed" }];
  const guest = guestBookingConfirmed({ propertyName: "Hotel", ...stay, rooms: extrasRooms, money: withExtras, seller, reference: "AB12CD34", bookingUrl: "https://web.test/b" });
  const host = hostNewBooking({ propertyName: "Hotel", guestName: "G", ...stay, rooms: extrasRooms, money: withExtras, commissionCents: 1350, reference: "AB12CD34", reservationsUrl: "https://biz.test/r" });
  for (const mail of [guest, host]) {
    expect(mail.html).toContain("2 guests, 1 infant, 1 cot, 1 extra bed");
    expect(mail.html).toContain("To pay at the hotel (cots and extra beds)");
    expect(mail.html).toContain("€25.00");
    // Below what was paid online, never added to it.
    expect(mail.html.indexOf("To pay at the hotel")).toBeGreaterThan(mail.html.indexOf("Total paid"));
    expect(mail.html).toContain("€312.00");
  }
  // The host still receives the online payment less commission: €312 − €13.50.
  expect(host.html).toContain("€298.50");
});

test("no pay-at-hotel row without cots or extra beds", () => {
  expect(mails.confirmed.html).not.toContain("To pay at the hotel");
  expect(mails.hostNew.html).not.toContain("To pay at the hotel");
});

test("a cancellation refund that went says it is on its way", () => {
  const sent = guestBookingCancelled({ propertyName: "Hotel", rooms: ["A"], refund: "€50.00", cancelsBooking: true, bookingUrl: "https://web.test/b" });
  expect(sent.html).toContain("Your refund of");
  expect(sent.html).toContain("is on its way");
  expect(sent.html).not.toContain("couldn't refund");
});

test("a cancellation refund Stripe refused is not promised", () => {
  const failed = guestBookingCancelled({ propertyName: "Hotel", rooms: ["A"], refund: null, refundFailed: "€50.00", cancelsBooking: true, bookingUrl: "https://web.test/b" });
  expect(failed.html).toContain("We couldn't refund");
  expect(failed.html).toContain("€50.00");
  expect(failed.html).not.toContain("on its way");
  expect(failed.html).not.toContain("No refund is due");
  // Part went, part did not: both are said.
  const mixed = guestBookingCancelled({ propertyName: "Hotel", rooms: ["A", "B"], refund: "€30.00", refundFailed: "€20.00", cancelsBooking: true, bookingUrl: "https://web.test/b" });
  expect(mixed.html).toContain("on its way");
  expect(mixed.html).toContain("We couldn't refund");
});

test("a refund outside a cancellation names why and how much", () => {
  const early = guestRefundIssued({ propertyName: "Hotel", reason: "early_departure", refund: "€120.00", bookingUrl: "https://web.test/b" });
  expect(early.subject).toBe("Refund on its way: Hotel");
  expect(early.html).toContain("left early");
  expect(early.html).toContain("€120.00");
  const refused = guestRefundIssued({ propertyName: "Hotel", reason: "goodwill", refund: null, refundFailed: "€20.00", bookingUrl: "https://web.test/b" });
  expect(refused.subject).toBe("About your refund: Hotel");
  expect(refused.html).toContain("We couldn't refund");
  expect(refused.html).not.toContain("on its way");
});

test("refund mails give the same timing as the booking page", () => {
  expect(mails.oversold.html).toContain("within 5 to 10 business days");
  expect(mails.refundIssued.html).toContain("within 5 to 10 business days");
  const cancelled = guestBookingCancelled({ propertyName: "Hotel", rooms: ["A"], refund: "€50.00", cancelsBooking: true, bookingUrl: "https://web.test/b" });
  expect(cancelled.html).toContain("within 5 to 10 business days");
});

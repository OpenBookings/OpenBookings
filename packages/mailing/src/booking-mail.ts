import { composeActionMail, type ActionMail } from "./action-mail";
import { formatEuro, formatStayDate } from "./format";
import { escapeHtml } from "./template";

/**
 * One booked room as the mail lists it. `guests` and the dates are plain text.
 * `nights` are what each night cost (euros, VAT included); `touristTaxLines`
 * are the charges the guest was shown at booking.
 */
export type MailRoom = {
  name: string;
  ratePlan: string;
  guests: string;
  freeCancellationUntil: string | null;
  nights: { date: string; price: number }[];
  touristTaxLines: { label: string; amount: number }[];
};

/** What the guest paid, in cents, as the booking stores it. */
export type MailMoney = { roomsCents: number; touristTaxCents: number; totalCents: number };

/** The host's legal details, when they filled them in. The hotel is the seller of the stay. */
export type MailSeller = { legalName: string | null; vatNumber: string | null };

const STRONG = (text: string) => `<strong style="color:#DDDDDD;">${escapeHtml(text)}</strong>`;
const FOOTNOTE = 'Questions? Email <a href="mailto:support@openbookings.co" style="color:#AAAAAA;text-decoration:underline;">support@openbookings.co</a>.';

const cents = (euros: number) => Math.round(euros * 100);
const euro = (amountCents: number) => formatEuro(amountCents / 100);

const roomNames = (rooms: string[]) => rooms.map(STRONG).join(", ");

const stay = (checkIn: string, checkOut: string) => `${escapeHtml(formatStayDate(checkIn))} to ${escapeHtml(formatStayDate(checkOut))}`;

// ─── The breakdown table ───────────────────────────────────────────────

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif";
const CELL = `font-family:${FONT};font-size:14px;line-height:1.5;color:#AAAAAA;padding:3px 0;text-align:left;vertical-align:top;`;
const AMOUNT = `font-family:${FONT};font-size:14px;line-height:1.5;color:#AAAAAA;padding:3px 0 3px 16px;text-align:right;vertical-align:top;white-space:nowrap;`;
const RULE = "border-top:1px solid rgba(255,255,255,0.08);";

/** Everything passed in is already HTML: callers escape what came from people. */
type Row = { label: string; amount?: string; kind?: "room" | "note" | "first-total" | "total" | "grand" };

function row(r: Row): string {
  const label =
    r.kind === "room" ? `color:#DDDDDD;font-weight:600;padding-top:14px;`
    : r.kind === "note" ? `font-size:13px;color:#777777;`
    : r.kind === "first-total" ? `padding-top:12px;${RULE}`
    : r.kind === "grand" ? `color:#F0F0F0;font-weight:600;`
    : "";
  const amount = r.kind === "first-total" ? `padding-top:12px;${RULE}` : r.kind === "grand" ? "color:#F0F0F0;font-weight:600;" : "";
  if (r.amount === undefined) return `<tr><td colspan="2" style="${CELL}${label}">${r.label}</td></tr>`;
  return `<tr><td style="${CELL}${label}">${r.label}</td><td style="${AMOUNT}${amount}">${r.amount}</td></tr>`;
}

function table(rows: Row[]): string {
  return `<table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="margin:0 0 32px;background-color:#111111;border:1px solid rgba(255,255,255,0.06);border-radius:6px;"><tr><td style="padding:6px 18px 16px;"><table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation">${rows.map(row).join("")}</table></td></tr></table>`;
}

/**
 * Consecutive nights at the same price, as one line each: "Fri 12 Mar 2027 ·
 * 2 nights × €100.00". A discount spread over the stay can give every night
 * its own price, and then every night gets its own line.
 */
export function nightRuns(nights: { date: string; price: number }[]): { label: string; amountCents: number }[] {
  const runs: { from: string; count: number; priceCents: number }[] = [];
  for (const n of nights) {
    const last = runs[runs.length - 1];
    if (last && last.priceCents === cents(n.price)) last.count += 1;
    else runs.push({ from: n.date, count: 1, priceCents: cents(n.price) });
  }
  return runs.map((r) => ({
    label: `${formatStayDate(r.from)} · ${r.count === 1 ? "1 night" : `${r.count} nights × ${euro(r.priceCents)}`}`,
    amountCents: r.count * r.priceCents,
  }));
}

function roomRows(rooms: MailRoom[]): Row[] {
  return rooms.flatMap((r) => {
    const cancel = r.freeCancellationUntil ? `free cancellation until ${r.freeCancellationUntil}` : "non-refundable";
    return [
      { label: escapeHtml(r.name), kind: "room" as const },
      { label: escapeHtml(`${r.ratePlan}, ${r.guests}, ${cancel}`), kind: "note" as const },
      ...nightRuns(r.nights).map((n) => ({ label: escapeHtml(n.label), amount: euro(n.amountCents) })),
      ...r.touristTaxLines
        .filter((t) => t.amount > 0)
        .map((t) => ({ label: escapeHtml(`Tourist tax (${t.label})`), amount: euro(cents(t.amount)) })),
    ];
  });
}

function totalRows(m: MailMoney): Row[] {
  const rows: Row[] = [{ label: "Rooms, incl. VAT", amount: euro(m.roomsCents), kind: "first-total" }];
  if (m.touristTaxCents > 0) rows.push({ label: "Tourist tax", amount: euro(m.touristTaxCents) });
  rows.push({ label: "Total paid", amount: euro(m.totalCents), kind: "grand" });
  return rows;
}

function sellerLine(s: MailSeller): string {
  const parts = [s.legalName && `Provided by ${STRONG(s.legalName)}`, s.vatNumber && `VAT number ${escapeHtml(s.vatNumber)}`].filter(Boolean);
  return parts.length ? `<br /><br />${parts.join(", ")}.` : "";
}

// ─── The mails ─────────────────────────────────────────────────────────

export function guestBookingConfirmed(i: {
  propertyName: string;
  checkIn: string;
  checkOut: string;
  rooms: MailRoom[];
  money: MailMoney;
  seller: MailSeller;
  /** The short booking reference the guest's booking page shows. */
  reference: string;
  bookingUrl: string;
}): ActionMail {
  return composeActionMail({
    subject: `Booking confirmed: ${i.propertyName}`,
    preheader: `Your stay at ${i.propertyName} is confirmed.`,
    eyebrow: "Booking",
    headline: "Your booking<br />is confirmed.",
    body: `${STRONG(i.propertyName)}, ${stay(i.checkIn, i.checkOut)}.<br />Booking reference ${STRONG(i.reference)}${sellerLine(i.seller)}`,
    details: table([...roomRows(i.rooms), ...totalRows(i.money)]),
    ctaUrl: i.bookingUrl,
    ctaLabel: "View your booking",
    footnote: `Prices include VAT.${i.money.touristTaxCents > 0 ? " Tourist tax is collected for the local council." : ""} ${FOOTNOTE}`,
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
  money: MailMoney;
  /** OpenBookings' application fee on this booking; 0 while it is switched off. */
  commissionCents: number;
  reference: string;
  reservationsUrl: string;
}): ActionMail {
  const payout: Row[] = [
    ...(i.commissionCents > 0 ? [{ label: "OpenBookings commission", amount: `−${euro(i.commissionCents)}` }] : []),
    { label: "You receive", amount: euro(i.money.totalCents - i.commissionCents), kind: "grand" },
  ];
  return composeActionMail({
    subject: `New booking at ${i.propertyName}`,
    preheader: `${i.guestName} booked ${i.propertyName}.`,
    eyebrow: "Reservations",
    headline: "You have a<br />new booking.",
    body: `${STRONG(i.guestName)} booked ${STRONG(i.propertyName)}, ${stay(i.checkIn, i.checkOut)}.<br />Booking reference ${STRONG(i.reference)}`,
    details: table([...roomRows(i.rooms), ...totalRows(i.money), ...payout]),
    ctaUrl: i.reservationsUrl,
    ctaLabel: "Open reservations",
    footnote: `What you receive is before Stripe's processing fees. ${FOOTNOTE}`,
  });
}

/** `refund` is null when nothing is due back. `cancelsBooking`: every room is now cancelled. */
export function guestBookingCancelled(i: {
  propertyName: string;
  rooms: string[];
  refund: string | null;
  cancelsBooking: boolean;
  bookingUrl: string;
}): ActionMail {
  const refund = i.refund
    ? `Refund: ${STRONG(i.refund)}. It can take a few days to show on your statement.`
    : "No refund is due under your cancellation terms.";
  return composeActionMail({
    subject: i.cancelsBooking ? `Booking cancelled: ${i.propertyName}` : `Rooms cancelled: ${i.propertyName}`,
    preheader: i.cancelsBooking ? `Your booking at ${i.propertyName} was cancelled.` : `Part of your booking at ${i.propertyName} was cancelled.`,
    eyebrow: "Booking",
    headline: i.cancelsBooking ? "Your booking<br />was cancelled." : "Some rooms<br />were cancelled.",
    body: `Cancelled at ${STRONG(i.propertyName)}: ${roomNames(i.rooms)}.${i.cancelsBooking ? "" : " The rest of your booking stands."}<br /><br />${refund}`,
    ctaUrl: i.bookingUrl,
    ctaLabel: "View your booking",
    footnote: FOOTNOTE,
  });
}

export function hostBookingCancelled(i: {
  propertyName: string;
  guestName: string;
  rooms: string[];
  cancelsBooking: boolean;
  reservationsUrl: string;
}): ActionMail {
  return composeActionMail({
    subject: i.cancelsBooking ? `Booking cancelled at ${i.propertyName}` : `Rooms cancelled at ${i.propertyName}`,
    preheader: `${i.cancelsBooking ? "A booking" : "Part of a booking"} at ${i.propertyName} was cancelled.`,
    eyebrow: "Reservations",
    headline: i.cancelsBooking ? "A booking<br />was cancelled." : "Some rooms<br />were cancelled.",
    body: `${i.cancelsBooking ? "The booking" : "Part of the booking"} by ${STRONG(i.guestName)} at ${STRONG(i.propertyName)} was cancelled: ${roomNames(i.rooms)}. The cancelled rooms are available again.`,
    ctaUrl: i.reservationsUrl,
    ctaLabel: "Open reservations",
    footnote: FOOTNOTE,
  });
}

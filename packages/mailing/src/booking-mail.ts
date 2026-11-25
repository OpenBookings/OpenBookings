import { REFUND_TIMING_LINE } from "@openbookings/pricing";
import { composeActionMail, type ActionMail } from "./action-mail";
import { formatStayDate, mailCents } from "./format";
import { escapeHtml } from "./template";

/**
 * One booked room as the mail lists it. `guests` and the dates are plain text.
 * `nights` are what each night cost (cents, VAT included); `touristTaxLines`
 * are the charges the guest was shown at booking, in cents.
 */
export type MailRoom = {
  name: string;
  ratePlan: string;
  guests: string;
  /** "1 cot, 1 extra bed", paid at the hotel; null when the room has neither. */
  extras?: string | null;
  /** False for a non-refundable rate. */
  refundable: boolean;
  /** Null once the free-cancellation deadline has passed (or for a non-refundable rate). */
  freeCancellationUntil: string | null;
  nights: { date: string; priceCents: number }[];
  touristTaxLines: { label: string; amountCents: number }[];
};

/**
 * What the guest paid, in cents, as the booking stores it. `payAtPropertyCents`
 * is what they still owe the hotel for cots and extra beds: priced at
 * booking, paid at the hotel, never part of `totalCents`.
 */
export type MailMoney = { roomsCents: number; touristTaxCents: number; totalCents: number; payAtPropertyCents?: number };

const PAY_AT_PROPERTY_LABEL = "To pay at the hotel (cots and extra beds)";

/** The host's legal details, when they filled them in. The hotel is the seller of the stay. */
export type MailSeller = { legalName: string | null; vatNumber: string | null };

const STRONG = (text: string) => `<strong style="color:#DDDDDD;">${escapeHtml(text)}</strong>`;
const FOOTNOTE = 'Questions? Email <a href="mailto:support@openbookings.co" style="color:#AAAAAA;text-decoration:underline;">support@openbookings.co</a>.';

const euro = mailCents;

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
export function nightRuns(nights: { date: string; priceCents: number }[]): { label: string; amountCents: number }[] {
  const runs: { from: string; count: number; priceCents: number }[] = [];
  for (const n of nights) {
    const last = runs[runs.length - 1];
    if (last && last.priceCents === n.priceCents) last.count += 1;
    else runs.push({ from: n.date, count: 1, priceCents: n.priceCents });
  }
  return runs.map((r) => ({
    label: `${formatStayDate(r.from)} · ${r.count === 1 ? "1 night" : `${r.count} nights × ${euro(r.priceCents)}`}`,
    amountCents: r.count * r.priceCents,
  }));
}

function roomRows(rooms: MailRoom[]): Row[] {
  return rooms.flatMap((r) => {
    const cancel = !r.refundable
      ? "non-refundable"
      : r.freeCancellationUntil
        ? `free cancellation until ${r.freeCancellationUntil}`
        : "free cancellation period has passed";
    return [
      { label: escapeHtml(r.name), kind: "room" as const },
      { label: escapeHtml([r.ratePlan, r.guests, r.extras, cancel].filter(Boolean).join(", ")), kind: "note" as const },
      ...nightRuns(r.nights).map((n) => ({ label: escapeHtml(n.label), amount: euro(n.amountCents) })),
      ...r.touristTaxLines
        .filter((t) => t.amountCents > 0)
        .map((t) => ({ label: escapeHtml(`Tourist tax (${t.label})`), amount: euro(t.amountCents) })),
    ];
  });
}

function totalRows(m: MailMoney): Row[] {
  const rows: Row[] = [{ label: "Rooms, incl. VAT", amount: euro(m.roomsCents), kind: "first-total" }];
  if (m.touristTaxCents > 0) rows.push({ label: "Tourist tax", amount: euro(m.touristTaxCents) });
  rows.push({ label: "Total paid", amount: euro(m.totalCents), kind: "grand" });
  if ((m.payAtPropertyCents ?? 0) > 0) rows.push({ label: PAY_AT_PROPERTY_LABEL, amount: euro(m.payAtPropertyCents ?? 0) });
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
    footnote: `Prices include VAT.${i.money.touristTaxCents > 0 ? " Tourist tax is collected for the local council." : ""}${
      (i.money.payAtPropertyCents ?? 0) > 0 ? " Cots and extra beds are paid at the hotel, not online." : ""
    } ${FOOTNOTE}`,
  });
}

export function guestOversoldRefunded(i: { propertyName: string; amount: string; searchUrl: string }): ActionMail {
  return composeActionMail({
    subject: `Your booking at ${i.propertyName} could not be completed`,
    preheader: "The rooms were taken just before your payment arrived. You were refunded in full.",
    eyebrow: "Booking",
    headline: "Sorry, the rooms<br />were just taken.",
    body: `Someone else booked the rooms at ${STRONG(i.propertyName)} just before your payment arrived, so we could not confirm your stay. We refunded ${STRONG(i.amount)} in full. ${escapeHtml(REFUND_TIMING_LINE)}`,
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
    footnote: `What you receive is before Stripe's processing fees.${
      (i.money.payAtPropertyCents ?? 0) > 0 ? " Cots and extra beds are not in it: the guest pays those at the hotel." : ""
    } ${FOOTNOTE}`,
  });
}

/**
 * What happened to the money, as Stripe answered: `sent` went (or is on its
 * way), `failed` was refused and is still owed. Null for none of either.
 */
type RefundOutcome = { sent: string | null; failed?: string | null };

function refundSentences(r: RefundOutcome): string | null {
  const parts = [
    r.sent && `Your refund of ${STRONG(r.sent)} is on its way. ${escapeHtml(REFUND_TIMING_LINE)}`,
    r.failed && `We couldn't refund ${STRONG(r.failed)} yet; we're on it, and you don't need to do anything.`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/**
 * `refund` is what went back (null when nothing did), `refundFailed` what
 * Stripe refused and is still owed. `cancelsBooking`: every room is now cancelled.
 */
export function guestBookingCancelled(i: {
  propertyName: string;
  rooms: string[];
  refund: string | null;
  refundFailed?: string | null;
  cancelsBooking: boolean;
  bookingUrl: string;
}): ActionMail {
  const refund =
    refundSentences({ sent: i.refund, failed: i.refundFailed }) ?? "No refund is due under your cancellation terms.";
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

/** Why a refund was made outside a cancellation. */
export type RefundIssuedReason = "early_departure" | "goodwill" | "retry";

const REFUND_INTRO: Record<RefundIssuedReason, (property: string) => string> = {
  early_departure: (p) => `${p} recorded that you left early, so you get back what your booking's terms allow for the nights you didn't stay.`,
  goodwill: (p) => `${p} gave you a goodwill refund on your booking.`,
  retry: (p) => `We've sent the refund we owed you for your booking at ${p}.`,
};

/**
 * A refund made outside a cancellation: an early departure, a goodwill
 * refund from the hotel, or a refund that failed before and went through now.
 * `refund` is what went (or is on its way), `refundFailed` what Stripe refused.
 */
export function guestRefundIssued(i: {
  propertyName: string;
  reason: RefundIssuedReason;
  refund: string | null;
  refundFailed?: string | null;
  bookingUrl: string;
}): ActionMail {
  const amount = i.refund ?? i.refundFailed ?? "";
  return composeActionMail({
    subject: i.refund ? `Refund on its way: ${i.propertyName}` : `About your refund: ${i.propertyName}`,
    preheader: i.refund ? `${amount} is on its way back to you.` : `We couldn't refund ${amount} yet.`,
    eyebrow: "Booking",
    headline: i.refund ? "Your refund<br />is on its way." : "Your refund<br />is delayed.",
    body: `${REFUND_INTRO[i.reason](STRONG(i.propertyName))}<br /><br />${refundSentences({ sent: i.refund, failed: i.refundFailed }) ?? ""}`,
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

const DETAIL_MAX = 200;

/** What did not reach the channel manager (DeliveryFailureKind in @openbookings/db/apps). */
export type ChannelFailureKind = "new" | "cancelled" | "changed" | "reopened";

/** Subject, headline and instruction per failure, each naming what the hotel has to do by hand. */
function channelFailureCopy(kind: ChannelFailureKind, i: { reference: string; propertyName: string; appName: string; stay: string }) {
  const app = escapeHtml(i.appName);
  const booking = `Booking ${STRONG(i.reference)} at ${STRONG(i.propertyName)} for ${i.stay}`;
  switch (kind) {
    case "cancelled":
      return {
        subject: `Cancellation of booking ${i.reference} didn't reach ${i.appName}`,
        preheader: `Booking ${i.reference} at ${i.propertyName} is cancelled, but your channel manager may still hold it.`,
        headline: `A cancellation didn't<br />reach ${app}.`,
        body: `${booking} is cancelled, but the cancellation didn't reach ${app}, so your channel manager or PMS may still hold the room. Cancel it there by hand, or check the connection with ${app}.`,
      };
    case "changed":
      return {
        subject: `Change to booking ${i.reference} didn't reach ${i.appName}`,
        preheader: `The latest change to booking ${i.reference} at ${i.propertyName} is not in your channel manager yet.`,
        headline: `A booking change didn't<br />reach ${app}.`,
        body: `${booking} changed, but the latest change didn't reach ${app}. Update it in your channel manager or PMS by hand, or check the connection with ${app}.`,
      };
    case "reopened":
      return {
        subject: `Reopened booking ${i.reference} isn't in ${i.appName}`,
        preheader: `Booking ${i.reference} at ${i.propertyName} was reopened after ${i.appName} received its cancellation.`,
        headline: `A reopened booking<br />isn't in ${app}.`,
        body: `${booking} was reopened after ${app} received its cancellation, and ${app} can't take a cancellation back. Add it again in your channel manager or PMS by hand.`,
      };
    default:
      return {
        subject: `Booking ${i.reference} didn't reach ${i.appName}`,
        preheader: `Booking ${i.reference} at ${i.propertyName} is not in your channel manager yet.`,
        headline: `A booking didn't<br />reach ${app}.`,
        body: `${booking} is confirmed and paid, but it isn't in your channel manager or PMS yet. Add it there by hand, or check the connection with ${app}.`,
      };
  }
}

/**
 * A booking (or its latest change, cancellation or reopening) never reached
 * the hotel's channel manager. `detail` is the app's own words for why:
 * untrusted text, shortened and escaped, and never part of the subject.
 */
export function hostChannelDeliveryFailed(i: {
  propertyName: string;
  reference: string;
  appName: string;
  checkIn: string;
  checkOut: string;
  bookingUrl: string;
  detail?: string | null;
  /** What did not get there; "new" when not given. */
  failure?: ChannelFailureKind;
}): ActionMail {
  const detail = i.detail?.trim().slice(0, DETAIL_MAX);
  const copy = channelFailureCopy(i.failure ?? "new", { ...i, stay: stay(i.checkIn, i.checkOut) });
  return composeActionMail({
    subject: copy.subject,
    preheader: copy.preheader,
    eyebrow: "Reservations",
    headline: copy.headline,
    body: `${copy.body}${detail ? `<br /><br />${escapeHtml(i.appName)} said: ${escapeHtml(detail)}` : ""}`,
    ctaUrl: i.bookingUrl,
    ctaLabel: "Open reservations",
    footnote: FOOTNOTE,
  });
}

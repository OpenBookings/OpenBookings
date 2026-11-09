import { composeActionMail, type ActionMail } from "./action-mail";
import { formatStayDate } from "./format";
import { escapeHtml } from "./template";

/**
 * Review emails (roadmap 6.3): the wording only. Loading and sending is in
 * ./review-send. Guest-facing mails never show more than the property name
 * and the month of the stay.
 */

const STRONG = (text: string) => `<strong style="color:#DDDDDD;">${escapeHtml(text)}</strong>`;
const LINK = (url: string, text: string) =>
  `<a href="${escapeHtml(url)}" style="color:#AAAAAA;text-decoration:underline;">${escapeHtml(text)}</a>`;
const SUPPORT = 'Questions? Email <a href="mailto:support@openbookings.co" style="color:#AAAAAA;text-decoration:underline;">support@openbookings.co</a>.';

const month = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** "November 2031" from a YYYY-MM-DD date. */
export function formatStayMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return month.format(new Date(Date.UTC(y!, m! - 1, 1)));
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** The footnote of every invitation and reminder: why they got it, how to stop it. */
function guestFootnote(optOutUrl: string): string {
  return [
    "You're getting this because you stayed here through OpenBookings. Only guests who completed a stay can review it.",
    `${LINK(optOutUrl, "Don't send me review requests")}. ${SUPPORT}`,
  ].join("<br /><br />");
}

export type ReviewInvitationInput = {
  guestFirstName: string;
  propertyName: string;
  /** `YYYY-MM-DD` */
  checkOutDate: string;
  reviewUrl: string;
  optOutUrl: string;
  closesAt: Date;
};

export function guestReviewInvitation(i: ReviewInvitationInput): ActionMail {
  return composeActionMail({
    subject: `How was your stay at ${i.propertyName}?`,
    preheader: "One score from 1 to 10 is enough. A few words help other guests even more.",
    eyebrow: "Review",
    headline: `How was your stay,<br />${escapeHtml(i.guestFirstName)}?`,
    body: `You stayed at ${STRONG(i.propertyName)} in ${escapeHtml(formatStayMonth(i.checkOutDate))}. Tell the next guests what it was like: a score from 1 to 10 is enough, a few words help even more. Your review is shown with your first name and country, never your dates.`,
    ctaUrl: i.reviewUrl,
    ctaLabel: "Write a review",
    footnote: `The link works until ${escapeHtml(day.format(i.closesAt))} and only for this stay.<br /><br />${guestFootnote(i.optOutUrl)}`,
  });
}

export function guestReviewReminder(i: ReviewInvitationInput): ActionMail {
  return composeActionMail({
    subject: `Still a moment for ${i.propertyName}?`,
    preheader: "Your review helps the next guests choose. This is the only reminder.",
    eyebrow: "Review",
    headline: "A minute for<br />the next guests?",
    body: `There's still time to review your stay at ${STRONG(i.propertyName)} in ${escapeHtml(formatStayMonth(i.checkOutDate))}. A score is enough. This is the only reminder we send.`,
    ctaUrl: i.reviewUrl,
    ctaLabel: "Write a review",
    footnote: `The link works until ${escapeHtml(day.format(i.closesAt))}.<br /><br />${guestFootnote(i.optOutUrl)}`,
  });
}

/**
 * Sent to the account's own address after a review is posted, so a review
 * written through a forwarded email gets noticed by the real guest.
 */
export function guestReviewPosted(i: { propertyName: string; pending: boolean; manageUrl: string }): ActionMail {
  return composeActionMail({
    subject: `Your review of ${i.propertyName}`,
    preheader: i.pending ? "We'll check it before it's shown." : "Thanks for helping the next guests.",
    eyebrow: "Review",
    headline: i.pending ? "Thanks. We'll<br />take a look first." : "Thanks for<br />your review.",
    body: i.pending
      ? `Your review of ${STRONG(i.propertyName)} contains something our checks hold back, such as a link or contact details. A person looks at it before it's shown.`
      : `Your review of ${STRONG(i.propertyName)} is posted. You can see it, and delete it, in your account.`,
    ctaUrl: i.manageUrl,
    ctaLabel: "See your review",
    footnote: `Didn't write this? Sign in and delete it, then let us know. ${SUPPORT}`,
  });
}

export type UnconfirmedStay = { guestName: string; checkInDate: string; checkOutDate: string };

/**
 * Check-out day, for stays never marked as arrived: the host's last chance to
 * mark a no-show before the guest is invited to review.
 */
export function hostUnconfirmedStays(i: {
  propertyName: string;
  stays: UnconfirmedStay[];
  /** "Tue 13 Nov, 11:00" on the property's clock. */
  invitesAt: string;
  reservationsUrl: string;
}): ActionMail {
  const n = i.stays.length;
  const list = i.stays
    .map(
      (s) =>
        `${STRONG(s.guestName)} · ${escapeHtml(formatStayDate(s.checkInDate))} to ${escapeHtml(formatStayDate(s.checkOutDate))}`,
    )
    .join("<br />");
  return composeActionMail({
    subject: `${n === 1 ? "1 stay" : `${n} stays`} at ${i.propertyName} not marked as arrived`,
    preheader: "Review invitations go out tomorrow. Mark any no-shows before then.",
    eyebrow: "Reviews",
    headline: "Did these<br />guests arrive?",
    body: `${n === 1 ? "This stay was" : "These stays were"} never marked as arrived. If a guest didn't show up, mark the booking as a no-show before ${STRONG(i.invitesAt)}. After that, every guest here is invited to review their stay, and only OpenBookings support can change it.`,
    details: `<p style="margin:0;font-size:14px;line-height:1.6;color:#AAAAAA;">${list}</p>`,
    ctaUrl: i.reservationsUrl,
    ctaLabel: "Open reservations",
    footnote: `Guests who did stay need nothing from you. ${SUPPORT}`,
  });
}

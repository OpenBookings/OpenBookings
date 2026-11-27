import { MASKED_TEXT, MODERATION_DEADLINE_HOURS, REVIEW_RULES, type ReviewRuleId } from "@openbookings/pricing";
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
    preheader: i.pending ? "A person looks at it first." : "Thanks for helping the next guests.",
    eyebrow: "Review",
    headline: i.pending ? "Thanks. We'll<br />take a look first." : "Thanks for<br />your review.",
    body: i.pending
      ? `Our automatic check held back your review of ${STRONG(i.propertyName)}: it may break our review rules, or the check couldn't run. A person looks at it. If nobody has decided within ${MODERATION_DEADLINE_HOURS} hours, it's shown with the parts that may break a rule replaced by "${MASKED_TEXT}".`
      : `Your review of ${STRONG(i.propertyName)} is posted. You can see it, and delete it, in your account.`,
    ctaUrl: i.manageUrl,
    ctaLabel: "See your review",
    footnote: `Didn't write this? Sign in and delete it, then let us know. ${SUPPORT}`,
  });
}

/**
 * To the guest, once, when the property publishes a public reply to their
 * review. The reply is public already, so the mail quotes it in full.
 */
export function guestReviewReplied(i: {
  guestFirstName: string;
  propertyName: string;
  replyBody: string;
  manageUrl: string;
  settingsUrl: string;
}): ActionMail {
  return composeActionMail({
    subject: `${i.propertyName} replied to your review`,
    preheader: "Read their reply, and answer it if you like.",
    eyebrow: "Review",
    headline: `${escapeHtml(i.propertyName)} replied<br />to your review.`,
    body: `Hi ${escapeHtml(i.guestFirstName)}, ${STRONG(i.propertyName)} answered the review you wrote. Their reply is public, under your review on their page:`,
    details: `<p style="margin:0;border-left:2px solid #444444;padding-left:12px;font-size:14px;line-height:1.6;color:#CCCCCC;white-space:pre-line;">${escapeHtml(i.replyBody)}</p>`,
    ctaUrl: i.manageUrl,
    ctaLabel: "See the reply",
    footnote: `You can answer once, under your review. Your answer is public too.<br /><br />${LINK(i.settingsUrl, "Turn off review emails")}. ${SUPPORT}`,
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

// ── Moderation (statement of reasons and report outcomes) ────────────────────

const NOUN = { review: "review", reply: "reply" } as const;
type ItemKind = keyof typeof NOUN;

/** What the decision mails say about who decided and how to object. */
const DECIDED = "A person at OpenBookings decided this.";
const OBJECT = "If you disagree, reply to this email and tell us why.";

/**
 * To the author of a review or reply a moderator removed: the statement of
 * reasons. Names the content (a short excerpt, never the whole text), each
 * rule broken, the moderator's note, says a person decided and how to object.
 * It mentions writing a review once more only when `canRewrite`.
 */
export function moderationRemoved(i: {
  itemKind: ItemKind;
  propertyName: string;
  /** A short single-line excerpt of the removed text; empty when none is left. */
  excerpt: string;
  rules: ReviewRuleId[];
  note: string | null;
  canRewrite: boolean;
  manageUrl: string;
}): ActionMail {
  const noun = NOUN[i.itemKind];
  const rules = i.rules
    .map((id) => `<li style="margin:0 0 6px;">${STRONG(REVIEW_RULES[id].title)}<br />${escapeHtml(REVIEW_RULES[id].description)}</li>`)
    .join("");
  const details = [
    i.excerpt ? `<p style="margin:0 0 12px;border-left:2px solid #444444;padding-left:12px;font-size:14px;line-height:1.6;color:#CCCCCC;">${escapeHtml(i.excerpt)}</p>` : "",
    `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#AAAAAA;">It broke ${i.rules.length === 1 ? "this rule" : "these rules"}:</p>`,
    `<ul style="margin:0 0 12px;padding-left:18px;font-size:14px;line-height:1.6;color:#AAAAAA;">${rules}</ul>`,
    i.note ? `<p style="margin:0;font-size:14px;line-height:1.6;color:#AAAAAA;">${STRONG("Note from the moderator")}<br />${escapeHtml(i.note)}</p>` : "",
  ].join("");
  return composeActionMail({
    subject: `Your ${noun} of ${i.propertyName} was removed`,
    preheader: "Why it was removed, and what you can do.",
    eyebrow: "Review",
    headline: `Your ${noun} was<br />removed.`,
    body: `We removed your ${noun} of ${STRONG(i.propertyName)}.${i.canRewrite ? " You can write your review once more, as long as it follows the rules." : ""} ${DECIDED}`,
    details,
    ctaUrl: i.manageUrl,
    ctaLabel: i.itemKind === "review" ? "See your review" : "Open reviews",
    footnote: `${OBJECT} ${SUPPORT}`,
  });
}

/** To the author of an item that was reported and then kept: a person looked, and it stays. */
export function moderationKept(i: { itemKind: ItemKind; propertyName: string; manageUrl: string }): ActionMail {
  const noun = NOUN[i.itemKind];
  return composeActionMail({
    subject: `Your ${noun} of ${i.propertyName} stays`,
    preheader: "Someone reported it. A person checked and it stays.",
    eyebrow: "Review",
    headline: `Your ${noun}<br />stays.`,
    body: `Your ${noun} of ${STRONG(i.propertyName)} was looked at by a person and it follows the review rules. Nothing changes: it stays as you wrote it.`,
    ctaUrl: i.manageUrl,
    ctaLabel: i.itemKind === "review" ? "See your review" : "Open reviews",
    footnote: `You're getting this because the ${noun} was checked. ${SUPPORT}`,
  });
}

/** To whoever reported a review or reply: what the person who decided did. */
export function reportOutcome(i: { upheld: boolean; propertyName: string; itemKind?: ItemKind }): ActionMail {
  const noun = NOUN[i.itemKind ?? "review"];
  return composeActionMail({
    subject: `Your report about ${i.propertyName}`,
    preheader: i.upheld ? "We removed it." : "We looked, and it stays.",
    eyebrow: "Review",
    headline: i.upheld ? "We removed<br />what you reported." : "We looked at<br />your report.",
    body: i.upheld
      ? `Thanks for your report about a ${noun} at ${STRONG(i.propertyName)}. A person looked at it and removed it because it broke our review rules.`
      : `Thanks for your report about a ${noun} at ${STRONG(i.propertyName)}. A person looked at it and decided it follows our review rules, so it stays.`,
    ctaUrl: "mailto:support@openbookings.co",
    ctaLabel: "Reply to us",
    footnote: `If you disagree, reply to this email and tell us why. ${SUPPORT}`,
  });
}

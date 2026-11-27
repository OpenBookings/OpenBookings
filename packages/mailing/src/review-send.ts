import { getPool } from "@openbookings/db";
import { deadlineMaySql, type ModerationItem, type ReviewMail } from "@openbookings/db/reviews";
import { hostRecipients, isTestingMode } from "@openbookings/demo";
import { bookingMailUrls, type BookingMailUrls } from "./booking-send";
import { getEmailClient } from "./client";
import { sender, type SenderRole } from "./senders";
import { trackMail } from "./tracking";
import { guestReviewInvitation, guestReviewPosted, guestReviewReminder, guestReviewReplied, hostUnconfirmedStays, moderationMaskedNotice, moderationRemovedNotice, reportOutcome } from "./review-mail";

/**
 * Sends the review emails: what the invitation job hands over, and the
 * "review posted" confirmation. Wording is in ./review-mail.
 */

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
type Transport = (m: { from: string; to: string; subject: string; html: string }) => Promise<void>;

export type ReviewSendDeps = { db?: Db; transport?: Transport; testing?: boolean; urls?: BookingMailUrls; track?: typeof trackMail; now?: () => Date };

const resolve = (d: ReviewSendDeps) => ({
  db: d.db ?? getPool(),
  transport:
    d.transport ??
    ((m: { from: string; to: string; subject: string; html: string }) =>
      getEmailClient().from(m.from).to(m.to).subject(m.subject).html(m.html).send().then(() => undefined)),
  testing: d.testing ?? isTestingMode(),
  urls: d.urls ?? bookingMailUrls(),
  track: d.track ?? trackMail,
  now: d.now ?? (() => new Date()),
});

const trim = (url: string) => url.replace(/\/$/, "");

/** The emailed review link, and the page that turns review emails off. */
export const reviewLinkUrl = (webUrl: string, token: string) => `${trim(webUrl)}/review/${token}`;
export const reviewOptOutUrl = (webUrl: string, token: string) => `${trim(webUrl)}/review/${token}/stop`;
/** Where a signed-in guest sees, writes or deletes the review of one booking. */
export const reviewManageUrl = (webUrl: string, bookingId: string) => `${trim(webUrl)}/bookings/${bookingId}/review`;

/** "Tue 13 Nov, 11:00" on the property's clock. */
function localMoment(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** Delivers one mail from the invitation job. Throws when it didn't go out, so the job retries. */
export async function sendReviewMail(mail: ReviewMail, deps: ReviewSendDeps = {}): Promise<void> {
  const c = resolve(deps);
  if (mail.kind === "host_warning") {
    const to = await hostRecipients(c.db, { propertyId: mail.propertyId, guestEmail: mail.stays[0]?.guestEmail ?? "", testing: c.testing });
    if (to.length === 0) return; // No owner on file: nobody to warn, and nothing to retry.
    const first = [...mail.stays].sort((a, b) => a.invitesAt.getTime() - b.invitesAt.getTime())[0]!;
    const message = hostUnconfirmedStays({
      propertyName: mail.propertyName,
      stays: mail.stays,
      invitesAt: localMoment(first.invitesAt, mail.timeZone),
      reservationsUrl: `${trim(c.urls.businessUrl)}/dashboard/bookings/reservations`,
    });
    const results = await Promise.allSettled(
      to.map(async (address) => {
        const t = await c.track({ kind: "stays_unconfirmed_host", to: address, html: message.html });
        await c.transport({ from: sender("bookings"), to: address, subject: message.subject, html: t.html });
        await t.onSent();
      }),
    );
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    return;
  }
  const input = {
    guestFirstName: mail.guestFirstName,
    propertyName: mail.propertyName,
    checkOutDate: mail.checkOutDate,
    reviewUrl: reviewLinkUrl(c.urls.webUrl, mail.token),
    optOutUrl: reviewOptOutUrl(c.urls.webUrl, mail.token),
    closesAt: mail.closesAt,
  };
  const message = mail.kind === "invitation" ? guestReviewInvitation(input) : guestReviewReminder(input);
  const t = await c.track({ kind: mail.kind === "invitation" ? "review_invitation" : "review_reminder", to: mail.to, html: message.html });
  await c.transport({ from: sender("roy"), to: mail.to, subject: message.subject, html: t.html });
  await t.onSent();
}

/**
 * Tells the account's own address that a review was posted for this booking.
 * Never throws: the review is already stored; `report` hears about failures.
 */
export async function sendReviewPosted(
  bookingId: string,
  i: { pending: boolean; report?: (error: unknown) => void },
  deps: ReviewSendDeps = {},
): Promise<void> {
  try {
    const c = resolve(deps);
    const row = (
      await c.db.query(
        `SELECT u.email, p.name AS property_name, ${deadlineMaySql("rv")} AS deadline_may
           FROM bookings b JOIN "user" u ON u.id = b.user_id JOIN properties p ON p.id = b.hotel_id
           LEFT JOIN reviews rv ON rv.booking_id = b.id
          WHERE b.id = $1::uuid`,
        [bookingId],
      )
    ).rows[0] as { email: string | null; property_name: string; deadline_may: boolean | null } | undefined;
    if (!row?.email) return;
    const message = guestReviewPosted({
      propertyName: row.property_name,
      pending: i.pending,
      publishesAtDeadline: row.deadline_may !== false,
      manageUrl: reviewManageUrl(c.urls.webUrl, bookingId),
    });
    await c.transport({ from: sender("roy"), to: row.email, ...message });
  } catch (error) {
    i.report?.(error);
  }
}

/**
 * Tells the guest that the property published a public reply to their
 * review, quoting the latest one. Skipped for anonymized reviews and for
 * guests who turned review emails off. Never throws: the reply is already
 * stored; `report` hears about failures.
 */
export async function sendReviewReplied(
  reviewId: string,
  i: { report?: (error: unknown) => void },
  deps: ReviewSendDeps = {},
): Promise<void> {
  try {
    const c = resolve(deps);
    const row = (
      await c.db.query(
        `SELECT u.email, u.first_name AS guest_first_name, rv.guest_user_id, p.name AS property_name, rv.booking_id,
                (gp.review_emails_opt_out_at IS NOT NULL) AS opted_out,
                (SELECT COALESCE(rr.masked_body, rr.body) FROM review_replies rr
                  WHERE rr.review_id = rv.id AND rr.author_role = 'host' AND rr.status = 'published'
                  ORDER BY rr.created_at DESC LIMIT 1) AS reply_body
           FROM reviews rv
           JOIN properties p ON p.id = rv.property_id
           LEFT JOIN "user" u ON u.id = rv.guest_user_id
           LEFT JOIN guest_profile gp ON gp.user_id = rv.guest_user_id
          WHERE rv.id = $1::uuid`,
        [reviewId],
      )
    ).rows[0] as
      | {
          email: string | null;
          guest_first_name: string | null;
          guest_user_id: string | null;
          property_name: string;
          booking_id: string;
          opted_out: boolean;
          reply_body: string | null;
        }
      | undefined;
    if (!row?.guest_user_id || !row.email || row.opted_out || !row.reply_body) return;
    const message = guestReviewReplied({
      guestFirstName: row.guest_first_name?.trim() || "there",
      propertyName: row.property_name,
      replyBody: row.reply_body,
      manageUrl: reviewManageUrl(c.urls.webUrl, row.booking_id),
      settingsUrl: `${trim(c.urls.webUrl)}/account/privacy`,
    });
    await c.transport({ from: sender("roy"), to: row.email, ...message });
  } catch (error) {
    i.report?.(error);
  }
}

type AuthorRow = {
  email: string | null;
  author_user_id: string | null;
  author_is_host: boolean;
  property_name: string;
  booking_id: string;
};

const AUTHOR_SQL = {
  review: `SELECT u.email, rv.guest_user_id AS author_user_id, false AS author_is_host, p.name AS property_name, rv.booking_id
             FROM reviews rv
             JOIN properties p ON p.id = rv.property_id
             LEFT JOIN "user" u ON u.id = rv.guest_user_id
            WHERE rv.id = $1::uuid`,
  reply: `SELECT u.email, rr.author_user_id, (rr.author_role = 'host') AS author_is_host, p.name AS property_name, rv.booking_id
            FROM review_replies rr
            JOIN reviews rv ON rv.id = rr.review_id
            JOIN properties p ON p.id = rv.property_id
            LEFT JOIN "user" u ON u.id = rr.author_user_id
           WHERE rr.id = $1::uuid`,
} as const;

/**
 * Sends one short decision notice to the author of a review or reply. A
 * service message: sent even when the author turned review emails off. An
 * anonymized author (no account left) gets nothing. A guest's notice links to
 * their review page, a host's to the business Reviews page. Never throws:
 * the decision is stored; `report` hears about failures.
 */
async function sendNotice(
  item: ModerationItem,
  build: typeof moderationRemovedNotice,
  report: ((error: unknown) => void) | undefined,
  deps: ReviewSendDeps,
): Promise<void> {
  try {
    const c = resolve(deps);
    const row = (await c.db.query(AUTHOR_SQL[item.kind], [item.id])).rows[0] as AuthorRow | undefined;
    if (!row?.author_user_id || !row.email) return;
    const audience = row.author_is_host ? "host" : "guest";
    const pageUrl = row.author_is_host ? `${trim(c.urls.businessUrl)}/dashboard/bookings/reviews` : reviewManageUrl(c.urls.webUrl, row.booking_id);
    const message = build({ itemKind: item.kind, audience, propertyName: row.property_name, pageUrl });
    await c.transport({ from: sender("roy"), to: row.email, ...message });
  } catch (error) {
    report?.(error);
  }
}

/**
 * Tells the author of a review or reply that a moderator removed it: a short
 * email linking to the page with the rules and the way to object. A kept item
 * sends nothing. Never throws.
 */
export async function sendModerationDecision(
  item: ModerationItem,
  decision: "kept" | "removed",
  i: { report?: (error: unknown) => void } = {},
  deps: ReviewSendDeps = {},
): Promise<void> {
  if (decision !== "removed") return;
  await sendNotice(item, moderationRemovedNotice, i.report, deps);
}

/**
 * Tells the authors of items the 72-hour deadline published with some parts
 * masked. One failed address doesn't stop the others. Never throws.
 */
export async function sendMaskedPublicationNotices(
  items: ModerationItem[],
  i: { report?: (error: unknown) => void } = {},
  deps: ReviewSendDeps = {},
): Promise<void> {
  for (const item of items) await sendNotice(item, moderationMaskedNotice, i.report, deps);
}

/**
 * Tells each reporter what became of their report: upheld (the item was
 * removed) or not. A host reporter is the reporting member's own address; a
 * public reporter only at the email they left on the form. Service messages, sent whatever the
 * review-email opt-out says. Never throws: one failed address doesn't stop the
 * others, and `deps.report` hears about each.
 */
export async function sendReportOutcomes(
  reportIds: string[],
  upheld: boolean,
  deps: ReviewSendDeps & { report?: (error: unknown) => void } = {},
): Promise<void> {
  try {
    if (reportIds.length === 0) return;
    const c = resolve(deps);
    const rows = (
      await c.db.query(
        `SELECT rp.reporter_kind, rp.reporter_email, u.email AS user_email, p.name AS property_name, (rp.reply_id IS NOT NULL) AS is_reply
           FROM review_reports rp
           JOIN reviews rv ON rv.id = rp.review_id
           JOIN properties p ON p.id = rv.property_id
           LEFT JOIN "user" u ON u.id = rp.reporter_user_id
          WHERE rp.id = ANY($1::uuid[])`,
        [reportIds],
      )
    ).rows as { reporter_kind: "host" | "public"; reporter_email: string | null; user_email: string | null; property_name: string; is_reply: boolean }[];
    for (const r of rows) {
      try {
        const to = r.reporter_kind === "host" ? r.user_email : r.reporter_email;
        if (!to) continue;
        const message = reportOutcome({ upheld, propertyName: r.property_name, itemKind: r.is_reply ? "reply" : "review" });
        await c.transport({ from: sender("roy"), to, ...message });
      } catch (error) {
        deps.report?.(error);
      }
    }
  } catch (error) {
    deps.report?.(error);
  }
}

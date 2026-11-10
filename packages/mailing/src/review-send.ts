import { getPool } from "@openbookings/db";
import type { ReviewMail } from "@openbookings/db/reviews";
import { hostRecipients, isTestingMode } from "@openbookings/demo";
import { bookingMailUrls, type BookingMailUrls } from "./booking-send";
import { getEmailClient } from "./client";
import { fromAddress } from "./from-address";
import { guestReviewInvitation, guestReviewPosted, guestReviewReminder, guestReviewReplied, hostUnconfirmedStays } from "./review-mail";

/**
 * Sends the review emails: what the invitation job hands over, and the
 * "review posted" confirmation. Wording is in ./review-mail.
 */

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
type Transport = (m: { to: string; subject: string; html: string }) => Promise<void>;

export type ReviewSendDeps = { db?: Db; transport?: Transport; testing?: boolean; urls?: BookingMailUrls };

const resolve = (d: ReviewSendDeps) => ({
  db: d.db ?? getPool(),
  transport:
    d.transport ??
    ((m: { to: string; subject: string; html: string }) =>
      getEmailClient().from(fromAddress()).to(m.to).subject(m.subject).html(m.html).send().then(() => undefined)),
  testing: d.testing ?? isTestingMode(),
  urls: d.urls ?? bookingMailUrls(),
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
    const results = await Promise.allSettled(to.map((address) => c.transport({ to: address, ...message })));
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
  await c.transport({ to: mail.to, ...message });
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
        `SELECT u.email, p.name AS property_name
           FROM bookings b JOIN "user" u ON u.id = b.user_id JOIN properties p ON p.id = b.hotel_id
          WHERE b.id = $1::uuid`,
        [bookingId],
      )
    ).rows[0] as { email: string | null; property_name: string } | undefined;
    if (!row?.email) return;
    const message = guestReviewPosted({
      propertyName: row.property_name,
      pending: i.pending,
      manageUrl: reviewManageUrl(c.urls.webUrl, bookingId),
    });
    await c.transport({ to: row.email, ...message });
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
        `SELECT u.email, u.name AS guest_name, rv.guest_user_id, p.name AS property_name, rv.booking_id,
                (gp.review_emails_opt_out_at IS NOT NULL) AS opted_out,
                (SELECT rr.body FROM review_replies rr
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
          guest_name: string | null;
          guest_user_id: string | null;
          property_name: string;
          booking_id: string;
          opted_out: boolean;
          reply_body: string | null;
        }
      | undefined;
    if (!row?.guest_user_id || !row.email || row.opted_out || !row.reply_body) return;
    const message = guestReviewReplied({
      guestFirstName: (row.guest_name ?? "").trim().split(/\s+/)[0] || "there",
      propertyName: row.property_name,
      replyBody: row.reply_body,
      manageUrl: reviewManageUrl(c.urls.webUrl, row.booking_id),
      settingsUrl: `${trim(c.urls.webUrl)}/account/privacy`,
    });
    await c.transport({ to: row.email, ...message });
  } catch (error) {
    i.report?.(error);
  }
}

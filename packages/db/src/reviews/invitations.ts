/**
 * The review email job (0038), run hourly by /api/cron/review-invitations.
 *
 * Everything keys off the projected check-out, not off check-in/check-out
 * marking (which will come from a calendar sync or PMS later, and can fail):
 *
 *   check-out           host heads-up for stays never marked as arrived:
 *                       "invitations go out tomorrow, mark no-shows now"
 *   check-out + 24h     invitation (the review opens; host no-show marking closes)
 *   invitation + 6 days one reminder, if there's still no review
 *
 * Invitations and reminders only go out in daytime, property time. Every
 * send is claimed in review_invitations first, so overlapping runs never send
 * twice. Selecting on eligibility (not "checked out in the last hour") means
 * stays that ended before this shipped are still invited while their window
 * is open.
 *
 * Mail wording and delivery are the caller's (`send`): this package does not
 * know about the mail provider.
 */
import {
  REVIEW_REMINDER_AFTER_MS,
  isReviewSendHour,
  isValidTimeZone,
  projectedCheckOutAt,
  reviewEligibility,
  reviewWindow,
  REVIEW_WINDOW_DAYS,
  type BookingStatus,
} from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";
import { createReviewToken, deleteReviewToken, firstName } from "./shared";

const DAY = 86_400_000;
/** A claim older than this belongs to a run that died mid-send. */
const STALE_CLAIM_MS = 3_600_000;
/** After this many failed sends a booking is left alone (Sentry has heard about each). */
export const MAX_SEND_ATTEMPTS = 5;

export type GuestReviewMail = {
  kind: "invitation" | "reminder";
  bookingId: string;
  to: string;
  guestFirstName: string;
  propertyName: string;
  /** `YYYY-MM-DD` */
  checkOutDate: string;
  token: string;
  closesAt: Date;
};

export type HostReviewWarningMail = {
  kind: "host_warning";
  propertyId: string;
  propertyName: string;
  timeZone: string;
  /** Stays still marked only as confirmed, whose invitations go out at `invitesAt`. */
  stays: { bookingId: string; guestName: string; guestEmail: string; checkInDate: string; checkOutDate: string; invitesAt: Date }[];
};

export type ReviewMail = GuestReviewMail | HostReviewWarningMail;

export type ReviewInvitationDeps = {
  db: Queryable;
  now: Date;
  send: (mail: ReviewMail) => Promise<void>;
  /** Testing mode: demo hotels take part too. */
  testing?: boolean;
  /** Told about every send that failed. */
  onError?: (error: unknown, context: { kind: ReviewMail["kind"]; bookingIds: string[] }) => void;
};

export type ReviewInvitationSummary = {
  hostWarnings: number;
  invitations: number;
  reminders: number;
  failed: number;
};

type CandidateRow = {
  booking_id: string;
  user_id: string;
  status: BookingStatus;
  check_in_date: string;
  check_out_date: string;
  check_out_time: string | null;
  timezone: string;
  property_id: string;
  property_name: string;
  guest_email: string | null;
  guest_name: string | null;
  opted_out: boolean;
  host_warned_at: Date | null;
  sent_at: Date | null;
  reminder_sent_at: Date | null;
  claimed_at: Date | null;
  attempts: number;
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Stays around their check-out that might still need an email. Every rule is
 * applied again in code; this only narrows the rows down. Rows that can never
 * need one (no-shows, cancelled, already reviewed, reminder sent) are left out.
 */
async function candidates(db: Queryable, now: Date, testing: boolean): Promise<CandidateRow[]> {
  const { rows } = await db.query(
    `SELECT b.id AS booking_id, b.user_id, b.status,
            b.check_in_date::text AS check_in_date, b.check_out_date::text AS check_out_date,
            to_char(p.check_out_time, 'HH24:MI') AS check_out_time, p.timezone,
            p.id AS property_id, p.name AS property_name,
            u.email AS guest_email, u.name AS guest_name,
            (gp.review_emails_opt_out_at IS NOT NULL) AS opted_out,
            ri.host_warned_at, ri.sent_at, ri.reminder_sent_at, ri.claimed_at,
            COALESCE(ri.attempts, 0)::int AS attempts
       FROM bookings b
       JOIN properties p ON p.id = b.hotel_id
       LEFT JOIN "user" u ON u.id = b.user_id
       LEFT JOIN guest_profile gp ON gp.user_id = b.user_id
       LEFT JOIN review_invitations ri ON ri.booking_id = b.id
      WHERE b.check_out_date BETWEEN $1::date AND $2::date
        AND b.status::text IN ('confirmed', 'checked_in', 'completed')
        AND b.no_show_reported_at IS NULL
        AND ($3::boolean OR NOT p.is_demo)
        AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
        AND ri.reminder_sent_at IS NULL
      ORDER BY b.check_out_date, b.id`,
    // A day of slack on both ends for time zones.
    [isoDay(now.getTime() - (REVIEW_WINDOW_DAYS + 2) * DAY), isoDay(now.getTime() + DAY), testing],
  );
  return rows as CandidateRow[];
}

const freshClaim = (row: CandidateRow, now: Date) =>
  row.claimed_at !== null && now.getTime() - new Date(row.claimed_at).getTime() < STALE_CLAIM_MS;

/** Claims the invitation send. True = this run sends it. */
async function claimInvitation(db: Queryable, bookingId: string, now: Date): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO review_invitations (booking_id, claimed_at) VALUES ($1::uuid, $2)
     ON CONFLICT (booking_id) DO UPDATE SET claimed_at = $2
       WHERE review_invitations.sent_at IS NULL
         AND review_invitations.attempts < $4
         AND (review_invitations.claimed_at IS NULL OR review_invitations.claimed_at < $3)
     RETURNING booking_id`,
    [bookingId, now, new Date(now.getTime() - STALE_CLAIM_MS), MAX_SEND_ATTEMPTS],
  );
  return rows.length > 0;
}

async function claimReminder(db: Queryable, bookingId: string, now: Date): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE review_invitations SET claimed_at = $2
      WHERE booking_id = $1::uuid
        AND sent_at IS NOT NULL AND reminder_sent_at IS NULL
        AND attempts < $4
        AND (claimed_at IS NULL OR claimed_at < $3)
     RETURNING booking_id`,
    [bookingId, now, new Date(now.getTime() - STALE_CLAIM_MS), MAX_SEND_ATTEMPTS],
  );
  return rows.length > 0;
}

async function claimHostWarnings(db: Queryable, bookingIds: string[], now: Date): Promise<string[]> {
  const { rows } = await db.query(
    `INSERT INTO review_invitations (booking_id, host_warned_at)
     SELECT id, $2 FROM unnest($1::uuid[]) AS id
     ON CONFLICT (booking_id) DO UPDATE SET host_warned_at = $2
       WHERE review_invitations.host_warned_at IS NULL AND review_invitations.sent_at IS NULL
     RETURNING booking_id`,
    [bookingIds, now],
  );
  return (rows as { booking_id: string }[]).map((r) => r.booking_id);
}

async function failed(db: Queryable, bookingId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.query(
    `UPDATE review_invitations SET claimed_at = NULL, attempts = attempts + 1, last_error = $2 WHERE booking_id = $1::uuid`,
    [bookingId, message.slice(0, 500)],
  );
}

export async function runReviewInvitations(deps: ReviewInvitationDeps): Promise<ReviewInvitationSummary> {
  const { db, now } = deps;
  const summary: ReviewInvitationSummary = { hostWarnings: 0, invitations: 0, reminders: 0, failed: 0 };
  const candidateRows = await candidates(db, now, deps.testing ?? false);

  // A stored time zone is not trusted: one bad row must not stop everyone else's mail.
  const rows: CandidateRow[] = [];
  for (const row of candidateRows) {
    if (isValidTimeZone(row.timezone)) {
      rows.push(row);
      continue;
    }
    summary.failed += 1;
    deps.onError?.(new Error(`invalid time zone: ${row.timezone}`), { kind: "invitation", bookingIds: [row.booking_id] });
  }

  // 1. Host heads-up, from check-out until the invitation: stays never marked as arrived.
  const toWarn = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    if (row.status !== "confirmed" || row.host_warned_at || row.sent_at) continue;
    const checkOutAt = projectedCheckOutAt({ checkOutDate: row.check_out_date, checkOutTime: row.check_out_time, timeZone: row.timezone });
    const { opensAt } = reviewWindow(checkOutAt);
    if (now < checkOutAt || now >= opensAt) continue;
    toWarn.set(row.property_id, [...(toWarn.get(row.property_id) ?? []), row]);
  }
  for (const [propertyId, stays] of toWarn) {
    const claimed = new Set(await claimHostWarnings(db, stays.map((s) => s.booking_id), now));
    const mine = stays.filter((s) => claimed.has(s.booking_id));
    if (mine.length === 0) continue;
    try {
      await deps.send({
        kind: "host_warning",
        propertyId,
        propertyName: mine[0]!.property_name,
        timeZone: mine[0]!.timezone,
        stays: mine.map((s) => ({
          bookingId: s.booking_id,
          guestName: s.guest_name?.trim() || s.guest_email || "Guest",
          guestEmail: s.guest_email ?? "",
          checkInDate: s.check_in_date,
          checkOutDate: s.check_out_date,
          invitesAt: reviewWindow(
            projectedCheckOutAt({ checkOutDate: s.check_out_date, checkOutTime: s.check_out_time, timeZone: s.timezone }),
          ).opensAt,
        })),
      });
      summary.hostWarnings += 1;
    } catch (error) {
      // Released so the next run tries again, while there is still time before the invitations.
      await db.query(`UPDATE review_invitations SET host_warned_at = NULL WHERE booking_id = ANY($1::uuid[])`, [
        mine.map((s) => s.booking_id),
      ]);
      summary.failed += 1;
      deps.onError?.(error, { kind: "host_warning", bookingIds: mine.map((s) => s.booking_id) });
    }
  }

  // 2. Invitations and reminders.
  for (const row of rows) {
    if (row.opted_out || !row.guest_email || row.attempts >= MAX_SEND_ATTEMPTS || freshClaim(row, now)) continue;
    const checkOutAt = projectedCheckOutAt({ checkOutDate: row.check_out_date, checkOutTime: row.check_out_time, timeZone: row.timezone });
    const eligibility = reviewEligibility({ status: row.status, noShowReportedAt: null, checkOutAt, hasReview: false, now });
    if (!eligibility.ok || !isReviewSendHour(now, row.timezone)) continue;

    let kind: GuestReviewMail["kind"];
    if (!row.sent_at) {
      kind = "invitation";
    } else if (now.getTime() >= new Date(row.sent_at).getTime() + REVIEW_REMINDER_AFTER_MS) {
      kind = "reminder";
    } else {
      continue;
    }

    const claimed = kind === "invitation" ? await claimInvitation(db, row.booking_id, now) : await claimReminder(db, row.booking_id, now);
    if (!claimed) continue;

    const token = await createReviewToken(db, row.booking_id, eligibility.closesAt);
    try {
      await deps.send({
        kind,
        bookingId: row.booking_id,
        to: row.guest_email,
        guestFirstName: firstName(row.guest_name),
        propertyName: row.property_name,
        checkOutDate: row.check_out_date,
        token,
        closesAt: eligibility.closesAt,
      });
      await db.query(
        kind === "invitation"
          ? `UPDATE review_invitations SET sent_at = $2, claimed_at = NULL, last_error = NULL WHERE booking_id = $1::uuid`
          : `UPDATE review_invitations SET reminder_sent_at = $2, claimed_at = NULL, last_error = NULL WHERE booking_id = $1::uuid`,
        [row.booking_id, now],
      );
      if (kind === "invitation") summary.invitations += 1;
      else summary.reminders += 1;
    } catch (error) {
      await deleteReviewToken(db, token);
      await failed(db, row.booking_id, error);
      summary.failed += 1;
      deps.onError?.(error, { kind, bookingIds: [row.booking_id] });
    }
  }

  return summary;
}

/**
 * Guest reviews (0038): reading and writing them. The rules for who may
 * review live in @openbookings/pricing (reviews.ts); this module loads what
 * those rules need and stores the outcome.
 *
 * Two ways in, one check: the Account tab (session owns the booking) and the
 * emailed link (a token points at the booking). Either way the review belongs
 * to the booking's guest. The caller proves which booking; this module
 * decides whether it can be reviewed.
 */
import {
  AVERAGE_WINDOW_MONTHS,
  displayedAverage,
  projectedCheckOutAt,
  reviewEligibility,
  stayMonth,
  type BookingStatus,
  type AuthorModeration,
  type ReviewEligibility,
  type TextCheck,
} from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";

export * from "./shared";
export * from "./invitations";
export * from "./replies";
export * from "./moderation";
export * from "./moderation-sweep";
export * from "./reports";
import { authorFirstName, normalizeReviewBody } from "./shared";
import { authorModerationSql, dismissReportsOfDeleted, storedCheck, toAuthorModeration } from "./moderation";
import { loadReviewReplies, type ReviewReply } from "./replies";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REVIEW_BODY_MAX = 2000;

export type ReviewStatus = "pending" | "published" | "hidden" | "removed" | "deleted";

/** A booking as the review flow sees it. Only what the form may show: property, stay month, first name. */
export type ReviewContext = {
  bookingId: string;
  guestUserId: string;
  propertyId: string;
  propertyName: string;
  propertySlug: string;
  /** `YYYY-MM-01` */
  stayMonth: string;
  authorName: string;
  authorCountry: string | null;
  roomLabel: string | null;
  checkOutAt: Date;
  /** The property's IANA time zone: times on the review page are its local times. */
  timeZone: string;
  eligibility: ReviewEligibility;
  review: GuestReview | null;
};

/** A review as its author sees it. */
export type GuestReview = {
  id: string;
  score: number | null;
  body: string | null;
  status: ReviewStatus;
  createdAt: Date;
  /** What moderation did with it, for its author's page. */
  moderation: AuthorModeration;
  /** The public thread: published replies, plus the guest's own answer while it is held or once removed (with its `moderation`). */
  replies: ReviewReply[];
};

type ContextRow = {
  booking_id: string;
  user_id: string;
  status: BookingStatus;
  no_show_reported_at: Date | null;
  check_out_date: string;
  check_out_time: string | null;
  timezone: string;
  property_id: string;
  property_name: string;
  property_slug: string;
  guest_first_name: string | null;
  guest_country: string | null;
  room_label: string | null;
  review_id: string | null;
  review_score: number | null;
  review_body: string | null;
  review_status: ReviewStatus | null;
  review_rewrite_used: boolean | null;
  review_created_at: Date | null;
  review_moderation: Parameters<typeof toAuthorModeration>[0];
};

const CONTEXT_SQL = `
  SELECT b.id AS booking_id, b.user_id, b.status, b.no_show_reported_at,
         b.check_out_date::text AS check_out_date,
         to_char(p.check_out_time, 'HH24:MI') AS check_out_time, p.timezone,
         p.id AS property_id, p.name AS property_name, p.slug AS property_slug,
         u.first_name AS guest_first_name, gp.country AS guest_country,
         (SELECT string_agg(DISTINCT rm.name, ', ')
            FROM reservations r JOIN rooms rm ON rm.id = r.room_id
           WHERE r.booking_id = b.id AND r.cancelled_at IS NULL) AS room_label,
         rv.id AS review_id, rv.score AS review_score, rv.body AS review_body,
         rv.status AS review_status, rv.rewrite_used AS review_rewrite_used, rv.created_at AS review_created_at,
         ${authorModerationSql("review", "rv")} AS review_moderation
    FROM bookings b
    JOIN properties p ON p.id = b.hotel_id
    LEFT JOIN "user" u ON u.id = b.user_id
    LEFT JOIN guest_profile gp ON gp.user_id = b.user_id
    LEFT JOIN reviews rv ON rv.booking_id = b.id
   WHERE b.id = $1::uuid`;

function toContext(row: ContextRow, now: Date): ReviewContext {
  const checkOutAt = projectedCheckOutAt({
    checkOutDate: row.check_out_date,
    checkOutTime: row.check_out_time,
    timeZone: row.timezone,
  });
  return {
    bookingId: row.booking_id,
    guestUserId: row.user_id,
    propertyId: row.property_id,
    propertyName: row.property_name,
    propertySlug: row.property_slug,
    stayMonth: stayMonth(row.check_out_date),
    authorName: authorFirstName(row.guest_first_name),
    authorCountry: row.guest_country?.trim().toUpperCase() || null,
    roomLabel: row.room_label,
    checkOutAt,
    timeZone: row.timezone,
    eligibility: reviewEligibility({
      status: row.status,
      noShowReportedAt: row.no_show_reported_at,
      checkOutAt,
      // A removed review may be written once more (the same row): it doesn't count until then.
      hasReview: row.review_id !== null && !(row.review_status === "removed" && !row.review_rewrite_used),
      now,
    }),
    review: row.review_id
      ? {
          id: row.review_id,
          score: row.review_score,
          body: row.review_body,
          status: row.review_status!,
          createdAt: row.review_created_at!,
          moderation: toAuthorModeration(row.review_moderation),
          replies: [],
        }
      : null,
  };
}

/** A booking's review state, or null when there is no such booking. */
export async function getReviewContext(db: Queryable, bookingId: string, now: Date): Promise<ReviewContext | null> {
  if (!UUID.test(bookingId)) return null;
  const row = (await db.query(CONTEXT_SQL, [bookingId])).rows[0] as ContextRow | undefined;
  if (!row) return null;
  const context = toContext(row, now);
  if (context.review && context.review.status !== "deleted") {
    // A host reply held for a check isn't shown to the guest yet; their own held or removed answer is.
    context.review.replies = (await loadReviewReplies(db, [context.review.id], { author: "guest" })).get(context.review.id) ?? [];
  }
  return context;
}

// ── Writing ───────────────────────────────────────────────────────────────────

export type SubmitReviewInput = {
  bookingId: string;
  via: "session" | "token";
  score: number;
  body: string | null;
  /** The automated check's outcome: clean publishes now, anything else is held for a person. */
  check: TextCheck;
  now: Date;
};

export type SubmitReviewResult =
  | { ok: true; reviewId: string; status: "published" | "pending"; context: ReviewContext }
  | { ok: false; error: "not_found" | "invalid" | Exclude<ReviewEligibility, { ok: true }>["reason"] };


/**
 * Stores a review for the booking's guest. The caller has already proved the
 * booking (session ownership or token). Published straight away when the
 * automated check is clean, else held for a moderator: hosts never approve or
 * hold reviews.
 *
 * A review a moderator removed may be written once more: the same row is
 * rewritten (new score, text and check; the old decision cleared;
 * rewrite_used set), never a second row.
 */
export async function submitReview(db: Queryable, i: SubmitReviewInput): Promise<SubmitReviewResult> {
  if (!Number.isInteger(i.score) || i.score < 1 || i.score > 10) return { ok: false, error: "invalid" };
  const body = normalizeReviewBody(i.body);
  if (body && body.length > REVIEW_BODY_MAX) return { ok: false, error: "invalid" };

  const context = await getReviewContext(db, i.bookingId, i.now);
  if (!context) return { ok: false, error: "not_found" };
  if (!context.eligibility.ok) return { ok: false, error: context.eligibility.reason };

  const check = storedCheck(i.check, i.now);
  const { status } = check;
  const inserted = (
    context.review
      ? // The one rewrite after a removal (eligibility allowed it). The clock
        // for the deadline starts again: created_at is the new submission.
        await db.query(
          `UPDATE reviews
              SET score = $2, body = $3, status = $4, flagged_reason = $5, flagged_fragments = $6::jsonb,
                  check_source = $7, checked_at = $8, submitted_via = $9, published_at = $10,
                  masked_body = NULL, published_by_deadline = false, decision = NULL, decision_rules = NULL,
                  decision_note = NULL, decided_by = NULL, decided_at = NULL, rewrite_used = true,
                  created_at = $11, updated_at = $11
            WHERE id = $1::uuid AND status = 'removed' AND NOT rewrite_used
            RETURNING id`,
          [
            context.review.id,
            i.score,
            body,
            status,
            check.flaggedReason,
            check.fragments,
            check.source,
            check.checkedAt,
            i.via,
            status === "published" ? i.now : null,
            i.now,
          ],
        )
      : await db.query(
          `INSERT INTO reviews
             (booking_id, property_id, guest_user_id, score, body, author_name, author_country,
              stay_month, room_label, status, flagged_reason, flagged_fragments, check_source, checked_at,
              submitted_via, published_at, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $17)
           ON CONFLICT (booking_id) DO NOTHING
           RETURNING id`,
          [
            context.bookingId,
            context.propertyId,
            context.guestUserId,
            i.score,
            body,
            context.authorName,
            context.authorCountry,
            context.stayMonth,
            context.roomLabel,
            status,
            check.flaggedReason,
            check.fragments,
            check.source,
            check.checkedAt,
            i.via,
            status === "published" ? i.now : null,
            i.now,
          ],
        )
  ).rows[0] as { id: string } | undefined;
  // Lost a race with a second submit (or rewrite): the first one stands.
  if (!inserted) return { ok: false, error: "already_reviewed" };
  // Spent: every emailed link for this booking is now useless, so drop them.
  await db.query(`DELETE FROM review_tokens WHERE booking_id = $1::uuid`, [context.bookingId]);
  return { ok: true, reviewId: inserted.id, status, context };
}

/**
 * The author deletes their review. The row stays without its content, so the
 * booking can't be reviewed again: that would be an edit after a host reply.
 * It leaves the moderation queue: open reports on it and its replies close as
 * dismissed.
 */
export async function deleteGuestReview(
  db: Queryable,
  i: { bookingId: string; guestUserId: string; now: Date },
): Promise<boolean> {
  if (!UUID.test(i.bookingId)) return false;
  const row = (
    await db.query(
      `UPDATE reviews
          SET status = 'deleted', score = NULL, body = NULL, flagged_reason = NULL,
              masked_body = NULL, flagged_fragments = '[]', deleted_at = $3, updated_at = $3
        WHERE booking_id = $1::uuid AND guest_user_id = $2 AND status <> 'deleted'
        RETURNING id`,
      [i.bookingId, i.guestUserId, i.now],
    )
  ).rows[0] as { id: string } | undefined;
  if (!row) return false;
  await dismissReportsOfDeleted(db, { reviewId: row.id, replyId: null, now: i.now });
  return true;
}

/**
 * Account deletion: the reviews stay (they describe a real stay), the person
 * goes. Name and country are replaced, the link to the account removed.
 */
export async function anonymizeGuestReviews(db: Queryable, guestUserId: string): Promise<number> {
  // Their answers under property replies stay too, without the link to them.
  await db.query(
    `UPDATE review_replies SET author_user_id = NULL, updated_at = NOW() WHERE author_role = 'guest' AND author_user_id = $1`,
    [guestUserId],
  );
  const { rows } = await db.query(
    `UPDATE reviews
        SET guest_user_id = NULL, author_name = 'Former guest', author_country = NULL, updated_at = NOW()
      WHERE guest_user_id = $1
      RETURNING id`,
    [guestUserId],
  );
  return rows.length;
}

/** Turns review invitations and reminders off (or back on) for a guest. */
export async function setReviewEmails(db: Queryable, guestUserId: string, enabled: boolean, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO guest_profile (user_id, review_emails_opt_out_at, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET review_emails_opt_out_at = EXCLUDED.review_emails_opt_out_at, updated_at = $3`,
    [guestUserId, enabled ? null : now, now],
  );
}

export async function reviewEmailsEnabled(db: Queryable, guestUserId: string): Promise<boolean> {
  const row = (
    await db.query(`SELECT review_emails_opt_out_at FROM guest_profile WHERE user_id = $1`, [guestUserId])
  ).rows[0] as { review_emails_opt_out_at: Date | null } | undefined;
  return !row?.review_emails_opt_out_at;
}

// ── Reading for the property page ─────────────────────────────────────────────

export type PublicReview = {
  id: string;
  score: number;
  body: string | null;
  authorName: string;
  authorCountry: string | null;
  /** `YYYY-MM-01` */
  stayMonth: string;
  roomLabel: string | null;
  /** ISO timestamp: the value is cached as JSON. */
  publishedAt: string;
  /** Published replies under it, oldest first: host, guest, host. */
  replies: ReviewReply[];
};

export type PropertyReviews = {
  /** Published reviews, the ones with text first, then newest first; at most `limit`. */
  reviews: PublicReview[];
  /** Every published review, however many `reviews` holds. */
  total: number;
  /** Published reviews of the last 24 months that count towards the average. */
  recentCount: number;
  /** One decimal, or null below 3 recent reviews. */
  average: number | null;
};

export async function loadPropertyReviews(
  db: Queryable,
  propertyId: string,
  now: Date,
  limit = 100,
): Promise<PropertyReviews> {
  if (!UUID.test(propertyId)) return { reviews: [], total: 0, recentCount: 0, average: null };
  const since = new Date(now);
  since.setUTCMonth(since.getUTCMonth() - AVERAGE_WINDOW_MONTHS);
  const [{ rows: list }, { rows: recent }, { rows: totals }] = await Promise.all([
    db.query(
      // The masked text when it published by the deadline: never the original.
      `SELECT id, score, COALESCE(masked_body, body) AS body, author_name, author_country,
              stay_month::text AS stay_month, room_label, published_at
         FROM reviews
        WHERE property_id = $1::uuid AND status = 'published'
        ORDER BY (body IS NULL), published_at DESC
        LIMIT $2`,
      [propertyId, limit],
    ),
    db.query(
      `SELECT score FROM reviews WHERE property_id = $1::uuid AND status = 'published' AND published_at >= $2`,
      [propertyId, since],
    ),
    db.query(`SELECT count(*)::int AS n FROM reviews WHERE property_id = $1::uuid AND status = 'published'`, [propertyId]),
  ]);
  const scores = (recent as { score: number }[]).map((r) => Number(r.score));
  const replies = await loadReviewReplies(db, (list as { id: string }[]).map((r) => r.id), { publicOnly: true });
  return {
    reviews: (list as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      score: Number(r.score),
      body: (r.body as string | null) ?? null,
      authorName: r.author_name as string,
      authorCountry: (r.author_country as string | null)?.trim() || null,
      stayMonth: r.stay_month as string,
      roomLabel: (r.room_label as string | null) ?? null,
      publishedAt: new Date(r.published_at as Date).toISOString(),
      replies: replies.get(r.id as string) ?? [],
    })),
    total: (totals[0] as { n: number }).n,
    recentCount: scores.length,
    average: displayedAverage(scores),
  };
}

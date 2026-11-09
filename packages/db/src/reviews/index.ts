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
  type ReviewEligibility,
} from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";

export * from "./shared";
export * from "./invitations";
import { firstName } from "./shared";

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
  guest_name: string | null;
  guest_country: string | null;
  room_label: string | null;
  review_id: string | null;
  review_score: number | null;
  review_body: string | null;
  review_status: ReviewStatus | null;
  review_created_at: Date | null;
};

const CONTEXT_SQL = `
  SELECT b.id AS booking_id, b.user_id, b.status, b.no_show_reported_at,
         b.check_out_date::text AS check_out_date,
         to_char(p.check_out_time, 'HH24:MI') AS check_out_time, p.timezone,
         p.id AS property_id, p.name AS property_name, p.slug AS property_slug,
         u.name AS guest_name, gp.country AS guest_country,
         (SELECT string_agg(DISTINCT rm.name, ', ')
            FROM reservations r JOIN rooms rm ON rm.id = r.room_id
           WHERE r.booking_id = b.id AND r.cancelled_at IS NULL) AS room_label,
         rv.id AS review_id, rv.score AS review_score, rv.body AS review_body,
         rv.status AS review_status, rv.created_at AS review_created_at
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
    authorName: firstName(row.guest_name),
    authorCountry: row.guest_country?.trim().toUpperCase() || null,
    roomLabel: row.room_label,
    checkOutAt,
    eligibility: reviewEligibility({
      status: row.status,
      noShowReportedAt: row.no_show_reported_at,
      checkOutAt,
      hasReview: row.review_id !== null,
      now,
    }),
    review: row.review_id
      ? {
          id: row.review_id,
          score: row.review_score,
          body: row.review_body,
          status: row.review_status!,
          createdAt: row.review_created_at!,
        }
      : null,
  };
}

/** A booking's review state, or null when there is no such booking. */
export async function getReviewContext(db: Queryable, bookingId: string, now: Date): Promise<ReviewContext | null> {
  if (!UUID.test(bookingId)) return null;
  const row = (await db.query(CONTEXT_SQL, [bookingId])).rows[0] as ContextRow | undefined;
  return row ? toContext(row, now) : null;
}

// ── Writing ───────────────────────────────────────────────────────────────────

export type SubmitReviewInput = {
  bookingId: string;
  via: "session" | "token";
  score: number;
  body: string | null;
  /** From the automated check. Set = held as 'pending' for a person; null = published now. */
  flaggedReason: string | null;
  now: Date;
};

export type SubmitReviewResult =
  | { ok: true; reviewId: string; status: "published" | "pending"; context: ReviewContext }
  | { ok: false; error: "not_found" | "invalid" | Exclude<ReviewEligibility, { ok: true }>["reason"] };

/** Trims a review text; empty means none. */
export function normalizeReviewBody(body: string | null | undefined): string | null {
  const text = (body ?? "").replace(/\r\n/g, "\n").trim();
  return text.length > 0 ? text : null;
}

/**
 * Stores a review for the booking's guest. The caller has already proved the
 * booking (session ownership or token). Published straight away unless the
 * automated check flagged it: hosts never approve or hold reviews.
 */
export async function submitReview(db: Queryable, i: SubmitReviewInput): Promise<SubmitReviewResult> {
  if (!Number.isInteger(i.score) || i.score < 1 || i.score > 10) return { ok: false, error: "invalid" };
  const body = normalizeReviewBody(i.body);
  if (body && body.length > REVIEW_BODY_MAX) return { ok: false, error: "invalid" };

  const context = await getReviewContext(db, i.bookingId, i.now);
  if (!context) return { ok: false, error: "not_found" };
  if (!context.eligibility.ok) return { ok: false, error: context.eligibility.reason };

  const status = i.flaggedReason ? "pending" : "published";
  const inserted = (
    await db.query(
      `INSERT INTO reviews
         (booking_id, property_id, guest_user_id, score, body, author_name, author_country,
          stay_month, room_label, status, flagged_reason, submitted_via, published_at, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $14, $14)
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
        i.flaggedReason,
        i.via,
        status === "published" ? i.now : null,
        i.now,
      ],
    )
  ).rows[0] as { id: string } | undefined;
  // Lost a race with a second submit: the first one stands.
  if (!inserted) return { ok: false, error: "already_reviewed" };
  // Spent: every emailed link for this booking is now useless, so drop them.
  await db.query(`DELETE FROM review_tokens WHERE booking_id = $1::uuid`, [context.bookingId]);
  return { ok: true, reviewId: inserted.id, status, context };
}

/**
 * The author deletes their review. The row stays without its content, so the
 * booking can't be reviewed again: that would be an edit after a host reply.
 */
export async function deleteGuestReview(
  db: Queryable,
  i: { bookingId: string; guestUserId: string; now: Date },
): Promise<boolean> {
  if (!UUID.test(i.bookingId)) return false;
  const { rows } = await db.query(
    `UPDATE reviews
        SET status = 'deleted', score = NULL, body = NULL, flagged_reason = NULL,
            deleted_at = $3, updated_at = $3
      WHERE booking_id = $1::uuid AND guest_user_id = $2 AND status <> 'deleted'
      RETURNING id`,
    [i.bookingId, i.guestUserId, i.now],
  );
  return rows.length > 0;
}

/**
 * Account deletion: the reviews stay (they describe a real stay), the person
 * goes. Name and country are replaced, the link to the account removed.
 */
export async function anonymizeGuestReviews(db: Queryable, guestUserId: string): Promise<number> {
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
      `SELECT id, score, body, author_name, author_country, stay_month::text AS stay_month, room_label, published_at
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
    })),
    total: (totals[0] as { n: number }).n,
    recentCount: scores.length,
    average: displayedAverage(scores),
  };
}

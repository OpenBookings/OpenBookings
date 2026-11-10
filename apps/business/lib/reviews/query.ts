import * as Sentry from "@sentry/nextjs";
import { isTestingMode } from "@openbookings/mode";
import { getHostScopedDb, propertyReadAccessSql, type SessionLike } from "@openbookings/authz";
import { nextReplyRole, type ReplyRole } from "@openbookings/pricing";
import type { ReplyStatus, ReviewReply } from "@openbookings/db/reviews";
import { needsReply, type HostReview } from "./shape";

/** The newest reviews a host sees; older ones drop off the page. */
const LIMIT = 500;

type Row = {
  id: string;
  booking_id: string;
  property_id: string;
  property_name: string;
  score: number;
  body: string | null;
  author_name: string;
  author_country: string | null;
  stay_month: string;
  room_label: string | null;
  status: "published" | "pending";
  flagged_reason: string | null;
  posted_at: Date;
  private_reply_at: Date | null;
  replies: {
    id: string;
    role: ReplyRole;
    body: string;
    status: ReplyStatus;
    published_at: string | null;
    edited_at: string | null;
    created_at: string;
  }[];
};

/**
 * Published reviews and reviews being checked, at every property the
 * signed-in member can read, each with its public thread (published and
 * held replies) and the time of the latest private reply. Hidden, removed
 * and deleted reviews are left out.
 */
const hostReviewsSql = (testing: boolean) => `
  SELECT rv.id, rv.booking_id, rv.property_id, p.name AS property_name, rv.score, rv.body,
         rv.author_name, rv.author_country, rv.stay_month::text AS stay_month, rv.room_label,
         rv.status, rv.flagged_reason, COALESCE(rv.published_at, rv.created_at) AS posted_at,
         (SELECT max(m.created_at) FROM messages m WHERE m.review_id = rv.id) AS private_reply_at,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', rr.id, 'role', rr.author_role, 'body', rr.body, 'status', rr.status,
             'published_at', rr.published_at, 'edited_at', rr.edited_at, 'created_at', rr.created_at
           ) ORDER BY rr.created_at, rr.id)
           FROM review_replies rr
           WHERE rr.review_id = rv.id AND rr.status IN ('published', 'pending')
         ), '[]'::json) AS replies
    FROM reviews rv
    JOIN properties p ON p.id = rv.property_id
   WHERE rv.status IN ('published', 'pending')
     AND ${propertyReadAccessSql("$1", testing)}
   ORDER BY COALESCE(rv.published_at, rv.created_at) DESC
   LIMIT ${LIMIT}`;

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);

function toHostReview(row: Row): HostReview {
  const replies: ReviewReply[] = row.replies.map((r) => ({
    id: r.id,
    role: r.role,
    body: r.body,
    status: r.status,
    publishedAt: iso(r.published_at),
    editedAt: iso(r.edited_at),
    createdAt: iso(r.created_at)!,
  }));
  return {
    id: row.id,
    bookingId: row.booking_id,
    propertyId: row.property_id,
    propertyName: row.property_name,
    score: Number(row.score),
    body: row.body,
    authorName: row.author_name,
    authorCountry: row.author_country?.trim() || null,
    stayMonth: row.stay_month,
    roomLabel: row.room_label,
    status: row.status,
    flaggedReason: row.flagged_reason,
    postedAt: iso(row.posted_at)!,
    replies,
    privateReplyAt: iso(row.private_reply_at),
    nextRole: nextReplyRole(replies.map((r) => r.role)),
  };
}

export async function loadHostReviews(
  session: SessionLike,
  host: Pick<ReturnType<typeof getHostScopedDb>, "query"> = getHostScopedDb(session),
  testing: boolean = isTestingMode(),
): Promise<HostReview[]> {
  const rows = await host.query<Row>(hostReviewsSql(testing));
  return rows.map(toHostReview);
}

/** For the sidebar badge. Never throws: a count isn't worth a broken dashboard. */
export async function countReviewsNeedingReply(
  session: SessionLike,
  host?: Pick<ReturnType<typeof getHostScopedDb>, "query">,
  testing: boolean = isTestingMode(),
): Promise<number> {
  try {
    const list = await loadHostReviews(session, host ?? getHostScopedDb(session), testing);
    return list.filter(needsReply).length;
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "reviews", surface: "sidebar-count" } });
    return 0;
  }
}

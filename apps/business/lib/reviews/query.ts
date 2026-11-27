import * as Sentry from "@sentry/nextjs";
import { isTestingMode } from "@openbookings/mode";
import { currentPropertySql, getPropertyScopedDb, type SessionLike } from "@openbookings/authz";
import { nextReplyRole, type ReplyRole } from "@openbookings/pricing";
import { authorModerationSql, toAuthorModeration, type ReplyStatus, type ReviewReply } from "@openbookings/db/reviews";
import { needsReply, type HostReportStatus, type HostReview } from "./shape";

/** The newest reviews a host sees; older ones drop off the page. */
const LIMIT = 500;

type Row = {
  id: string;
  booking_id: string;
  property_id: string;
  property_name: string;
  timezone: string;
  score: number;
  body: string | null;
  author_name: string;
  author_country: string | null;
  stay_month: string;
  room_label: string | null;
  status: "published" | "pending" | "removed";
  flagged_reason: string | null;
  report_status: HostReportStatus | null;
  reply_reports: Record<string, HostReportStatus> | null;
  posted_at: Date;
  private_reply_at: Date | null;
  reply_skipped_at: Date | null;
  replies: {
    id: string;
    role: ReplyRole;
    body: string;
    status: ReplyStatus;
    published_at: string | null;
    edited_at: string | null;
    created_at: string;
    /** The host's own replies only. */
    moderation: Parameters<typeof toAuthorModeration>[0] | null;
  }[];
  /** Every reply that isn't deleted, removed ones included: whose turn it is counts them all (nextReplyRole). */
  thread_roles: ReplyRole[] | null;
};

/**
 * The property's own reports on a review that still count: open ones, and
 * the ones the review's current decision closed (a guest's rewrite after a
 * removal clears the decision, and with it the old outcome). A host reports
 * as its organization (createReviewReport), so a colleague's report shows too.
 */
const ownReportsSql = `
  FROM review_reports rp
 WHERE rp.review_id = rv.id AND rp.reply_id IS NULL AND rp.reporter_kind = 'host'
   AND rp.reporter_org_id IS NOT DISTINCT FROM p.organization_id
   AND (rp.status = 'open' OR rp.decided_at = rv.decided_at)`;

/**
 * Published reviews and reviews being checked, at the current hotel (`$1` the
 * member, `$2` the hotel, bound by getPropertyScopedDb), each with its public thread (published and
 * held replies), the time of the latest private reply, and the property's
 * report on it and on each guest answer under it (by reply id, including an
 * answer its report removed): open first, else the latest outcome. A removed review shows
 * only when the property's report was upheld by its removal, so the host sees
 * the outcome. Hidden and deleted reviews are left out. Text published by the
 * moderation deadline shows masked, as on the property page. The host's own
 * replies come with what moderation did with them (a removed one too, without
 * its words): theirs to see, never a guest's.
 */
const hostReviewsSql = (testing: boolean) => `
  SELECT rv.id, rv.booking_id, rv.property_id, p.name AS property_name, p.timezone, rv.score, COALESCE(rv.masked_body, rv.body) AS body,
         rv.author_name, rv.author_country, rv.stay_month::text AS stay_month, rv.room_label,
         rv.status, rv.flagged_reason, rv.reply_skipped_at, COALESCE(rv.published_at, rv.created_at) AS posted_at,
         (SELECT max(m.created_at) FROM messages m WHERE m.review_id = rv.id) AS private_reply_at,
         (SELECT rp.status ${ownReportsSql} ORDER BY (rp.status = 'open') DESC, rp.created_at DESC LIMIT 1) AS report_status,
         (SELECT json_object_agg(x.reply_id, x.status) FROM (
            SELECT DISTINCT ON (rp.reply_id) rp.reply_id, rp.status
              FROM review_reports rp JOIN review_replies rr ON rr.id = rp.reply_id
             WHERE rp.review_id = rv.id AND rp.reporter_kind = 'host'
               AND rp.reporter_org_id IS NOT DISTINCT FROM p.organization_id
               AND (rp.status = 'open' OR rp.decided_at = rr.decided_at)
             ORDER BY rp.reply_id, (rp.status = 'open') DESC, rp.created_at DESC
          ) x) AS reply_reports,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', rr.id, 'role', rr.author_role,
             'body', CASE WHEN rr.status = 'removed' THEN '' ELSE COALESCE(rr.masked_body, rr.body) END, 'status', rr.status,
             'published_at', rr.published_at, 'edited_at', rr.edited_at, 'created_at', rr.created_at,
             'moderation', CASE WHEN rr.author_role = 'host' THEN ${authorModerationSql("reply", "rr")} END
           ) ORDER BY rr.created_at, rr.id)
           FROM review_replies rr
           WHERE rr.review_id = rv.id
             AND (rr.status IN ('published', 'pending') OR (rr.author_role = 'host' AND rr.status = 'removed'))
         ), '[]'::json) AS replies,
         (SELECT array_agg(rr.author_role ORDER BY rr.created_at, rr.id)
            FROM review_replies rr WHERE rr.review_id = rv.id AND rr.status <> 'deleted') AS thread_roles
    FROM reviews rv
    JOIN properties p ON p.id = rv.property_id
   WHERE (rv.status IN ('published', 'pending')
          OR (rv.status = 'removed' AND EXISTS (SELECT 1 ${ownReportsSql} AND rp.status = 'upheld')))
     AND ${currentPropertySql(testing)}
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
    ...(r.moderation ? { moderation: toAuthorModeration(r.moderation) } : {}),
  }));
  return {
    id: row.id,
    bookingId: row.booking_id,
    propertyId: row.property_id,
    propertyName: row.property_name,
    timeZone: row.timezone,
    score: Number(row.score),
    body: row.body,
    authorName: row.author_name,
    authorCountry: row.author_country?.trim() || null,
    stayMonth: row.stay_month,
    roomLabel: row.room_label,
    status: row.status,
    flaggedReason: row.flagged_reason,
    report: row.report_status,
    replyReports: row.reply_reports ?? {},
    postedAt: iso(row.posted_at)!,
    replies,
    privateReplyAt: iso(row.private_reply_at),
    skippedAt: iso(row.reply_skipped_at),
    nextRole: nextReplyRole(row.thread_roles ?? []),
    threadLength: row.thread_roles?.length ?? 0,
  };
}

type PropertyDb = Pick<ReturnType<typeof getPropertyScopedDb>, "query">;

/** The current hotel's reviews; none without a current hotel. `db` is a seam for the DB-backed tests. */
export async function loadHostReviews(
  session: SessionLike,
  propertyId: string | null,
  db?: PropertyDb,
  testing: boolean = isTestingMode(),
): Promise<HostReview[]> {
  if (!propertyId) return [];
  const host = db ?? getPropertyScopedDb(session, propertyId);
  const rows = await host.query<Row>(hostReviewsSql(testing));
  return rows.map(toHostReview);
}

/** For the sidebar badge, at the current hotel. Never throws: a count isn't worth a broken dashboard. */
export async function countReviewsNeedingReply(
  session: SessionLike,
  propertyId: string | null,
  db?: PropertyDb,
  testing: boolean = isTestingMode(),
): Promise<number> {
  try {
    const list = await loadHostReviews(session, propertyId, db, testing);
    return list.filter(needsReply).length;
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "reviews", surface: "sidebar-count" } });
    return 0;
  }
}

/**
 * Replies to reviews (0039). Public replies form a short thread under the
 * review (host, guest, host: nextReplyRole in @openbookings/pricing). A
 * private reply is a message in the booking's conversation, linked to the
 * review.
 *
 * Callers prove who is writing (a team member with access to the property,
 * or the review's own guest) and run the automated check; this module
 * decides whether it's their turn and stores the outcome.
 */
import { nextReplyRole, REPLY_BODY_MAX, type ReplyRole } from "@openbookings/pricing";
import type { Queryable } from "../reservation-policy";
import { normalizeReviewBody } from "./shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type { ReplyRole } from "@openbookings/pricing";

export type ReplyStatus = "pending" | "published" | "hidden" | "deleted";

/** A reply as the thread shows it. Deleted replies are never returned. */
export type ReviewReply = {
  id: string;
  role: ReplyRole;
  body: string;
  status: ReplyStatus;
  /** ISO timestamps: values may be cached as JSON. */
  publishedAt: string | null;
  editedAt: string | null;
  createdAt: string;
};

export type ReplyError =
  | "not_found"
  | "invalid"
  | "not_your_turn"
  | "thread_closed"
  | "review_deleted"
  | "not_last"
  | "no_thread_host";

type Fail = { ok: false; error: ReplyError };

/** A reply's text, trimmed; null when it is empty or too long. */
function replyBody(body: string): string | null {
  const text = normalizeReviewBody(body);
  return text && text.length <= REPLY_BODY_MAX ? text : null;
}

/**
 * Adds a reply to a review's public thread when it is `role`'s turn. The
 * review row is locked first, so two replies at once can't both take a turn.
 */
export async function postReviewReply(
  db: Queryable,
  i: { reviewId: string; role: ReplyRole; authorUserId: string; body: string; flaggedReason: string | null; now: Date },
): Promise<{ ok: true; replyId: string; status: "published" | "pending"; propertyId: string } | Fail> {
  if (!UUID.test(i.reviewId)) return { ok: false, error: "not_found" };
  const body = replyBody(i.body);
  if (!body) return { ok: false, error: "invalid" };

  const review = (
    await db.query(`SELECT property_id, status FROM reviews WHERE id = $1::uuid FOR UPDATE`, [i.reviewId])
  ).rows[0] as { property_id: string; status: string } | undefined;
  if (!review) return { ok: false, error: "not_found" };
  if (review.status !== "published" && review.status !== "pending") return { ok: false, error: "review_deleted" };

  const { rows } = await db.query(
    `SELECT author_role FROM review_replies WHERE review_id = $1::uuid AND status <> 'deleted' ORDER BY created_at, id`,
    [i.reviewId],
  );
  const next = nextReplyRole((rows as { author_role: ReplyRole }[]).map((r) => r.author_role));
  if (next === null) return { ok: false, error: "thread_closed" };
  if (next !== i.role) return { ok: false, error: "not_your_turn" };

  const status = i.flaggedReason ? "pending" : "published";
  const inserted = (
    await db.query(
      `INSERT INTO review_replies
         (review_id, author_role, author_user_id, body, status, flagged_reason, published_at, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [i.reviewId, i.role, i.authorUserId, body, status, i.flaggedReason, status === "published" ? i.now : null, i.now],
    )
  ).rows[0] as { id: string };
  return { ok: true, replyId: inserted.id, status, propertyId: review.property_id };
}

/** Changes a host reply's text. It goes through the check again. */
export async function editHostReply(
  db: Queryable,
  i: { replyId: string; authorUserId: string; body: string; flaggedReason: string | null; now: Date },
): Promise<{ ok: true; status: "published" | "pending"; propertyId: string } | Fail> {
  if (!UUID.test(i.replyId)) return { ok: false, error: "not_found" };
  const body = replyBody(i.body);
  if (!body) return { ok: false, error: "invalid" };
  const status = i.flaggedReason ? "pending" : "published";
  const row = (
    await db.query(
      `UPDATE review_replies rr
          SET body = $2, flagged_reason = $3, status = $4, author_user_id = $5, edited_at = $6, updated_at = $6,
              published_at = CASE WHEN $4 = 'published' THEN COALESCE(rr.published_at, $6) ELSE rr.published_at END
         FROM reviews rv
        WHERE rr.id = $1::uuid AND rr.author_role = 'host' AND rr.status IN ('published', 'pending')
          AND rv.id = rr.review_id AND rv.status IN ('published', 'pending')
        RETURNING rv.property_id`,
      [i.replyId, body, i.flaggedReason, status, i.authorUserId, i.now],
    )
  ).rows[0] as { property_id: string } | undefined;
  return row ? { ok: true, status, propertyId: row.property_id } : { ok: false, error: "not_found" };
}

/**
 * Deletes a host reply. Only the latest reply in the thread can go, so a
 * guest's answer never hangs under nothing. The row stays without content.
 */
export async function deleteHostReply(
  db: Queryable,
  i: { replyId: string; now: Date },
): Promise<{ ok: true; propertyId: string } | Fail> {
  if (!UUID.test(i.replyId)) return { ok: false, error: "not_found" };
  const reply = (
    await db.query(
      `SELECT rr.review_id, rv.property_id
         FROM review_replies rr JOIN reviews rv ON rv.id = rr.review_id
        WHERE rr.id = $1::uuid AND rr.author_role = 'host' AND rr.status <> 'deleted'
          FOR UPDATE OF rv`,
      [i.replyId],
    )
  ).rows[0] as { review_id: string; property_id: string } | undefined;
  if (!reply) return { ok: false, error: "not_found" };
  const latest = (
    await db.query(
      `SELECT id FROM review_replies WHERE review_id = $1 AND status <> 'deleted' ORDER BY created_at DESC, id DESC LIMIT 1`,
      [reply.review_id],
    )
  ).rows[0] as { id: string };
  if (latest.id !== i.replyId) return { ok: false, error: "not_last" };
  await db.query(
    `UPDATE review_replies
        SET status = 'deleted', body = NULL, flagged_reason = NULL, deleted_at = $2, updated_at = $2
      WHERE id = $1::uuid`,
    [i.replyId, i.now],
  );
  return { ok: true, propertyId: reply.property_id };
}

/** The message row a private reply creates. */
export type PrivateReplyMessage = {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_role: "host";
  body: string;
  flagged_reason: string | null;
  review_id: string;
  read_at: Date | null;
  created_at: Date;
};

/**
 * A host's private reply: a message in the booking's conversation, opened
 * for it if there is none yet. The conversation's host is the property's
 * account owner, as everywhere in Messages.
 */
export async function insertPrivateReviewReply(
  db: Queryable,
  i: { reviewId: string; senderUserId: string; body: string; flaggedReason: string | null; now: Date },
): Promise<{ ok: true; threadId: string; guestUserId: string; message: PrivateReplyMessage } | Fail> {
  if (!UUID.test(i.reviewId)) return { ok: false, error: "not_found" };
  const body = replyBody(i.body);
  if (!body) return { ok: false, error: "invalid" };
  const ctx = (
    await db.query(
      `SELECT rv.status, b.id AS booking_id, b.user_id AS guest_id, p.id AS property_id, p.owner_user_id
         FROM reviews rv JOIN bookings b ON b.id = rv.booking_id JOIN properties p ON p.id = rv.property_id
        WHERE rv.id = $1::uuid`,
      [i.reviewId],
    )
  ).rows[0] as
    | { status: string; booking_id: string; guest_id: string | null; property_id: string; owner_user_id: string | null }
    | undefined;
  if (!ctx || !ctx.guest_id) return { ok: false, error: "not_found" };
  if (ctx.status === "deleted") return { ok: false, error: "review_deleted" };

  let thread = (await db.query(`SELECT id FROM message_threads WHERE booking_id = $1 ORDER BY created_at LIMIT 1`, [ctx.booking_id]))
    .rows[0] as { id: string } | undefined;
  if (!thread) {
    if (!ctx.owner_user_id) return { ok: false, error: "no_thread_host" };
    thread = (
      await db.query(
        `INSERT INTO message_threads (booking_id, property_id, host_id, guest_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [ctx.booking_id, ctx.property_id, ctx.owner_user_id, ctx.guest_id, i.now],
      )
    ).rows[0] as { id: string };
  }
  const message = (
    await db.query(
      `INSERT INTO messages (thread_id, sender_id, sender_role, body, flagged_reason, review_id, created_at)
       VALUES ($1, $2, 'host', $3, $4, $5::uuid, $6)
       RETURNING id, thread_id, sender_id, sender_role, body, flagged_reason, review_id, read_at, created_at`,
      [thread.id, i.senderUserId, body, i.flaggedReason, i.reviewId, i.now],
    )
  ).rows[0] as PrivateReplyMessage;
  await db.query(`UPDATE message_threads SET updated_at = $2 WHERE id = $1`, [thread.id, i.now]);
  return { ok: true, threadId: thread.id, guestUserId: ctx.guest_id, message };
}

type ReplyRow = {
  id: string;
  review_id: string;
  author_role: ReplyRole;
  body: string;
  status: ReplyStatus;
  published_at: Date | null;
  edited_at: Date | null;
  created_at: Date;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/**
 * The threads of several reviews, oldest reply first. `publicOnly` keeps
 * the published replies; otherwise held ones come along too (never deleted).
 */
export async function loadReviewReplies(
  db: Queryable,
  reviewIds: string[],
  opts: { publicOnly: boolean },
): Promise<Map<string, ReviewReply[]>> {
  const out = new Map<string, ReviewReply[]>();
  const ids = reviewIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return out;
  const { rows } = await db.query(
    `SELECT id, review_id, author_role, body, status, published_at, edited_at, created_at
       FROM review_replies
      WHERE review_id = ANY($1::uuid[]) AND ${opts.publicOnly ? "status = 'published'" : "status IN ('published', 'pending')"}
      ORDER BY created_at, id`,
    [ids],
  );
  for (const r of rows as ReplyRow[]) {
    const list = out.get(r.review_id) ?? [];
    list.push({
      id: r.id,
      role: r.author_role,
      body: r.body,
      status: r.status,
      publishedAt: iso(r.published_at),
      editedAt: iso(r.edited_at),
      createdAt: iso(r.created_at)!,
    });
    out.set(r.review_id, list);
  }
  return out;
}

/**
 * "No reply needed": the host marks a review as handled without answering
 * it, or takes that back. It counts until the thread moves on (a guest
 * answer after it makes the review need a reply again).
 */
export async function setReplySkipped(
  db: Queryable,
  i: { reviewId: string; userId: string; skipped: boolean; now: Date },
): Promise<{ ok: true; propertyId: string } | Fail> {
  if (!UUID.test(i.reviewId)) return { ok: false, error: "not_found" };
  const review = (await db.query(`SELECT property_id, status FROM reviews WHERE id = $1::uuid`, [i.reviewId])).rows[0] as
    | { property_id: string; status: string }
    | undefined;
  if (!review) return { ok: false, error: "not_found" };
  if (review.status !== "published" && review.status !== "pending") return { ok: false, error: "review_deleted" };
  await db.query(`UPDATE reviews SET reply_skipped_at = $2, reply_skipped_by = $3 WHERE id = $1::uuid`, [
    i.reviewId,
    i.skipped ? i.now : null,
    i.skipped ? i.userId : null,
  ]);
  return { ok: true, propertyId: review.property_id };
}

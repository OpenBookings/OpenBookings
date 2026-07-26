import { query, queryOne } from "@openbookings/db";
import { getThreadForParticipant, type SessionLike, type ThreadRow } from "@openbookings/authz";
import { detectCircumvention } from "./circumvention";
import { deliverMessageToRecipient, mintRealtimeToken } from "./realtime";
import { CIRCUMVENTION_WARNING, MAX_BODY_LENGTH, type MessageRow } from "./types";

/**
 * Framework-agnostic messaging route handlers, shared by apps/business and
 * apps/web. Each handler is a plain `(Request) => Response` function (Next
 * accepts standard Responses from route handlers), so the package has no
 * Next.js dependency. Auth is injected: each app passes its own Better Auth
 * `getSession`, everything after that (validation, SQL, realtime delivery)
 * is identical on both sides of the conversation.
 *
 * Wire-up in an app is a re-export per route file:
 *
 *   const routes = createMessagingRoutes({
 *     getSession: (headers) => auth.api.getSession({ headers }),
 *   });
 *   export const POST = routes.createThread;
 */
export type MessagingRoutesConfig = {
  getSession: (headers: Headers) => Promise<SessionLike | null>;
};

type ParamsCtx = { params: Promise<{ id: string }> };

type BookingRow = { id: string; hotel_id: string; user_id: string };
type PropertyRow = { id: string; owner_user_id: string | null };

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const DEFAULT_RETENTION_DAYS = 365;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function bearerAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export function createMessagingRoutes(config: MessagingRoutesConfig) {
  const { getSession } = config;

  /**
   * POST /api/threads — creates (or returns the existing) thread for a
   * booking, or a pre-booking property inquiry. Idempotent: re-posting the
   * same booking/property returns the same thread rather than creating a
   * duplicate.
   */
  async function createThread(req: Request): Promise<Response> {
    const session = await getSession(req.headers);
    if (!session) return json({ error: "Unauthorized" }, 401);

    let body: { bookingId?: unknown; propertyId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { bookingId, propertyId } = body;
    if (bookingId !== undefined && typeof bookingId !== "string") {
      return json({ error: "Invalid bookingId" }, 400);
    }
    if (propertyId !== undefined && typeof propertyId !== "string") {
      return json({ error: "Invalid propertyId" }, 400);
    }
    if (!!bookingId === !!propertyId) {
      return json({ error: "Provide exactly one of bookingId or propertyId" }, 400);
    }

    const userId = session.user.id;
    let hostId: string;
    let guestId: string;
    let resolvedPropertyId: string;

    if (bookingId) {
      const booking = await queryOne<BookingRow>(
        `SELECT id, hotel_id, user_id FROM bookings WHERE id = $1`,
        [bookingId],
      );
      if (!booking) return json({ error: "Not found" }, 404);

      const property = await queryOne<PropertyRow>(
        `SELECT id, owner_user_id FROM properties WHERE id = $1`,
        [booking.hotel_id],
      );
      if (!property?.owner_user_id) return json({ error: "Not found" }, 404);

      if (userId !== property.owner_user_id && userId !== booking.user_id) {
        return json({ error: "Not found" }, 404);
      }

      hostId = property.owner_user_id;
      guestId = booking.user_id;
      resolvedPropertyId = property.id;
    } else {
      const property = await queryOne<PropertyRow>(
        `SELECT id, owner_user_id FROM properties WHERE id = $1 AND is_active = true`,
        [propertyId],
      );
      if (!property?.owner_user_id) return json({ error: "Not found" }, 404);
      if (userId === property.owner_user_id) {
        return json({ error: "Hosts cannot open an inquiry on their own property" }, 400);
      }

      hostId = property.owner_user_id;
      guestId = userId;
      resolvedPropertyId = property.id;
    }

    const existing = await queryOne<ThreadRow>(
      bookingId
        ? `SELECT * FROM message_threads WHERE booking_id = $1`
        : `SELECT * FROM message_threads WHERE booking_id IS NULL AND property_id = $1 AND host_id = $2 AND guest_id = $3`,
      bookingId ? [bookingId] : [resolvedPropertyId, hostId, guestId],
    );
    if (existing) return json({ thread: existing });

    const [thread] = await query<ThreadRow>(
      `INSERT INTO message_threads (booking_id, property_id, host_id, guest_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [bookingId ?? null, resolvedPropertyId, hostId, guestId],
    );

    return json({ thread }, 201);
  }

  /** POST /api/threads/[id]/messages */
  async function postThreadMessage(req: Request, { params }: ParamsCtx): Promise<Response> {
    const session = await getSession(req.headers);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const { id: threadId } = await params;
    const participant = await getThreadForParticipant(session, threadId);
    if (!participant) return json({ error: "Not found" }, 404);

    let payload: { body?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const messageBody = payload.body;
    if (typeof messageBody !== "string" || messageBody.trim().length === 0) {
      return json({ error: "Invalid body" }, 400);
    }
    if (messageBody.length > MAX_BODY_LENGTH) {
      return json({ error: "Message too long" }, 400);
    }

    const flaggedReason = detectCircumvention(messageBody);

    const [message] = await query<MessageRow>(
      `INSERT INTO messages (thread_id, sender_id, sender_role, body, flagged_reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [threadId, session.user.id, participant.role, messageBody, flaggedReason],
    );

    await query(`UPDATE message_threads SET updated_at = now() WHERE id = $1`, [threadId]);

    const recipientId =
      participant.role === "host" ? participant.thread.guest_id : participant.thread.host_id;
    await deliverMessageToRecipient({ recipientId, threadId, message });

    return json(
      {
        message,
        warning: flaggedReason ? CIRCUMVENTION_WARNING : null,
      },
      201,
    );
  }

  /** GET /api/threads/[id]/messages — newest page, or forward from ?since= */
  async function getThreadMessages(req: Request, { params }: ParamsCtx): Promise<Response> {
    const session = await getSession(req.headers);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const { id: threadId } = await params;
    const participant = await getThreadForParticipant(session, threadId);
    if (!participant) return json({ error: "Not found" }, 404);

    const url = new URL(req.url);
    const since = url.searchParams.get("since");
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    let messages: MessageRow[];
    if (since) {
      const cursor = await queryOne<{ created_at: string }>(
        `SELECT created_at FROM messages WHERE id = $1 AND thread_id = $2`,
        [since, threadId],
      );
      if (!cursor) return json({ error: "Invalid since" }, 400);

      messages = await query<MessageRow>(
        `SELECT * FROM messages
         WHERE thread_id = $1 AND (created_at, id) > ($2, $3)
         ORDER BY created_at ASC, id ASC
         LIMIT $4`,
        [threadId, cursor.created_at, since, limit],
      );
    } else {
      const page = await query<MessageRow>(
        `SELECT * FROM messages
         WHERE thread_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [threadId, limit],
      );
      messages = page.reverse();
    }

    return json({ messages });
  }

  /**
   * PATCH /api/messages/[id]/read — internal unread bookkeeping only: it
   * keeps the recipient's own unread counts accurate. read_at is never
   * surfaced to the sender (no read receipts).
   */
  async function markMessageRead(req: Request, { params }: ParamsCtx): Promise<Response> {
    const session = await getSession(req.headers);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const { id: messageId } = await params;
    const existing = await queryOne<MessageRow>(`SELECT * FROM messages WHERE id = $1`, [messageId]);
    if (!existing) return json({ error: "Not found" }, 404);

    const participant = await getThreadForParticipant(session, existing.thread_id);
    if (!participant) return json({ error: "Not found" }, 404);

    // Only the recipient can mark a message read, not the sender.
    if (participant.role === existing.sender_role) {
      return json({ error: "Not found" }, 404);
    }

    const [message] = await query<MessageRow>(
      `UPDATE messages SET read_at = COALESCE(read_at, now()) WHERE id = $1 RETURNING *`,
      [messageId],
    );

    return json({ message });
  }

  /** POST /api/realtime/token */
  async function mintToken(req: Request): Promise<Response> {
    const session = await getSession(req.headers);
    if (!session) return json({ error: "Unauthorized" }, 401);

    const { token, expiresAt } = mintRealtimeToken(session.user.id);
    return json({ token, expiresAt });
  }

  /**
   * POST /api/cron/messaging-retention — Cloud Scheduler target, mounted in
   * apps/business only (one sweep covers both apps' messages). Auth is an
   * `Authorization: Bearer <CRON_SECRET>` header checked in-handler; see the
   * business route file for the scheduler job setup.
   *
   * Retention window defaults to 365 days (the 12-month commission liability
   * cap). Threads whose last activity (updated_at — bumped on every new
   * message, for both booking-scoped and pre-booking-inquiry threads) is
   * older than the window get their messages anonymized: sender_id is NULL'd
   * (see migration 0004) and body replaced with a placeholder. flagged_reason
   * and all message_threads metadata are left intact for audit purposes.
   * Idempotent: only touches rows that aren't already anonymized
   * (sender_id IS NOT NULL), so re-running is safe.
   */
  async function runRetention(req: Request): Promise<Response> {
    if (!bearerAuthorized(req, process.env.CRON_SECRET)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const retentionDays = Number(process.env.MESSAGE_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;

    const anonymized = await query<{ id: string }>(
      `UPDATE messages m
       SET sender_id = NULL, body = '[message removed — retention period expired]'
       FROM message_threads t
       WHERE m.thread_id = t.id
         AND m.sender_id IS NOT NULL
         AND t.updated_at < now() - make_interval(days => $1)
       RETURNING m.id`,
      [retentionDays],
    );

    return json({ anonymizedCount: anonymized.length, retentionDays });
  }

  return {
    createThread,
    postThreadMessage,
    getThreadMessages,
    markMessageRead,
    mintToken,
    runRetention,
  };
}

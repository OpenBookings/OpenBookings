import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { getThreadForParticipant } from "@openbookings/authz";
import { NextResponse } from "next/server";
import { detectCircumvention } from "@/lib/messaging/circumvention";
import { deliverMessageToRecipient } from "@/lib/realtime/deliver";

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: string;
  body: string;
  flagged_reason: string | null;
  read_at: string | null;
  notified_at: string | null;
  created_at: string;
};

const MAX_BODY_LENGTH = 5000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: threadId } = await params;
  const participant = await getThreadForParticipant(session, threadId);
  if (!participant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let payload: { body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messageBody = payload.body;
  if (typeof messageBody !== "string" || messageBody.trim().length === 0) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (messageBody.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
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
  await query(`UPDATE messages SET notified_at = now() WHERE id = $1`, [message.id]);

  return NextResponse.json(
    {
      message,
      warning: flaggedReason
        ? "This message may contain contact info. Sharing contact details off-platform isn't allowed."
        : null,
    },
    { status: 201 },
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: threadId } = await params;
  const participant = await getThreadForParticipant(session, threadId);
  if (!participant) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
    if (!cursor) return NextResponse.json({ error: "Invalid since" }, { status: 400 });

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

  return NextResponse.json({ messages });
}

import { queryOne } from "@openbookings/db";
import { NextResponse } from "next/server";
import { sendNewMessageEmail } from "@/lib/mailing/new-message";

/**
 * Called by the ob-durableobjects Worker when a UserThreadDO's
 * offline-fallback alarm fires (recipient had no open WebSocket at message
 * arrival, and still hasn't read it by the deadline). Not user-facing — no
 * Better Auth session exists for a Worker-to-server call, so this checks a
 * static shared secret instead, same pattern as /api/cron/*.
 */
function isAuthorized(req: Request): boolean {
  const secret = process.env.REALTIME_SERVICE_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type PendingDelivery = { messageId: string; threadId: string; recipientId: string };

type MessageRow = {
  id: string;
  thread_id: string;
  body: string;
  read_at: string | null;
};

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: { messages?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const entries: PendingDelivery[] = Array.isArray(payload.messages)
    ? payload.messages.filter(
        (m): m is PendingDelivery =>
          typeof m === "object" &&
          m !== null &&
          typeof (m as PendingDelivery).messageId === "string" &&
          typeof (m as PendingDelivery).threadId === "string" &&
          typeof (m as PendingDelivery).recipientId === "string",
      )
    : [];

  await Promise.all(
    entries.map(async (entry) => {
      const message = await queryOne<MessageRow>(
        `SELECT id, thread_id, body, read_at FROM messages WHERE id = $1 AND thread_id = $2`,
        [entry.messageId, entry.threadId],
      );
      // Already read, or anonymized/removed by the retention sweep — nothing to notify.
      if (!message || message.read_at) return;

      const recipient = await queryOne<{ email: string }>(
        `SELECT email FROM "user" WHERE id = $1`,
        [entry.recipientId],
      );
      if (!recipient?.email) return;

      await sendNewMessageEmail(recipient.email, {
        threadId: entry.threadId,
        body: message.body,
      });
    }),
  );

  return NextResponse.json({ ok: true });
}

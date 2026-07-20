import { auth } from "@/lib/auth";
import { query, queryOne } from "@openbookings/db";
import { getThreadForParticipant } from "@openbookings/authz";
import { NextResponse } from "next/server";

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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: messageId } = await params;
  const existing = await queryOne<MessageRow>(`SELECT * FROM messages WHERE id = $1`, [messageId]);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const participant = await getThreadForParticipant(session, existing.thread_id);
  if (!participant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only the recipient can mark a message read, not the sender.
  if (participant.role === existing.sender_role) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [message] = await query<MessageRow>(
    `UPDATE messages SET read_at = COALESCE(read_at, now()) WHERE id = $1 RETURNING *`,
    [messageId],
  );

  return NextResponse.json({ message });
}

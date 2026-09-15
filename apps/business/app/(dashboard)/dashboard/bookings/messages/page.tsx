import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { getHostScopedDb } from "@openbookings/authz";
import { MessagesView } from "@/components/dashboard/messages/messages-view";
import type { ThreadListItem } from "@openbookings/messaging";

export default async function MessagesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const host = getHostScopedDb(session);
  const threads = await host.query<ThreadListItem>(
    `SELECT
       t.id,
       t.status,
       t.updated_at,
       t.booking_id,
       p.name AS property_name,
       -- PII minimization (task 15): the list shows initial + surname only;
       -- the full name/contact loads when a single thread is opened.
       CASE WHEN position(' ' in g.name) = 0 THEN g.name
            ELSE LEFT(g.name, 1) || '. ' || split_part(g.name, ' ', -1)
       END AS guest_name,
       g.image AS guest_image,
       lm.body AS last_message_body,
       lm.created_at AS last_message_at,
       lm.sender_role AS last_message_sender_role,
       COALESCE(unread.count, 0)::int AS unread_count
     FROM message_threads t
     JOIN properties p ON p.id = t.property_id
     JOIN "user" g ON g.id = t.guest_id
     LEFT JOIN LATERAL (
       SELECT body, created_at, sender_role
       FROM messages m
       WHERE m.thread_id = t.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     LEFT JOIN LATERAL (
       SELECT count(*) AS count
       FROM messages m
       WHERE m.thread_id = t.id AND m.sender_role = 'guest' AND m.read_at IS NULL
     ) unread ON true
     WHERE t.host_id = $1
     ORDER BY t.updated_at DESC`,
  );

  return <MessagesView threads={threads} currentUserId={session.user.id} />;
}

import { PageHold } from "@/components/dashboard/page-loaders";
import { PageHeader } from "@/components/dashboard/page-header";
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { getCurrentProperty } from "@/lib/current-property";
import { CURRENT_PROPERTY_SQL, getPropertyScopedDb, type SessionLike } from "@openbookings/authz";
import { MessagesView } from "@/components/dashboard/messages/messages-view";
import type { ThreadListItem } from "@openbookings/messaging";

/**
 * The current hotel's guest threads. `t.host_id = $1` stays: messages are
 * tied to the user they were stamped for.
 */
function loadThreads(session: SessionLike, propertyId: string) {
  return getPropertyScopedDb(session, propertyId).query<ThreadListItem>(
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
     -- host_id is stamped when the thread is created; a host who has since left
     -- the organization must not keep seeing its guest conversations.
     WHERE t.host_id = $1 AND ${CURRENT_PROPERTY_SQL}
     ORDER BY t.updated_at DESC`,
  );
}

export default async function MessagesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");

  // None without a current hotel.
  const current = await getCurrentProperty();
  const threads = current ? await loadThreads(session, current.propertyId) : [];

  return (
    <PageHold id="messages" fill>
      <PageHeader
        title="Messages"
        description="Read and answer your guests' messages here."
        className="shrink-0 px-4 pb-4 md:pb-6 lg:px-6"
      />
      <MessagesView threads={threads} currentUserId={session.user.id} />
    </PageHold>
  );
}

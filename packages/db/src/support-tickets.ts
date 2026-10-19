import { query } from "./index";

/**
 * Host support tickets (apps/business) — the writes that happen by Chatwoot
 * conversation id: from the support webhook in apps/support-bot, and from the
 * business app's server code *after* it has authorized the session against
 * the ticket. Nothing here checks who is asking; callers must.
 *
 * Org-scoped reads for the business UI live in apps/business, behind
 * getOrgScopedDb, not here.
 */

export type SupportTicketStatus = "pending" | "open" | "snoozed" | "resolved";
export type SupportSenderType = "contact" | "agent_bot" | "user";
export type SupportLinkedType = "booking" | "listing";

export const SUPPORT_TICKET_STATUSES: readonly SupportTicketStatus[] = [
  "pending",
  "open",
  "snoozed",
  "resolved",
];

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === "string" && (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value);
}

/** Previews are one line and short; the full text stays in Chatwoot. */
export const SUPPORT_PREVIEW_MAX = 140;

export function supportPreview(content: string | null | undefined): string | null {
  const line = (content ?? "").replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > SUPPORT_PREVIEW_MAX ? `${line.slice(0, SUPPORT_PREVIEW_MAX - 1)}…` : line;
}

export type SupportContactRow = {
  user_id: string;
  chatwoot_contact_id: number;
  source_id: string;
  pubsub_token: string;
};

export async function getSupportContact(userId: string): Promise<SupportContactRow | null> {
  const rows = await query<SupportContactRow>(
    `SELECT user_id, chatwoot_contact_id::int AS chatwoot_contact_id, source_id, pubsub_token
       FROM support_contacts WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Store the user's Chatwoot contact. First writer wins: if two tabs raced to
 * create the contact, the second insert is a no-op and both get the stored
 * row back, so the user keeps one source_id for good.
 */
export async function saveSupportContact(contact: SupportContactRow): Promise<SupportContactRow> {
  await query(
    `INSERT INTO support_contacts (user_id, chatwoot_contact_id, source_id, pubsub_token)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING`,
    [contact.user_id, contact.chatwoot_contact_id, contact.source_id, contact.pubsub_token],
  );
  const stored = await getSupportContact(contact.user_id);
  if (!stored) throw new Error("support contact vanished after insert");
  return stored;
}

export type NewSupportTicket = {
  organizationId: string;
  propertyId: string | null;
  openedByUserId: string | null;
  conversationId: number;
  category: string;
  linkedType: SupportLinkedType | null;
  linkedId: string | null;
  followUpOf: string | null;
  title: string;
  status: SupportTicketStatus;
  lastMessage?: { at: Date; preview: string | null; sender: SupportSenderType } | null;
};

/**
 * Insert a ticket for a conversation. Idempotent on the conversation id, so
 * the server action and the webhook backfill can both call it. Returns the
 * ticket id either way.
 */
export async function insertSupportTicket(ticket: NewSupportTicket): Promise<string> {
  const last = ticket.lastMessage ?? null;
  const rows = await query<{ id: string }>(
    `INSERT INTO support_tickets (
       organization_id, property_id, opened_by_user_id, chatwoot_conversation_id,
       category, linked_type, linked_id, follow_up_of, title, status,
       last_message_at, last_message_preview, last_message_sender, last_activity_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, COALESCE($11::timestamptz, now()))
     ON CONFLICT (chatwoot_conversation_id) DO NOTHING
     RETURNING id`,
    [
      ticket.organizationId,
      ticket.propertyId,
      ticket.openedByUserId,
      ticket.conversationId,
      ticket.category,
      ticket.linkedType,
      ticket.linkedId,
      ticket.followUpOf,
      ticket.title,
      ticket.status,
      last?.at ?? null,
      last?.preview ?? null,
      last?.sender ?? null,
    ],
  );
  if (rows[0]) return rows[0].id;
  const existing = await query<{ id: string }>(
    `SELECT id FROM support_tickets WHERE chatwoot_conversation_id = $1`,
    [ticket.conversationId],
  );
  if (!existing[0]) throw new Error("support ticket vanished after insert");
  return existing[0].id;
}

export type SupportTicketRef = {
  id: string;
  organization_id: string;
  opened_by_user_id: string | null;
  status: SupportTicketStatus;
};

export async function findSupportTicketByConversation(
  conversationId: number,
): Promise<SupportTicketRef | null> {
  const rows = await query<SupportTicketRef>(
    `SELECT id, organization_id, opened_by_user_id, status
       FROM support_tickets WHERE chatwoot_conversation_id = $1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

/**
 * Apply a Chatwoot status. The first move from `pending` to `open` stamps
 * `handed_off_at` (the "went to the support team" line); every resolve stamps
 * `resolved_at`. Returns false when no ticket has that conversation.
 */
export async function applySupportTicketStatus(
  conversationId: number,
  status: SupportTicketStatus,
  at: Date = new Date(),
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE support_tickets SET
       handed_off_at = CASE
         WHEN $2::text IN ('open', 'snoozed') AND status = 'pending' AND handed_off_at IS NULL
           THEN $3::timestamptz
         ELSE handed_off_at END,
       resolved_at = CASE WHEN $2::text = 'resolved' THEN $3::timestamptz ELSE resolved_at END,
       status = $2::text,
       last_activity_at = GREATEST(last_activity_at, $3::timestamptz),
       updated_at = now()
     WHERE chatwoot_conversation_id = $1
     RETURNING id`,
    [conversationId, status, at],
  );
  return rows.length > 0;
}

/**
 * Record a newer last message. Older deliveries (a webhook retry, a reload
 * racing the webhook) never overwrite a newer one. Returns the ticket when it
 * changed, null otherwise.
 */
export async function recordSupportTicketMessage(
  conversationId: number,
  message: { at: Date; content: string | null; sender: SupportSenderType },
): Promise<{ id: string; opened_by_user_id: string | null } | null> {
  const rows = await query<{ id: string; opened_by_user_id: string | null }>(
    `UPDATE support_tickets SET
       last_message_at = $2::timestamptz,
       last_message_preview = $3::text,
       last_message_sender = $4::text,
       last_activity_at = GREATEST(last_activity_at, $2::timestamptz),
       updated_at = now()
     WHERE chatwoot_conversation_id = $1
       AND (last_message_at IS NULL OR last_message_at <= $2::timestamptz)
     RETURNING id, opened_by_user_id`,
    [conversationId, message.at, supportPreview(message.content) ?? "Attachment", message.sender],
  );
  return rows[0] ?? null;
}

/** Move the user's read marker forward (never back). */
export async function markSupportTicketSeen(
  ticketId: string,
  userId: string,
  at: Date = new Date(),
): Promise<void> {
  await query(
    `INSERT INTO support_ticket_reads (ticket_id, user_id, last_seen_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (ticket_id, user_id)
     DO UPDATE SET last_seen_at = GREATEST(support_ticket_reads.last_seen_at, EXCLUDED.last_seen_at)`,
    [ticketId, userId, at],
  );
}

export type ReplyNotification = {
  ticket_id: string;
  conversation_id: number;
  email: string;
  name: string | null;
};

/**
 * Claim the reply email for a message, atomically. Returns the recipient only
 * when all of these hold, and stamps last_notified_at in the same statement so
 * two workers can't both send:
 *
 * - the opener hasn't seen the ticket since the message arrived;
 * - no email went out for this ticket in the last hour;
 * - the opener is still a member of the ticket's org (a link they can't open
 *   is worse than no email).
 */
export async function claimSupportReplyNotification(
  conversationId: number,
  messageAt: Date,
): Promise<ReplyNotification | null> {
  const rows = await query<ReplyNotification>(
    `UPDATE support_tickets t
        SET last_notified_at = now()
       FROM "user" u
      WHERE t.chatwoot_conversation_id = $1
        AND u.id = t.opened_by_user_id
        AND (t.last_notified_at IS NULL OR t.last_notified_at < now() - interval '1 hour')
        AND NOT EXISTS (
          SELECT 1 FROM support_ticket_reads r
           WHERE r.ticket_id = t.id AND r.user_id = t.opened_by_user_id AND r.last_seen_at >= $2::timestamptz
        )
        AND EXISTS (
          SELECT 1 FROM "member" m
           WHERE m."organizationId" = t.organization_id AND m."userId" = t.opened_by_user_id
        )
      RETURNING t.id AS ticket_id, t.chatwoot_conversation_id::int AS conversation_id, u.email, u.name`,
    [conversationId, messageAt],
  );
  return rows[0] ?? null;
}

/**
 * Webhook backfill: create the ticket row for a conversation the business
 * app created but failed to record. Only trusts what it can verify:
 *
 * - the opener (the HMAC-verified contact identifier) must be a member of
 *   the org named in the conversation's custom attributes — a contact can set
 *   its own custom attributes through the public API, so the org id alone
 *   proves nothing;
 * - the property is kept only if it belongs to that org;
 * - linked items and follow-ups are dropped, since nothing here can check them.
 *
 * Returns true when a row was inserted.
 */
export async function backfillSupportTicket(ticket: {
  conversationId: number;
  organizationId: string;
  openedByUserId: string;
  propertyId: string | null;
  category: string;
  title: string;
  status: SupportTicketStatus;
  createdAt: Date;
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO support_tickets (
       organization_id, property_id, opened_by_user_id, chatwoot_conversation_id,
       category, title, status, last_activity_at, created_at
     )
     SELECT $1::text,
            (SELECT p.id FROM properties p WHERE p.id::text = $2::text AND p.organization_id = $1::text),
            $3::text, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz
      WHERE EXISTS (
        SELECT 1 FROM "member" m WHERE m."organizationId" = $1::text AND m."userId" = $3::text
      )
     ON CONFLICT (chatwoot_conversation_id) DO NOTHING
     RETURNING id`,
    [
      ticket.organizationId,
      ticket.propertyId,
      ticket.openedByUserId,
      ticket.conversationId,
      ticket.category,
      ticket.title,
      ticket.status,
      ticket.createdAt,
    ],
  );
  return rows.length > 0;
}

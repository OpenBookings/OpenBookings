-- 0025_business_support — host support tickets in apps/business.
--
-- Applied by `bun run db:migrate:ci` (CI, on merge) or by hand with psql,
-- BEFORE the code that reads it is switched on (SUPPORT_CHAT_ENABLED).
-- Idempotent and additive only: three new tables, nothing existing is touched.
--
-- Mirrors supportContacts, supportTickets and supportTicketReads in
-- packages/db/src/schema.ts; keep the two in sync.
--
-- One ticket is one Chatwoot conversation in the "Business support" API inbox.
-- Chatwoot stays the source of truth for messages; these tables hold only what
-- the business app needs to list, scope and badge tickets without calling
-- Chatwoot for every row.

-- One Chatwoot contact per business user (not per org), so the support team
-- sees who wrote. `source_id` is the Client API credential for that contact's
-- conversations and is only ever read on the server.
CREATE TABLE IF NOT EXISTS support_contacts (
  user_id             text        PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  chatwoot_contact_id bigint      NOT NULL,
  source_id           text        NOT NULL,
  -- Subscribes the browser to this contact's websocket room.
  pubsub_token        text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tickets belong to the org and outlive the member who opened them.
  organization_id          text        NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  property_id              uuid        NULL REFERENCES properties(id) ON DELETE SET NULL,
  opened_by_user_id        text        NULL REFERENCES "user"(id) ON DELETE SET NULL,
  -- Chatwoot's per-account display id: the id every Chatwoot API and webhook
  -- uses, and the `#1234` reference shown to hosts.
  chatwoot_conversation_id bigint      NOT NULL UNIQUE,
  category                 text        NOT NULL,
  linked_type              text        NULL CHECK (linked_type IN ('booking', 'listing')),
  linked_id                text        NULL,
  follow_up_of             uuid        NULL REFERENCES support_tickets(id) ON DELETE SET NULL,
  title                    text        NOT NULL,
  -- Chatwoot's conversation status, kept in step by the webhook.
  status                   text        NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending', 'open', 'snoozed', 'resolved')),
  last_message_at          timestamptz NULL,
  -- One line, already trimmed. Never shown outside the authenticated app.
  last_message_preview     text        NULL,
  last_message_sender      text        NULL CHECK (last_message_sender IN ('contact', 'agent_bot', 'user')),
  -- Ordering key for every list: the newest of creation and last message.
  last_activity_at         timestamptz NOT NULL DEFAULT now(),
  -- First move to the support team, and the last resolve. They place the
  -- "went to the support team" and "resolved" lines in the chat.
  handed_off_at            timestamptz NULL,
  resolved_at              timestamptz NULL,
  -- Last reply-notification email, for the one-per-ticket-per-hour cap.
  last_notified_at         timestamptz NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);

CREATE INDEX IF NOT EXISTS support_tickets_org_activity_idx
  ON support_tickets (organization_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_opener_activity_idx
  ON support_tickets (opened_by_user_id, last_activity_at DESC);

-- Per-user read state. Unread = the last message is from the assistant or a
-- person and is newer than this user's last_seen_at.
CREATE TABLE IF NOT EXISTS support_ticket_reads (
  ticket_id    uuid        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id      text        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (ticket_id, user_id)
);

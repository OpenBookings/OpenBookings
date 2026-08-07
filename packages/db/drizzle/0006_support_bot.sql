-- 0006_support_bot — tables backing apps/support-bot.
--
-- Apply BY HAND (psql or the Neon SQL editor). This repo has no drizzle
-- journal, so `bun run db:migrate` does not track these files and must not be
-- used to apply this. Every statement is IF NOT EXISTS / idempotent, so
-- re-running it against an already-migrated database is a no-op.
--
-- Mirrors the definitions in packages/db/src/schema.ts (processedEvents,
-- supportContextCache); keep the two in sync.

-- Idempotency ledger for the Chatwoot webhook. One row per Chatwoot event,
-- keyed `message_created:<message_id>`.
--
-- The webhook inserts ON CONFLICT DO NOTHING before enqueueing, so a
-- duplicate delivery never enqueues a second Cloud Task. The task handler
-- sets replied_at after posting to Chatwoot, so a Cloud Tasks retry never
-- produces a second guest-facing reply.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id     text        PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now(),
  -- Null until a guest-facing reply (or escalation note) was posted.
  replied_at   timestamptz
);

-- Supports pruning old ledger rows; the table is append-only and otherwise
-- only ever read by primary key.
CREATE INDEX IF NOT EXISTS processed_events_processed_at_idx
  ON processed_events (processed_at);

-- Recent conversation turns per Chatwoot conversation, so each webhook does
-- not re-fetch the full history from the Chatwoot API. Staleness is enforced
-- at read time against updated_at (6h TTL in the app), not by a constraint.
CREATE TABLE IF NOT EXISTS support_context_cache (
  -- Chatwoot conversation id (their ids are integers).
  conversation_id bigint      PRIMARY KEY,
  -- [{ "role": "user" | "assistant", "content": string }, ...], oldest first.
  turns           jsonb       NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Supports evicting entries that aged out of the TTL.
CREATE INDEX IF NOT EXISTS support_context_cache_updated_at_idx
  ON support_context_cache (updated_at);

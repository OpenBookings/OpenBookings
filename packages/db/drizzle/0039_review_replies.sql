-- 0039_review_replies — replies to guest reviews.
--
-- A host answers a review publicly or privately.
--
--   review_replies    the public thread under a review: host, guest, host
--                     (the order lives in @openbookings/pricing,
--                     nextReplyRole). Only the review's own guest and the
--                     property's team write in it. A deleted reply keeps its
--                     row without its content.
--   messages.review_id
--                     a private reply is an ordinary message in the
--                     booking's conversation; this links it to the review it
--                     answers.
--   reviews.reply_skipped_at / reply_skipped_by
--                     the host decided this review needs no reply. It
--                     counts as handled until the thread moves on.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS review_replies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id       uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  author_role     text NOT NULL CHECK (author_role IN ('host', 'guest')),
  -- Better Auth user id of whoever wrote (or last edited) it. Never shown publicly.
  author_user_id  text NULL,
  -- NULL only on a deleted reply.
  body            text NULL CHECK (char_length(body) <= 1000),
  status          text NOT NULL CHECK (status IN ('pending', 'published', 'hidden', 'deleted')),
  -- Why the automated check held it back for a person.
  flagged_reason  text NULL,
  published_at    timestamptz NULL,
  edited_at       timestamptz NULL,
  deleted_at      timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_replies_body_unless_deleted CHECK (status = 'deleted' OR body IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_review_replies_review ON review_replies (review_id, created_at);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS review_id uuid NULL REFERENCES reviews(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_review ON messages (review_id) WHERE review_id IS NOT NULL;

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reply_skipped_at timestamptz NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reply_skipped_by text NULL;

-- 0061_review_moderation — moderating reviews and replies by their words.
--
-- Every review and reply is checked before it publishes (a regex screen, and
-- Mistral once Task 4 lands). A clean text publishes; anything else is held
-- for a person in the admin console, who keeps or removes it. Nobody edits
-- anyone's words. The constants (72-hour deadline, 12-month retention, the
-- rule ids, the "[removed]" mask) live in @openbookings/pricing
-- (moderation.ts); the functions in packages/db/src/reviews/moderation.ts.
--
-- On reviews and review_replies:
--
--   flagged_fragments   the exact pieces of text the check objected to
--                       (a JSON array of strings). Masked at the deadline.
--   masked_body         the text as published by the deadline, each flagged
--                       fragment replaced by "[removed]". Public reads show
--                       coalesce(masked_body, body), never the original.
--                       A Keep clears it: a person judged the words fine.
--   check_source        who checked it: 'regex', 'mistral', or 'unchecked'
--                       (the model failed or timed out; the cron rechecks).
--   checked_at          when that check ran. NULL while unchecked.
--   decision ...        a moderator's Keep or Remove: the rules it broke, a
--                       note, who decided and when. decided_at is the
--                       compare-and-set guard: a second decision finds it set.
--   published_by_deadline
--                       nobody decided within 72 hours, so it published
--                       masked. It stays in the queue until somebody does,
--                       and stays true after a decision, as history.
--
-- reviews.rewrite_used: a guest whose review was removed may write it once
-- more (the same row, within the 30-day window). A second removal ends it.
--
-- review_replies may now be 'removed' too. A removed reply keeps its row, so
-- the thread's turn order (nextReplyRole counts every reply that isn't
-- 'deleted') never shifts under the host and guest; after 12 months it keeps
-- the row without its text, like a deleted one.
--
-- review_reports: a host or a member of the public reports a published review
-- or reply against one rule. One open report per reporter per item.
-- After 12 months (purgeModerationRecords): reports go (closed ones counted
-- from the decision, open ones from when they were made); removed items lose
-- their text (from the decision); an item published masked by the deadline
-- that nobody decided keeps only the masked text (from its publication). A
-- kept item is published as written and has nothing to purge.
--
-- Grants. ob_admin_read reads the three tables (the queue); ob_admin_write
-- reads them and changes only what a decision changes. The apps (ob_app) and
-- the crons (ob_system) reach the new columns through their existing table
-- grants on reviews and review_replies; review_reports gets explicit grants
-- and row-level security like every app table since 0049.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Moderation columns on reviews and review_replies
-- ---------------------------------------------------------------------------

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS flagged_fragments jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS masked_body text NULL,
  ADD COLUMN IF NOT EXISTS check_source text NULL CHECK (check_source IN ('regex', 'mistral', 'unchecked')),
  ADD COLUMN IF NOT EXISTS checked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS decision text NULL CHECK (decision IN ('kept', 'removed')),
  ADD COLUMN IF NOT EXISTS decision_rules text[] NULL,
  ADD COLUMN IF NOT EXISTS decision_note text NULL,
  ADD COLUMN IF NOT EXISTS decided_by text NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS published_by_deadline boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rewrite_used boolean NOT NULL DEFAULT false;

ALTER TABLE review_replies
  ADD COLUMN IF NOT EXISTS flagged_fragments jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS masked_body text NULL,
  ADD COLUMN IF NOT EXISTS check_source text NULL CHECK (check_source IN ('regex', 'mistral', 'unchecked')),
  ADD COLUMN IF NOT EXISTS checked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS decision text NULL CHECK (decision IN ('kept', 'removed')),
  ADD COLUMN IF NOT EXISTS decision_rules text[] NULL,
  ADD COLUMN IF NOT EXISTS decision_note text NULL,
  ADD COLUMN IF NOT EXISTS decided_by text NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS published_by_deadline boolean NOT NULL DEFAULT false;

-- Items held before this migration were never checked the new way: no
-- fragments, so the deadline would publish them unmasked. Mark them
-- 'unchecked' so the recheck finds their fragments first; publishOverdue
-- never publishes an item whose check_source is NULL.
UPDATE reviews SET check_source = 'unchecked' WHERE status = 'pending' AND check_source IS NULL;
UPDATE review_replies SET check_source = 'unchecked' WHERE status = 'pending' AND check_source IS NULL;

-- A reply can be removed by a moderator, and a removed reply loses its text
-- after 12 months (see above).
ALTER TABLE review_replies DROP CONSTRAINT IF EXISTS review_replies_status_check;
ALTER TABLE review_replies ADD CONSTRAINT review_replies_status_check
  CHECK (status IN ('pending', 'published', 'hidden', 'removed', 'deleted'));
ALTER TABLE review_replies DROP CONSTRAINT IF EXISTS review_replies_body_unless_deleted;
ALTER TABLE review_replies ADD CONSTRAINT review_replies_body_unless_deleted
  CHECK (status IN ('deleted', 'removed') OR body IS NOT NULL);

-- The deadline job and the recheck look for held items by age.
CREATE INDEX IF NOT EXISTS idx_review_replies_pending ON review_replies (created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS review_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id         uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  -- Set when the report is about a reply under the review.
  reply_id          uuid NULL REFERENCES review_replies(id) ON DELETE CASCADE,
  reporter_kind     text NOT NULL CHECK (reporter_kind IN ('host', 'public')),
  -- host: the reporting member and their organization. public: an optional
  -- email for the outcome (a signed-in reporter may also have a user id).
  reporter_user_id  text NULL,
  reporter_org_id   text NULL,
  reporter_email    text NULL,
  rule              text NOT NULL
                    CHECK (rule IN ('abuse', 'threat', 'personal_details', 'links_contact', 'off_topic', 'conflict_of_interest')),
  note              text NULL CHECK (char_length(note) <= 1000),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  decided_at        timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- One open report per reporter per item: a host by organization, the public
-- by email (or user id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_reports_open_per_reporter
  ON review_reports (review_id, coalesce(reply_id::text, ''), coalesce(reporter_org_id, reporter_email, reporter_user_id))
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_review_reports_open ON review_reports (status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports (review_id);

-- ---------------------------------------------------------------------------
-- App roles (0049): explicit grants, row-level security
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON review_reports TO ob_app, ob_system;

ALTER TABLE review_reports ENABLE ROW LEVEL SECURITY;

-- A host's own reports on the properties it reads. Reporters' emails and
-- other hosts' reports stay out of reach; the review's guest sees none.
DROP POLICY IF EXISTS ob_app_host ON review_reports;
CREATE POLICY ob_app_host ON review_reports FOR ALL TO ob_app
  USING (reporter_kind = 'host' AND EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_reports.review_id
      AND r.property_id = ANY ((SELECT app.readable_property_ids())::uuid[])
  ))
  WITH CHECK (reporter_kind = 'host' AND EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_reports.review_id
      AND r.property_id = ANY ((SELECT app.readable_property_ids())::uuid[])
  ));

-- Anyone may report what is public: insert only, never read back.
DROP POLICY IF EXISTS ob_app_public_insert ON review_reports;
CREATE POLICY ob_app_public_insert ON review_reports FOR INSERT TO ob_app
  WITH CHECK (reporter_kind = 'public' AND EXISTS (
    SELECT 1 FROM reviews r WHERE r.id = review_reports.review_id AND r.status = 'published' AND r.deleted_at IS NULL
  ));

-- Closing a deleted item's reports. The guest who deletes a review, or the
-- host who deletes a reply, can't see the other reports on it under the
-- policies above (other hosts', the public's), so a plain UPDATE would skip
-- them. This function closes them, and nothing else:
--   - only open reports, only on an item that is actually 'deleted' (a whole
--     review with p_reply_id NULL, else that one reply);
--   - only for the review's guest or a reader of its property (app.user_id),
--     or for a role row-level security doesn't bind anyway (the owner the
--     apps connect as until they switch roles, a superuser, BYPASSRLS).
-- The invoker is read from the `role` setting (SET ROLE, or a login role's
-- default) or else session_user: inside SECURITY DEFINER current_user is the
-- owner. A role can only set `role` to a role it may become.
CREATE OR REPLACE FUNCTION app.dismiss_deleted_review_reports(p_review_id uuid, p_reply_id uuid, p_now timestamptz)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  invoker text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  closed integer;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_roles r
        WHERE r.rolname = invoker
          AND (r.rolsuper OR r.rolbypassrls OR r.oid = (SELECT c.relowner FROM pg_class c WHERE c.oid = 'public.review_reports'::regclass))
     )
     AND NOT EXISTS (
       SELECT 1 FROM reviews rv
        WHERE rv.id = p_review_id AND app.user_id() IS NOT NULL
          AND (rv.guest_user_id = app.user_id() OR rv.property_id = ANY (app.readable_property_ids()))
     ) THEN
    RAISE EXCEPTION 'not allowed to close the reports on review %', p_review_id USING ERRCODE = '42501';
  END IF;

  UPDATE review_reports rr
     SET status = 'dismissed', decided_at = p_now
   WHERE rr.status = 'open' AND rr.review_id = p_review_id
     AND CASE
           WHEN p_reply_id IS NULL THEN
             EXISTS (SELECT 1 FROM reviews rv WHERE rv.id = p_review_id AND rv.status = 'deleted')
           ELSE
             rr.reply_id = p_reply_id
             AND EXISTS (SELECT 1 FROM review_replies x WHERE x.id = p_reply_id AND x.review_id = p_review_id AND x.status = 'deleted')
         END;
  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END
$$;
REVOKE ALL ON FUNCTION app.dismiss_deleted_review_reports(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dismiss_deleted_review_reports(uuid, uuid, timestamptz) TO ob_app;

-- ---------------------------------------------------------------------------
-- Admin roles (0054)
-- ---------------------------------------------------------------------------

-- The queue and the item pages.
GRANT SELECT ON reviews, review_replies, review_reports TO ob_admin_read;

-- Keep and Remove (decideItem): the decision, the status it sets, and the
-- reports it closes. Nothing else, and never the text itself.
GRANT SELECT ON reviews, review_replies, review_reports TO ob_admin_write;
GRANT UPDATE (status, published_at, masked_body, decision, decision_rules, decision_note, decided_by, decided_at,
              published_by_deadline, updated_at)
  ON reviews, review_replies TO ob_admin_write;
GRANT UPDATE (status, decided_at) ON review_reports TO ob_admin_write;

-- 0038_guest_reviews — verified guest reviews (roadmap 6.3).
--
-- One review per booking that actually took place. The rules for who may
-- review what live in @openbookings/pricing (reviews.ts); these tables only
-- hold the result.
--
--   reviews             one row per reviewed booking. A review the guest
--                       deletes stays as a 'deleted' row without its content,
--                       so the booking cannot be reviewed again (that would
--                       be an edit by another name).
--   review_invitations  the email state per booking: host heads-up,
--                       invitation, reminder. Claimed before each send, so
--                       two overlapping cron runs never send twice.
--   review_tokens       the emailed links. Only the SHA-256 of a token is
--                       stored. A token lets its holder write the one review
--                       for its booking, nothing else: no session, no sign-in.
--
-- guest_profile gains review_emails_opt_out_at: no invitations or reminders
-- while it is set.
--
-- Apply by hand / CI. Additive: safe for the code running before this
-- deploy. Re-runnable.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- Better Auth user id. NULL once the author's account is deleted (anonymized).
  guest_user_id   text NULL,
  -- NULL only on a deleted review.
  score           smallint NULL CHECK (score BETWEEN 1 AND 10),
  body            text NULL CHECK (char_length(body) <= 2000),
  language        text NULL,
  -- Snapshots shown publicly: first name and country, never exact dates.
  author_name     text NOT NULL,
  author_country  char(2) NULL,
  stay_month      date NOT NULL,
  room_label      text NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'published', 'hidden', 'removed', 'deleted')),
  -- Why the automated check held it back for a person (e.g. 'url,phone_number').
  flagged_reason  text NULL,
  -- How it was written: the guest's session or an emailed link.
  submitted_via   text NOT NULL CHECK (submitted_via IN ('session', 'token')),
  published_at    timestamptz NULL,
  deleted_at      timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_score_unless_deleted CHECK (status = 'deleted' OR score IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_reviews_property_published
  ON reviews (property_id, published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_reviews_guest ON reviews (guest_user_id) WHERE guest_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_pending ON reviews (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS review_invitations (
  booking_id        uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  -- The check-out-day email asking the host to mark no-shows before invitations go out.
  host_warned_at    timestamptz NULL,
  sent_at           timestamptz NULL,
  reminder_sent_at  timestamptz NULL,
  -- Set while a run is sending; a claim older than an hour is treated as abandoned.
  claimed_at        timestamptz NULL,
  attempts          smallint NOT NULL DEFAULT 0,
  last_error        text NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_invitations_reminder
  ON review_invitations (sent_at) WHERE reminder_sent_at IS NULL AND sent_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS review_tokens (
  token_hash  bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_tokens_booking ON review_tokens (booking_id);

ALTER TABLE guest_profile ADD COLUMN IF NOT EXISTS review_emails_opt_out_at timestamptz NULL;

-- The invitation job looks up stays by check-out date.
CREATE INDEX IF NOT EXISTS idx_bookings_check_out ON bookings (check_out_date);

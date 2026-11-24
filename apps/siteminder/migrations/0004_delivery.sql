SET LOCAL lock_timeout = '5s';

-- Delivering bookings to SiteMinder (one message per booking in flight) and telling core how it went.
--   claim_token     the send in flight: set when a tick takes the row ('sending'), checked when it writes the
--                   result back, so a send whose claim ran out (next_attempt_at) cannot overwrite a newer one.
--   acked_at        when SiteMinder acknowledged the latest successful message (Commit, Modify or Cancel).
--   report          the delivery report core should hold for this booking (the last state change).
--   report_pending  that report has not reached core yet; the next tick tries again.
ALTER TABLE siteminder.outbox
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS acked_at timestamptz,
  ADD COLUMN IF NOT EXISTS report jsonb,
  ADD COLUMN IF NOT EXISTS report_pending boolean NOT NULL DEFAULT false;

-- The tick's view: rows to send (waiting, retries and stale claims by time) and reports still owed to core.
CREATE INDEX IF NOT EXISTS outbox_due_idx ON siteminder.outbox (installation_id, next_attempt_at)
  WHERE status IN ('waiting', 'retrying', 'sending');
CREATE INDEX IF NOT EXISTS outbox_report_pending_idx ON siteminder.outbox (installation_id) WHERE report_pending;

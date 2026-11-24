SET LOCAL lock_timeout = '5s';

-- The version of the first Commit sent while nothing is acked yet, recorded before the send: a timeout, network
-- error or 5xx leaves unknown whether SiteMinder took it, and it ignores a repeated Commit ID. When a Commit is
-- finally acked it is acked at this version, so a Modify with the latest data follows. Cleared on that ack.
ALTER TABLE siteminder.outbox ADD COLUMN IF NOT EXISTS commit_attempt_version bigint;

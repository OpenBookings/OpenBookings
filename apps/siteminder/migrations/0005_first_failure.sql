SET LOCAL lock_timeout = '5s';

-- When the message now being delivered first failed (transiently). Transient failures are retried until 30
-- minutes after it; cleared on success and when a newer version replaces the message.
ALTER TABLE siteminder.outbox ADD COLUMN IF NOT EXISTS first_failed_at timestamptz;

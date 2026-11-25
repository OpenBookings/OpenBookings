SET LOCAL lock_timeout = '5s';

-- When we last alerted about an inbox message that keeps failing: the alert goes out at the 5th failure in a
-- row and then at most once an hour, not on every retry.
ALTER TABLE siteminder.inbox ADD COLUMN IF NOT EXISTS alerted_at timestamptz;

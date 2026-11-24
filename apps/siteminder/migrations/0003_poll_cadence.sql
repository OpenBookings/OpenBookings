SET LOCAL lock_timeout = '5s';

-- When the tick last asked core for booking changes for this installation (set when it starts, so a core that
-- is down is asked once per poll interval, not on every tick).
ALTER TABLE siteminder.installations ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;

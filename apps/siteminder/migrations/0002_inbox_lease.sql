SET LOCAL lock_timeout = '5s';

-- One tick at a time per installation works through its inbox, so its messages reach core in arrival
-- order. A lease rather than a held row lock: nothing stays open while core is called, and a tick that
-- dies just lets the lease run out.
ALTER TABLE siteminder.installations
  ADD COLUMN IF NOT EXISTS inbox_lease_token uuid,
  ADD COLUMN IF NOT EXISTS inbox_lease_until timestamptz;

-- The tick's and the health check's view: unprocessed messages per installation, in arrival order.
CREATE INDEX IF NOT EXISTS inbox_unprocessed_idx ON siteminder.inbox (installation_id, id) WHERE processed_at IS NULL;

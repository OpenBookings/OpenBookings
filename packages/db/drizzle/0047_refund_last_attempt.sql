-- 0047_refund_last_attempt — when a refund row was last sent to Stripe.
--
-- Stamped just before every Stripe call for the row, and when a retry claims
-- it. A retry skips a `pending` row attempted in the last five minutes and
-- re-sends under the original idempotency key while Stripe remembers it; a
-- concurrent duplicate on the same key is treated as uncertain, not refused.
--
--   refunds.last_attempt_at  null until the row is first sent (and for rows
--                            made before this migration: their created_at counts)
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

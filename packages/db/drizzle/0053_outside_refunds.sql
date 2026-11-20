-- 0053_outside_refunds — money that left a booking outside OpenBookings.
--
-- A host can refund a guest in their own Stripe Dashboard, or lose a dispute.
-- The business app's Stripe webhook flags both for staff (audit_log
-- `payment.refund-outside-openbookings` / `payment.dispute-lost`) and now also
-- writes them onto the booking, as a `refunds` row, so everything that reads a
-- booking's refunds (what is left to refund, the host's reservation page, the
-- DAC7 consideration) knows the money is gone.
--
--   refunds.source              'openbookings' (default: every row so far),
--                               'stripe_dashboard' (the host refunded in their own
--                               Stripe, or on their own keys) or 'dispute' (lost)
--   refunds.reason              now NULL for outside rows, and only for them:
--                               OpenBookings did not decide why that money went
--   refunds.split_explained_at  when staff entered the host's explanation: how
--   refunds.split_explained_by  much was room price and how much tourist tax
--
-- An outside row is written `succeeded` (Stripe already moved the money), with
-- `idempotency_key` '<source>:<Stripe refund or dispute id>', so a redelivered
-- webhook writes nothing new, and `created_at` set to when Stripe made the
-- refund or the dispute was lost. Until it is explained the whole amount sits
-- in `accommodation_amount` and `tourist_tax_amount` is 0: it counts against
-- the room price, and `split_explained_at IS NULL` says that is a guess.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'openbookings';
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS split_explained_at timestamptz;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS split_explained_by text;

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_source_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_source_check
  CHECK (source IN ('openbookings', 'stripe_dashboard', 'dispute'));

-- OpenBookings' own refunds always say why; outside ones never do.
ALTER TABLE refunds ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_reason_by_source;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_by_source
  CHECK ((source = 'openbookings') = (reason IS NOT NULL));

-- Only an outside row can be explained.
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_split_explained;
ALTER TABLE refunds ADD CONSTRAINT refunds_split_explained
  CHECK (split_explained_at IS NULL OR source <> 'openbookings');

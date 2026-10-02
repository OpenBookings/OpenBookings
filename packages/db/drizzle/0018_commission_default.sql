-- 0018_commission_default — the commission is 4.5%.
--
-- Apply BY HAND, same as every file here. Idempotent.
--
-- The column default was 0.035 while the Partner Agreement, the marketing
-- site and the host dashboard all said 4.5%. Existing rows were already
-- corrected by hand; this fixes what a NEW property gets. Mirrors
-- `properties.commissionRate` in packages/db/src/schema.ts.

ALTER TABLE properties ALTER COLUMN commission_rate SET DEFAULT 0.045;

-- A commission rate is a fraction, not a percentage: 0.045, never 4.5. A rate
-- of 1 or more would be refused at checkout and make the property unbookable,
-- so refuse it here, where the mistake is made.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'properties_commission_rate_range'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_commission_rate_range
      CHECK (commission_rate >= 0 AND commission_rate < 0.5);
  END IF;
END $$;

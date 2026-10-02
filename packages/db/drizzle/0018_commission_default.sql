-- 0018_commission_default — the commission is 4.5%.
--
-- Apply BY HAND, same as every file here. Idempotent.
--
-- The column default was 0.035 while the Partner Agreement, the marketing
-- site and the host dashboard all said 4.5%. Existing rows were already
-- corrected by hand; this fixes what a NEW property gets. Mirrors
-- `properties.commissionRate` in packages/db/src/schema.ts.

ALTER TABLE properties ALTER COLUMN commission_rate SET DEFAULT 0.045;

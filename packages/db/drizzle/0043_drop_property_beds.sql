-- 0043_drop_property_beds — cots and extra beds are set per room now (0040).
--
-- The property-wide "Children & beds" policy (property_content.cot_policy,
-- cot_fee, extra_bed_fee) is no longer edited or shown: each room says how
-- many cots and extra beds it takes and what they cost, paid at the hotel.
-- children_welcome stays: it is still property-wide. Dev only, so the
-- columns are dropped with no copy.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE property_content DROP COLUMN IF EXISTS cot_policy;
ALTER TABLE property_content DROP COLUMN IF EXISTS cot_fee;
ALTER TABLE property_content DROP COLUMN IF EXISTS extra_bed_fee;
DROP TYPE IF EXISTS cot_policy;

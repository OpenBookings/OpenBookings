-- 0021_platform_payments_only — every payment goes through the platform.
--
-- Apply BY HAND (psql or the Neon SQL editor). Idempotent. Order against the
-- deploy does not matter: the editor no longer offers cash or a prepayment
-- switch, and this brings the rows already saved into line with that.
--
-- Guests pay on OpenBookings when they book. There is no cash, at the property
-- or anywhere else, so prepayment is not a host's choice: it is always true.

-- Retire cash from the catalogue rather than deleting it. The listing page
-- only renders active methods, so this alone stops guests seeing it.
UPDATE "payment_methods" SET "is_active" = false WHERE "code" = 'cash';

-- Drop cash from hosts' saved selections, so the editor never loads a method
-- it no longer offers (the save schema would reject it).
UPDATE "property_content"
SET "payment_methods" = array_remove("payment_methods", 'cash')
WHERE 'cash' = ANY("payment_methods");

UPDATE "property_content" SET "prepayment_required" = true WHERE NOT "prepayment_required";
ALTER TABLE "property_content" ALTER COLUMN "prepayment_required" SET DEFAULT true;

-- A refund amount of NaN is a valid `numeric` and satisfies refunds_amount_sum
-- (NaN = NaN + 0 and NaN >= 0 are both true in Postgres, which sorts NaN above
-- every number and treats it as equal to itself). One such row turns
-- SUM(amount) for its booking into NaN, which breaks every later guest or host
-- cancellation refund on that booking. Reject it in the database as well as in
-- the application (planGoodwill / hostGoodwillRefund).
--
-- NOT VALID enforces the rule for new and updated rows without scanning (or
-- failing on) existing ones. The VALIDATE below is attempted; if a NaN row
-- already exists it warns instead of failing the migration, so fix that row
-- (SELECT id FROM refunds WHERE amount = 'NaN') and re-run the VALIDATE.
DO $$ BEGIN
  ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_amounts_finite" CHECK (
      "amount" <> 'NaN'::numeric
      AND "accommodation_amount" <> 'NaN'::numeric
      AND "tourist_tax_amount" <> 'NaN'::numeric
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "refunds" VALIDATE CONSTRAINT "refunds_amounts_finite";
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'refunds_amounts_finite left NOT VALID: refunds rows with NaN amounts exist';
END $$;

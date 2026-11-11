-- 0041_modifier_discount_sign — a discount is always stored as a negative amount.
--
-- length_of_stay and early_bird rules lower the price. The pricing engine
-- used to add adjustment_value as stored, so a discount saved as +10 raised
-- the price instead. Existing positive rows are flipped, and the sign is now
-- a constraint. Surcharges (day_of_week, last_minute) may go either way.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

UPDATE rate_modifiers
SET adjustment_value = -adjustment_value
WHERE type IN ('length_of_stay', 'early_bird') AND adjustment_value > 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_modifiers_discount_sign') THEN
    ALTER TABLE rate_modifiers
      ADD CONSTRAINT rate_modifiers_discount_sign
      CHECK (type NOT IN ('length_of_stay', 'early_bird') OR adjustment_value < 0);
  END IF;
END $$;

-- 0042_infants_pay_at_property — infants, cots and extra beds paid at the hotel, percent-only discounts.
--
-- Infants (under 2) take no place in the room and pay no fee, but the hotel
-- needs to know they're coming: at most 4 per room.
--
-- Cots and extra beds are paid at the property, the one thing a guest doesn't
-- prepay. What the guest owes the hotel for them is fixed at booking time, so a
-- later fee change doesn't move it. It's never part of stay_total /
-- total_amount, the charge, commission, tourist tax or refunds.
--
-- The stay discount that applied (a percentage) is kept on the intent room, so
-- checkout can show "Weekly discount −€42". stay_total is already after it.
--
-- Discounts (length_of_stay, early_bird) are percentages only. Fixed amounts
-- are only for per-night surcharges. Existing flat discount rows are dev data
-- and are deleted.
--
--   booking_intent_rooms / reservations .infants                 0–4
--   booking_intent_rooms / reservations .pay_at_property_amount  euros, ≥ 0
--   booking_intent_rooms .discount_label / .discount_amount       NULL when no discount
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS infants smallint NOT NULL DEFAULT 0 CHECK (infants BETWEEN 0 AND 4);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS infants smallint NOT NULL DEFAULT 0 CHECK (infants BETWEEN 0 AND 4);

ALTER TABLE booking_intent_rooms
  ADD COLUMN IF NOT EXISTS pay_at_property_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (pay_at_property_amount >= 0);
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS pay_at_property_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (pay_at_property_amount >= 0);

ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS discount_label text NULL;
ALTER TABLE booking_intent_rooms
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NULL CHECK (discount_amount > 0);

DELETE FROM rate_modifiers
WHERE type IN ('length_of_stay', 'early_bird') AND adjustment_type = 'flat';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_modifiers_discount_percent') THEN
    ALTER TABLE rate_modifiers
      ADD CONSTRAINT rate_modifiers_discount_percent
      CHECK (type NOT IN ('length_of_stay', 'early_bird') OR adjustment_type = 'percent');
  END IF;
END $$;

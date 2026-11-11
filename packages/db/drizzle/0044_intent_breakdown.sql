-- 0044_intent_breakdown — the price breakdown, kept on the intent room for checkout.
--
-- Checkout shows how each room's price is made up: base rate per night, guests
-- above base occupancy, and the cots / extra beds paid at the property. These
-- are fixed when the rooms are held, like the nights themselves, so a later
-- rate change doesn't move what the guest was shown.
--
--   rate_nights            [{ date, price }]  base rate per night, before extra guests and discount
--   extra_guests           [{ kind, count, per_night, nights, amount }]  already in stay_total
--   pay_at_property_lines  [{ label, count, fee_per_night, nights, amount }]  not in stay_total
--
-- Intents made before this migration read as empty arrays.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS rate_nights jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS extra_guests jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS pay_at_property_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

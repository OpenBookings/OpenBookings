-- 0045_vat_split — the VAT inside each booked night, for the host's bookkeeping.
--
-- Every night of a room is split into room and breakfast, each with its own VAT
-- rate. The split is worked out when the intent is priced, kept on the intent
-- room and copied to the reservation on confirmation. Guests never see it.
--
--   properties.accommodation_type  what kind of lodging, which sets the VAT rates ('hotel' for now)
--   properties.breakfast_value     euros per person per night, VAT-inclusive; null = not given
--   *.vat_split                    { nights, totals, breakfastValueMissing }; null when the
--                                  country has no rates, and for bookings made before this migration
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE properties ADD COLUMN IF NOT EXISTS accommodation_type text NOT NULL DEFAULT 'hotel';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS breakfast_value numeric(10,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_accommodation_type_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_accommodation_type_check
      CHECK (accommodation_type IN ('hotel'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_breakfast_value_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_breakfast_value_check
      CHECK (breakfast_value >= 0);
  END IF;
END $$;

ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS vat_split jsonb;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS vat_split jsonb;

-- 0040_room_occupancy_extras — what a room's rate includes, and what goes on top.
--
-- rooms.base_occupancy is the number of guests the rate is for. Guests above
-- it pay a per-night fee, set separately for adults and children; adults fill
-- the included places first. Cots and extra beds are per room: how many fit
-- (0 = not offered), the fee per night (0 = free), and whether a cot and an
-- extra bed can be in the room at the same time. None of these fees are
-- discounted: they are added after the rate modifiers (@openbookings/pricing).
--
--   rooms.extra_adult_fee / extra_child_fee   whole euros per guest per night; NULL = not charged
--   rooms.cots_max / extra_beds_max           0–4
--   rooms.cot_fee / extra_bed_fee             whole euros per night; NULL when not offered
--   rooms.cot_and_extra_bed_together          false = one or the other
--   booking_intent_rooms / reservations .cots / .extra_beds
--                                             what the guest booked, priced into the nights
--
-- base_occupancy can no longer exceed the room's max guests.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS extra_adult_fee bigint NULL CHECK (extra_adult_fee >= 0);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS extra_child_fee bigint NULL CHECK (extra_child_fee >= 0);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cots_max smallint NOT NULL DEFAULT 0 CHECK (cots_max BETWEEN 0 AND 4);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cot_fee bigint NULL CHECK (cot_fee >= 0);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS extra_beds_max smallint NOT NULL DEFAULT 0 CHECK (extra_beds_max BETWEEN 0 AND 4);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS extra_bed_fee bigint NULL CHECK (extra_bed_fee >= 0);
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cot_and_extra_bed_together boolean NOT NULL DEFAULT true;

UPDATE rooms
SET base_occupancy = max_adults + max_children
WHERE base_occupancy > max_adults + max_children;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rooms_base_occupancy_within_max') THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_base_occupancy_within_max CHECK (base_occupancy <= max_adults + max_children);
  END IF;
END $$;

ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS cots smallint NOT NULL DEFAULT 0 CHECK (cots BETWEEN 0 AND 4);
ALTER TABLE booking_intent_rooms ADD COLUMN IF NOT EXISTS extra_beds smallint NOT NULL DEFAULT 0 CHECK (extra_beds BETWEEN 0 AND 4);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS cots smallint NOT NULL DEFAULT 0 CHECK (cots BETWEEN 0 AND 4);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS extra_beds smallint NOT NULL DEFAULT 0 CHECK (extra_beds BETWEEN 0 AND 4);

-- 0022_pin_set_manually — remember when a host placed their map pin by hand.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent.
--
-- The listing editor moves the pin with the address: change the address and
-- the pin follows. A host who drags the pin to the right door has said the
-- address alone is not good enough, and a later edit to the street name must
-- not silently undo that. This flag is that statement, kept across sessions.
-- Existing pins default to false: nothing records how they were placed.

ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "pin_set_manually" boolean DEFAULT false NOT NULL;

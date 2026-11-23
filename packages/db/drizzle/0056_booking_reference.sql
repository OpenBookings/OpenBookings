-- 0056_booking_reference — a unique, readable reference for every booking.
--
-- Guests, hotels (and later their PMS) see a booking as `OB-B7B0-2A1C`: "OB"
-- plus the first 8 characters of the booking UUID. The reference is derived in
-- code (packages/db/src/booking-reference.ts), never stored. This migration
-- makes that 8-character prefix unique, so a reference always points at
-- exactly one booking:
--
--   * bookings_reference_key: a unique index on left(id::text, 8). Postgres
--     refuses a second booking with the same prefix, concurrent inserts too.
--   * app.new_booking_id(): the new default for bookings.id. It draws UUIDs
--     until the prefix is free, so a booking insert (which runs inside the
--     paid-checkout conversion) never hits the index in practice. SECURITY
--     DEFINER so it sees every booking, not just the caller's RLS view.
--
-- Stops before changing anything if two existing bookings already share a
-- prefix: those need resolving by hand first. Idempotent: safe to replay.

SET lock_timeout = '5s';

DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(prefix, ', ') INTO dupes FROM (
    SELECT left(id::text, 8) AS prefix FROM bookings
    GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Bookings share a reference prefix (%); resolve these before 0056', dupes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_reference_key ON bookings ((left(id::text, 8)));

CREATE OR REPLACE FUNCTION app.new_booking_id() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE candidate uuid;
BEGIN
  LOOP
    candidate := gen_random_uuid();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings WHERE left(id::text, 8) = left(candidate::text, 8)
    );
  END LOOP;
  RETURN candidate;
END
$$;

REVOKE ALL ON FUNCTION app.new_booking_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.new_booking_id() TO ob_app, ob_auth, ob_system;

ALTER TABLE bookings ALTER COLUMN id SET DEFAULT app.new_booking_id();

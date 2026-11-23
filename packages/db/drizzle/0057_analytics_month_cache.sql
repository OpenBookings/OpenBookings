-- 0057_analytics_month_cache — per-month analytics facts, and what empties them.
--
-- The business console's analytics are computed from bookings, reservations,
-- refunds, commission entries and room inventory. Computing a whole year on
-- every page view is slow, so each (hotel, month) is computed once and kept in
-- analytics_month_cache. A cached month is only worth anything if it is never
-- served stale, so every write that can change a month's numbers also empties
-- that month, in the same transaction, from a trigger. App code cannot forget.
--
-- Why a generation counter next to the cache: a build reads the month's
-- generation, computes, and may store its result only if the generation is
-- still the one it started from. A change that lands while a build is running
-- bumps the generation, so the late build is refused and a stale month is
-- never stored. Deleting the cache row alone would not stop that.
--
-- Which months a booking touches: the month it was booked (confirmed_at, else
-- created_at, in Europe/Amsterdam, the platform's reporting clock) and every
-- month of its stay (check_in_date .. check_out_date - 1 day). A change moves
-- numbers in all of them, old values and new values alike. Rows hanging off a
-- booking (reservations, refunds, commission entries) follow the booking;
-- commission entries without a booking (booking_id NULL) touch nothing.
-- room_inventory touches the month of its date; a change to a room's units,
-- creation or archiving moves occupancy in every month, so it touches the
-- whole hotel.
--
-- Hotel-wide changes (a room's units, creation or archiving) cannot name the
-- months they move, and a month that was never cached has no generation row
-- to bump. So analytics_touch_hotel also bumps a sentinel row of
-- analytics_month_generation with month = '0001-01-01'. The contract for
-- readers and builders: before a build, read BOTH the month's generation and
-- the hotel's sentinel generation (0 when the row is absent). The cache row
-- stores them as `generation` (the month generation) and `hotel_generation`
-- (the sentinel generation) at build time. A build may be stored, and a cached
-- row served, only when both still equal the values read before the build.
--
-- The trigger functions are SECURITY DEFINER: a guest cancelling their own
-- booking must still be able to empty the host's cache, which the guest's role
-- may not otherwise read or write. They keep a pinned search_path.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analytics_month_cache (
  hotel_id   uuid        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  month      date        NOT NULL,
  version    integer     NOT NULL,
  generation bigint      NOT NULL,
  hotel_generation bigint NOT NULL DEFAULT 0,
  facts      jsonb       NOT NULL,
  built_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, month)
);

CREATE TABLE IF NOT EXISTS analytics_month_generation (
  hotel_id   uuid   NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  month      date   NOT NULL,
  generation bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hotel_id, month)
);

ALTER TABLE analytics_month_cache ADD COLUMN IF NOT EXISTS hotel_generation bigint NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Touch functions
-- ---------------------------------------------------------------------------

-- Bump the generation of each given month (once, however often it is listed)
-- and drop its cache row.
CREATE OR REPLACE FUNCTION app.analytics_touch_months(p_hotel uuid, p_months date[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_hotel IS NULL OR p_months IS NULL THEN RETURN; END IF;
  INSERT INTO analytics_month_generation (hotel_id, month, generation)
  SELECT p_hotel, m, 1 FROM (SELECT DISTINCT unnest(p_months) AS m) t WHERE m IS NOT NULL
  ON CONFLICT (hotel_id, month)
  DO UPDATE SET generation = analytics_month_generation.generation + 1;
  DELETE FROM analytics_month_cache WHERE hotel_id = p_hotel AND month = ANY (p_months);
END;
$$;

-- Every month from the month of p_from to the month of p_to, inclusive.
CREATE OR REPLACE FUNCTION app.analytics_touch(p_hotel uuid, p_from date, p_to date) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT app.analytics_touch_months(
    p_hotel,
    ARRAY(SELECT g::date FROM generate_series(
      date_trunc('month', p_from), date_trunc('month', greatest(p_from, p_to)), interval '1 month') g)
  );
$$;

-- Every month the hotel has a cache row or a generation for, and the hotel sentinel.
CREATE OR REPLACE FUNCTION app.analytics_touch_hotel(p_hotel uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT app.analytics_touch_months(
    p_hotel,
    ARRAY(
      SELECT month FROM analytics_month_generation WHERE hotel_id = p_hotel
      UNION
      SELECT month FROM analytics_month_cache WHERE hotel_id = p_hotel
      UNION
      SELECT date '0001-01-01'
    )
  );
$$;

-- The months one booking row moves: its booked month and its stay months.
CREATE OR REPLACE FUNCTION app.analytics_booking_months(
  p_confirmed_at timestamptz, p_created_at timestamptz, p_check_in date, p_check_out date
) RETURNS date[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT ARRAY(
    SELECT date_trunc('month', (coalesce(p_confirmed_at, p_created_at) AT TIME ZONE 'Europe/Amsterdam')::date)::date
    UNION
    SELECT g::date FROM generate_series(
      date_trunc('month', p_check_in), date_trunc('month', greatest(p_check_in, p_check_out - 1)), interval '1 month') g
  );
$$;

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.analytics_bookings_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_months date[];
  new_months date[];
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_months := app.analytics_booking_months(OLD.confirmed_at, OLD.created_at, OLD.check_in_date, OLD.check_out_date);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_months := app.analytics_booking_months(NEW.confirmed_at, NEW.created_at, NEW.check_in_date, NEW.check_out_date);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.hotel_id IS DISTINCT FROM NEW.hotel_id THEN
    PERFORM app.analytics_touch_months(OLD.hotel_id, old_months);
    PERFORM app.analytics_touch_months(NEW.hotel_id, new_months);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM app.analytics_touch_months(OLD.hotel_id, old_months);
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM app.analytics_touch_months(NEW.hotel_id, new_months);
  ELSE
    PERFORM app.analytics_touch_months(NEW.hotel_id, old_months || new_months);
  END IF;
  RETURN NULL;
END;
$$;

-- reservations, refunds, commission_entries: follow the parent booking.
-- If the booking is already gone (a cascade from its own DELETE), the
-- bookings trigger has covered it.
CREATE OR REPLACE FUNCTION app.analytics_booking_child_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  b record;
  ids uuid[] := ARRAY[]::uuid[];
  bid uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.booking_id IS NOT NULL THEN ids := ids || OLD.booking_id; END IF;
  IF TG_OP <> 'DELETE' AND NEW.booking_id IS NOT NULL AND NOT (NEW.booking_id = ANY (ids)) THEN
    ids := ids || NEW.booking_id;
  END IF;
  FOREACH bid IN ARRAY ids LOOP
    SELECT hotel_id, confirmed_at, created_at, check_in_date, check_out_date INTO b FROM bookings WHERE bookings.id = bid;
    IF FOUND THEN
      PERFORM app.analytics_touch_months(
        b.hotel_id, app.analytics_booking_months(b.confirmed_at, b.created_at, b.check_in_date, b.check_out_date));
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.analytics_room_inventory_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  hotel uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT property_id INTO hotel FROM rooms WHERE id = OLD.room_id;
    PERFORM app.analytics_touch(hotel, OLD.date, OLD.date);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT property_id INTO hotel FROM rooms WHERE id = NEW.room_id;
    PERFORM app.analytics_touch(hotel, NEW.date, NEW.date);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.analytics_rooms_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM app.analytics_touch_hotel(OLD.property_id); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id) THEN
    PERFORM app.analytics_touch_hotel(NEW.property_id);
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS analytics_cache_bookings ON bookings;
CREATE TRIGGER analytics_cache_bookings
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  FOR EACH ROW EXECUTE FUNCTION app.analytics_bookings_changed();

DROP TRIGGER IF EXISTS analytics_cache_reservations ON reservations;
CREATE TRIGGER analytics_cache_reservations
  AFTER INSERT OR UPDATE OR DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION app.analytics_booking_child_changed();

DROP TRIGGER IF EXISTS analytics_cache_refunds ON refunds;
CREATE TRIGGER analytics_cache_refunds
  AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION app.analytics_booking_child_changed();

DROP TRIGGER IF EXISTS analytics_cache_commission_entries ON commission_entries;
CREATE TRIGGER analytics_cache_commission_entries
  AFTER INSERT OR UPDATE OR DELETE ON commission_entries
  FOR EACH ROW EXECUTE FUNCTION app.analytics_booking_child_changed();

DROP TRIGGER IF EXISTS analytics_cache_room_inventory ON room_inventory;
CREATE TRIGGER analytics_cache_room_inventory
  AFTER INSERT OR UPDATE OR DELETE ON room_inventory
  FOR EACH ROW EXECUTE FUNCTION app.analytics_room_inventory_changed();

DROP TRIGGER IF EXISTS analytics_cache_rooms_insert_delete ON rooms;
CREATE TRIGGER analytics_cache_rooms_insert_delete
  AFTER INSERT OR DELETE ON rooms
  FOR EACH ROW EXECUTE FUNCTION app.analytics_rooms_changed();

DROP TRIGGER IF EXISTS analytics_cache_rooms_update ON rooms;
CREATE TRIGGER analytics_cache_rooms_update
  AFTER UPDATE OF total_units, created_at, archived_at ON rooms
  FOR EACH ROW EXECUTE FUNCTION app.analytics_rooms_changed();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security (same form as 0049)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  app.analytics_touch_months(uuid, date[]),
  app.analytics_touch(uuid, date, date),
  app.analytics_touch_hotel(uuid),
  app.analytics_booking_months(timestamptz, timestamptz, date, date),
  app.analytics_bookings_changed(),
  app.analytics_booking_child_changed(),
  app.analytics_room_inventory_changed(),
  app.analytics_rooms_changed()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.analytics_touch(uuid, date, date),
  app.analytics_touch_hotel(uuid)
  TO ob_system;

GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_month_cache, analytics_month_generation TO ob_app, ob_system;

ALTER TABLE analytics_month_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_month_generation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ob_app_party ON analytics_month_cache;
CREATE POLICY ob_app_party ON analytics_month_cache FOR ALL TO ob_app
  USING (hotel_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  WITH CHECK (hotel_id = ANY ((SELECT app.readable_property_ids())::uuid[]));

DROP POLICY IF EXISTS ob_app_party ON analytics_month_generation;
CREATE POLICY ob_app_party ON analytics_month_generation FOR ALL TO ob_app
  USING (hotel_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
  WITH CHECK (hotel_id = ANY ((SELECT app.readable_property_ids())::uuid[]));

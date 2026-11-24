-- 0060_apps_api — the Apps API: what a connected app (SiteMinder) needs from core.
--
--   channel_code      properties, rooms and rate_plans get a stable, public code
--                     (letters and digits only) that a channel manager maps its
--                     own inventory to. Set on INSERT from the row id
--                     ('OB' + 10, 'R' + 11, 'P' + 11 upper-case hex characters), backfilled
--                     for existing rows, never changed afterwards.
--   app_installations one app per property at a time (partial unique index);
--                     only a hash of the app key is stored.
--   app_inventory, app_rates, app_restrictions
--                     what the app last pushed per night (ARI), kept apart from
--                     our own tables so hosts' data is never overwritten.
--   app_booking_delivery
--                     per installation and booking: did the app get it.
--   booking_events.txid, .seq
--                     a total order for the booking-event feed: events of one
--                     transaction share a txid, seq breaks ties across inserts.
--                     A delivery-relevant event puts the booking's delivered
--                     row back to pending (trigger app_delivery_booking_changed).
--
-- Privileges follow 0049/0057: ob_system (BYPASSRLS) reads and writes it all;
-- ob_app gets the installation and delivery tables behind property policies.
-- The ARI tables are written only by the Apps API (ob_system); ob_app may read
-- them, as it reads room_inventory, rate_overrides and rate_plan_restrictions,
-- because search, the quote and the host rates grid price and count from them.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Channel codes
-- ---------------------------------------------------------------------------

ALTER TABLE properties ADD COLUMN IF NOT EXISTS channel_code text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS channel_code text;
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS channel_code text;

UPDATE properties SET channel_code = 'OB' || upper(left(replace(id::text, '-', ''), 10)) WHERE channel_code IS NULL;
UPDATE rooms SET channel_code = 'R' || upper(left(replace(id::text, '-', ''), 11)) WHERE channel_code IS NULL;
UPDATE rate_plans SET channel_code = 'P' || upper(left(replace(id::text, '-', ''), 11)) WHERE channel_code IS NULL;

ALTER TABLE properties ALTER COLUMN channel_code SET NOT NULL;
ALTER TABLE rooms ALTER COLUMN channel_code SET NOT NULL;
ALTER TABLE rate_plans ALTER COLUMN channel_code SET NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties', 'rooms', 'rate_plans'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_channel_code_key') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (channel_code)', t, t || '_channel_code_key');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_channel_code_format') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (channel_code ~ ''^[A-Z0-9]{6,20}$'')', t, t || '_channel_code_format');
    END IF;
  END LOOP;
END
$$;

-- Default on INSERT (a column default cannot read the id) and refuse any change.
CREATE OR REPLACE FUNCTION app.channel_code_default() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.channel_code IS NULL THEN
    NEW.channel_code := TG_ARGV[0] || upper(left(replace(NEW.id::text, '-', ''), TG_ARGV[1]::int));
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION app.channel_code_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.channel_code IS DISTINCT FROM OLD.channel_code THEN
    RAISE EXCEPTION 'channel_code cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS channel_code_default ON properties;
CREATE TRIGGER channel_code_default BEFORE INSERT ON properties
  FOR EACH ROW EXECUTE FUNCTION app.channel_code_default('OB', '10');
DROP TRIGGER IF EXISTS channel_code_default ON rooms;
CREATE TRIGGER channel_code_default BEFORE INSERT ON rooms
  FOR EACH ROW EXECUTE FUNCTION app.channel_code_default('R', '11');
DROP TRIGGER IF EXISTS channel_code_default ON rate_plans;
CREATE TRIGGER channel_code_default BEFORE INSERT ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION app.channel_code_default('P', '11');

DROP TRIGGER IF EXISTS channel_code_immutable ON properties;
CREATE TRIGGER channel_code_immutable BEFORE UPDATE OF channel_code ON properties
  FOR EACH ROW EXECUTE FUNCTION app.channel_code_immutable();
DROP TRIGGER IF EXISTS channel_code_immutable ON rooms;
CREATE TRIGGER channel_code_immutable BEFORE UPDATE OF channel_code ON rooms
  FOR EACH ROW EXECUTE FUNCTION app.channel_code_immutable();
DROP TRIGGER IF EXISTS channel_code_immutable ON rate_plans;
CREATE TRIGGER channel_code_immutable BEFORE UPDATE OF channel_code ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION app.channel_code_immutable();

-- ---------------------------------------------------------------------------
-- Installations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  app_key text NOT NULL CHECK (app_key IN ('siteminder')),
  status text NOT NULL CHECK (status IN ('active', 'disconnected')),
  key_hash text NOT NULL UNIQUE,
  key_last4 text NOT NULL,
  connected_at timestamptz NOT NULL,
  connected_by text,
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_installations_one_active_per_property
  ON app_installations (property_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- What the app pushed, per night
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_inventory (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  date date NOT NULL,
  units_left integer NOT NULL CHECK (units_left >= 0),
  received_at timestamptz NOT NULL,
  PRIMARY KEY (room_id, date)
);

CREATE TABLE IF NOT EXISTS app_rates (
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  date date NOT NULL,
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  extra_adult_cents bigint,
  extra_child_cents bigint,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (rate_plan_id, date)
);

CREATE TABLE IF NOT EXISTS app_restrictions (
  rate_plan_id uuid NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  date date NOT NULL,
  is_closed boolean NOT NULL DEFAULT false,
  closed_to_arrival boolean NOT NULL DEFAULT false,
  closed_to_departure boolean NOT NULL DEFAULT false,
  min_stay_arrival integer,
  max_stay_arrival integer,
  min_stay_through integer,
  max_stay_through integer,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (rate_plan_id, date)
);

-- ---------------------------------------------------------------------------
-- Delivery of bookings to the app
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_booking_delivery (
  installation_id uuid NOT NULL REFERENCES app_installations(id),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'delivered', 'retrying', 'needs_attention', 'not_sent')),
  acknowledged_at timestamptz,
  detail text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_app_booking_delivery_booking ON app_booking_delivery (booking_id);

-- ---------------------------------------------------------------------------
-- Booking event feed order
-- ---------------------------------------------------------------------------

ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS txid xid8 NOT NULL DEFAULT pg_current_xact_id();
ALTER TABLE booking_events ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX IF NOT EXISTS idx_booking_events_txid_seq ON booking_events (txid, seq);

-- A booking change the app must hear about un-settles a delivered booking at
-- once, in the writer's own transaction: the availability rule
-- (packages/db/src/apps/managed-sql.ts) treats only `delivered` rows as
-- included in the app's limit, so a reopened or changed booking counts again
-- until the app reports the change delivered. `not_sent` rows (and rows not
-- delivered yet) are left alone. The kinds match DELIVERY_EVENT_KINDS in
-- packages/db/src/apps/feed.ts: check-in, no-show and refund events are not
-- sent to the channel.
--
-- SECURITY DEFINER with a pinned search_path (as 0057's triggers): events are
-- written by roles that may not touch app_booking_delivery (a guest through
-- ob_app's row-level security, an admin as ob_admin_write).
CREATE OR REPLACE FUNCTION app.app_delivery_booking_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE app_booking_delivery
     SET status = 'pending', updated_at = now()
   WHERE booking_id = NEW.booking_id AND status = 'delivered';
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS app_delivery_booking_changed ON booking_events;
CREATE TRIGGER app_delivery_booking_changed AFTER INSERT ON booking_events
  FOR EACH ROW
  WHEN (NEW.kind IN ('confirmed', 'rooms_cancelled', 'early_departure', 'forced_status',
                     'forced_uncancel', 'forced_cancel', 'forced_markers_cleared'))
  EXECUTE FUNCTION app.app_delivery_booking_changed();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security (same form as 0049/0057)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION app.channel_code_default(), app.channel_code_immutable() FROM PUBLIC;
-- A trigger function runs whoever inserts; nobody calls it directly.
REVOKE ALL ON FUNCTION app.app_delivery_booking_changed() FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['ob_app', 'ob_auth', 'ob_system'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION app.channel_code_default(), app.channel_code_immutable() TO %I', r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON app_installations, app_inventory, app_rates, app_restrictions, app_booking_delivery TO ob_system;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON app_installations, app_booking_delivery TO ob_app;
    GRANT SELECT ON app_inventory, app_rates, app_restrictions TO ob_app;
  END IF;
END
$$;

ALTER TABLE app_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_booking_delivery ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_app') THEN
    DROP POLICY IF EXISTS ob_app_party ON app_installations;
    CREATE POLICY ob_app_party ON app_installations FOR ALL TO ob_app
      USING (property_id = ANY ((SELECT app.readable_property_ids())::uuid[]))
      WITH CHECK (property_id = ANY ((SELECT app.readable_property_ids())::uuid[]));

    -- Read-only and public, like the host tables they stand in for (which
    -- have no row-level security at all): any hotel's prices and stock are
    -- what guest search shows anyway.
    DROP POLICY IF EXISTS ob_app_read ON app_inventory;
    CREATE POLICY ob_app_read ON app_inventory FOR SELECT TO ob_app USING (true);
    DROP POLICY IF EXISTS ob_app_read ON app_rates;
    CREATE POLICY ob_app_read ON app_rates FOR SELECT TO ob_app USING (true);
    DROP POLICY IF EXISTS ob_app_read ON app_restrictions;
    CREATE POLICY ob_app_read ON app_restrictions FOR SELECT TO ob_app USING (true);

    DROP POLICY IF EXISTS ob_app_party ON app_booking_delivery;
    CREATE POLICY ob_app_party ON app_booking_delivery FOR ALL TO ob_app
      USING (EXISTS (SELECT 1 FROM app_installations i WHERE i.id = app_booking_delivery.installation_id))
      WITH CHECK (EXISTS (SELECT 1 FROM app_installations i WHERE i.id = app_booking_delivery.installation_id));
  END IF;
END
$$;

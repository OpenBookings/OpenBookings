SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS siteminder;

-- One row per hotel that connected SiteMinder (an installation of the app).
CREATE TABLE IF NOT EXISTS siteminder.installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_code text NOT NULL UNIQUE,
  property_name text,
  api_key text,
  core_base_url text,
  status text,
  feed_cursor text,
  structure jsonb,
  structure_fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Messages received from SiteMinder, kept until processed. echo_token makes a
-- redelivery of the same message a no-op.
CREATE TABLE IF NOT EXISTS siteminder.inbox (
  id bigserial PRIMARY KEY,
  installation_id uuid REFERENCES siteminder.installations (id) ON DELETE CASCADE,
  echo_token uuid NOT NULL UNIQUE,
  kind text NOT NULL,
  changes jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error text
);

-- The latest known state of each booking and what SiteMinder has been told.
CREATE TABLE IF NOT EXISTS siteminder.outbox (
  installation_id uuid NOT NULL REFERENCES siteminder.installations (id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  unique_id text NOT NULL,
  latest jsonb,
  latest_version bigint,
  acked text NOT NULL DEFAULT 'none' CHECK (acked IN ('none', 'committed', 'cancelled')),
  acked_version bigint,
  status text CHECK (status IN ('waiting', 'sending', 'retrying', 'delivered', 'needs_attention', 'not_sent')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, booking_id)
);

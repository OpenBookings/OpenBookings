-- 0033_booking_intents — a booking intent is a 15-minute hold on rooms while the
-- guest pays. It carries a snapshot of what was quoted, the payment session and
-- (once paid) the booking it became. booking_intent_rooms holds one row per room
-- in the intent, with the exact per-night amounts.
--
-- Money is in major units (euros); commission_cents is the one cents column
-- because it is only ever handed to the payment provider. Payment columns are
-- provider-neutral (payment_session_id, payment_account_id, ...).
--
-- Also adds properties.is_demo: generated demo hotels, only visible in testing mode.
--
-- Additive only: safe for the code running before this deploy.
CREATE TABLE IF NOT EXISTS booking_intents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  property_id        uuid NOT NULL REFERENCES properties(id),
  check_in_date      date NULL,
  check_out_date     date NULL,
  status             text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','paid','expired','failed','abandoned','oversold','refunded_oversold')),
  hold_expires_at    timestamptz NOT NULL,
  snapshot           jsonb NOT NULL,
  total_amount       numeric(12,2) NOT NULL,
  tourist_tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  commission_cents   integer NOT NULL DEFAULT 0,
  currency           char(3) NOT NULL DEFAULT 'EUR',
  payment_provider   text NOT NULL DEFAULT 'stripe',
  payment_session_id text NULL UNIQUE,
  payment_account_id text NULL,
  payment_reference  text NULL,
  refund_reference   text NULL,
  booking_id         uuid NULL REFERENCES bookings(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_intents_dates CHECK (check_out_date > check_in_date)
);

CREATE INDEX IF NOT EXISTS idx_booking_intents_status_hold ON booking_intents (status, hold_expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_intents_user_status ON booking_intents (user_id, status);
CREATE INDEX IF NOT EXISTS idx_booking_intents_property ON booking_intents (property_id);

CREATE TABLE IF NOT EXISTS booking_intent_rooms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id          uuid NOT NULL REFERENCES booking_intents(id) ON DELETE CASCADE,
  room_id            uuid NOT NULL REFERENCES rooms(id),
  rate_plan_id       uuid NOT NULL REFERENCES rate_plans(id),
  adults             integer NOT NULL,
  children           integer NOT NULL DEFAULT 0,
  nights             jsonb NOT NULL,
  stay_total         numeric(12,2) NOT NULL,
  tourist_tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  tourist_tax_lines  jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order         integer NOT NULL DEFAULT 0,
  CONSTRAINT booking_intent_rooms_nights_array CHECK (jsonb_typeof(nights) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_booking_intent_rooms_room ON booking_intent_rooms (room_id);
CREATE INDEX IF NOT EXISTS idx_booking_intent_rooms_intent ON booking_intent_rooms (intent_id);

ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_properties_is_demo ON properties (is_demo) WHERE is_demo;

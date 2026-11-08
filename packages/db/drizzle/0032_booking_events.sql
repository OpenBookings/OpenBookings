-- 0032_booking_events — an append-only log of what happened to a booking and
-- who did it: confirmation, cancellations, check-in, no-show, refunds, and the
-- dev admin dashboard's forced state changes.
--
-- Rows go with their booking (ON DELETE CASCADE); a reservation that is later
-- deleted just loses the link (ON DELETE SET NULL). actor_id is free text so it
-- can hold a user id, "dev-super-admin" or nothing (system).
--
-- Additive only: safe for the code running before this deploy.
CREATE TABLE IF NOT EXISTS booking_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  reservation_id uuid NULL REFERENCES reservations(id) ON DELETE SET NULL,
  kind           text NOT NULL,
  actor_kind     text NOT NULL CHECK (actor_kind IN ('guest','host','system','admin')),
  actor_id       text NULL,
  reason         text NULL,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events (booking_id, created_at);

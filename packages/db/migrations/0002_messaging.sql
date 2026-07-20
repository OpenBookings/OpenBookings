-- 0002: host-guest messaging (threads + messages)
-- Applied directly against the DB (recorded here for history/parity with schema.ts).
--
-- Booking-scoped threads (booking_id set) and pre-booking inquiry threads
-- (booking_id NULL, property_id set) share one table. status/sender_role use
-- text + CHECK rather than pgEnum. host_id/guest_id/sender_id were
-- originally applied as uuid; see 0003_messaging_id_types.sql, which fixes
-- them to text (Better Auth ids aren't valid uuids) — this file is left as
-- the as-applied record and reflects the pre-0003 state.

BEGIN;

CREATE TABLE message_threads (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id   uuid REFERENCES bookings(id) ON DELETE SET NULL,
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    host_id      uuid NOT NULL,
    guest_id     uuid NOT NULL,
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'flagged')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_threads_host_id ON message_threads (host_id, updated_at DESC);
CREATE INDEX idx_message_threads_guest_id ON message_threads (guest_id, updated_at DESC);
CREATE INDEX idx_message_threads_booking_id ON message_threads (booking_id) WHERE booking_id IS NOT NULL;

CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id       uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_id       uuid NOT NULL,
    sender_role     text NOT NULL CHECK (sender_role IN ('host', 'guest')),
    body            text NOT NULL,
    flagged_reason  text,
    read_at         timestamptz,
    notified_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_thread_id_created_at ON messages (thread_id, created_at);
CREATE INDEX idx_messages_unread_sweep ON messages (created_at) WHERE read_at IS NULL AND notified_at IS NULL;
CREATE INDEX idx_messages_flagged ON messages (thread_id) WHERE flagged_reason IS NOT NULL;

COMMIT;

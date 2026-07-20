-- 0003: fix messaging user-id columns from uuid to text
--
-- 0002 typed host_id/guest_id/sender_id as uuid. Better Auth's default id
-- generator produces non-UUID strings (same issue bookings.user_id had,
-- fixed in 0001), so these need to be text to actually hold real user ids.
-- Tables are new and empty, so this is a plain type change, no backfill.

BEGIN;

ALTER TABLE message_threads ALTER COLUMN host_id TYPE text USING host_id::text;
ALTER TABLE message_threads ALTER COLUMN guest_id TYPE text USING guest_id::text;
ALTER TABLE messages ALTER COLUMN sender_id TYPE text USING sender_id::text;

ALTER TABLE message_threads ADD CONSTRAINT message_threads_host_id_fkey FOREIGN KEY (host_id) REFERENCES "user"(id);
ALTER TABLE message_threads ADD CONSTRAINT message_threads_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES "user"(id);
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES "user"(id);

COMMIT;

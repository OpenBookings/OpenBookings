-- 0004: allow messages.sender_id to be anonymized
--
-- The retention sweep (apps/business/app/api/cron/messaging-retention)
-- anonymizes old messages by nulling sender_id rather than writing a fake
-- sentinel value, since sender_id has an FK to "user"(id) and a sentinel
-- would either violate that FK or falsely point at a real user. NULL keeps
-- the FK meaningful (a present sender_id is always a real user) while still
-- letting anonymized rows exist.

BEGIN;

ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;

COMMIT;

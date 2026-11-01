-- 0028_guest_profile — optional contact details a guest adds in their account.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent.
--
-- One row per guest, only once they save a phone number or address. The host
-- of each of their bookings can read it (arrival contact, guest register);
-- privacy policy 2026-11-01 §2.1 says so. Deleting the user deletes the row.
--
-- Mirrors `guestProfile` in src/schema.ts; keep the two in sync.

CREATE TABLE IF NOT EXISTS guest_profile (
  user_id        text         PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  phone          varchar(32)  NULL,
  address_line1  varchar(200) NULL,
  address_line2  varchar(200) NULL,
  postal_code    varchar(20)  NULL,
  city           varchar(100) NULL,
  country        char(2)      NULL,
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

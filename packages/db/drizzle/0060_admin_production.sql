-- 0060_admin_production — taking the admin console to production: the staff
-- lookup and step-up credentials.
--
-- apps/admin sits behind Cloudflare Access. Access proves who the person is
-- (their email); staff are the "user" rows with role = 'admin', so the
-- console needs to read that one column. Only ob_admin_read gets it: the
-- staff lookup always runs on the read connection (apps/admin/lib/staff.ts),
-- for pages and server actions alike.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

GRANT SELECT (role) ON "user" TO ob_admin_read;

-- ---------------------------------------------------------------------------
-- Step-up credentials
-- ---------------------------------------------------------------------------
--
-- Dangerous actions ask for a passkey or a 6-digit authenticator-app code
-- (a "step-up") on top of Access. admin_credentials holds each staff
-- member's passkeys and authenticator apps; the TOTP secret is AES-256-GCM
-- encrypted with ADMIN_TOTP_KEY, which the database never sees.
--
-- user_id has no foreign key to "user": the development bypass's staff
-- member is "dev", not a user row.

CREATE TABLE IF NOT EXISTS admin_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('passkey', 'totp')),
  credential_id text UNIQUE,         -- passkey: base64url credential id
  public_key bytea,                  -- passkey: COSE public key
  counter bigint NOT NULL DEFAULT 0, -- passkey: signature counter
  transports text[],                 -- passkey: hints for the browser
  totp_secret_enc text,              -- totp: v1:<iv>:<tag>:<ciphertext>
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT admin_credentials_kind_fields CHECK (
    (kind = 'passkey' AND credential_id IS NOT NULL AND public_key IS NOT NULL AND totp_secret_enc IS NULL)
    OR (kind = 'totp' AND totp_secret_enc IS NOT NULL AND credential_id IS NULL AND public_key IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS admin_credentials_user_id_idx ON admin_credentials (user_id);

-- One row per challenge: a step-up for (user, action, target), valid for
-- five minutes and used once (used_at). Enrolment keeps its pending
-- challenge here too, under the actions 'security.enrol-passkey' and
-- 'security.enrol-totp' (the challenge column then holds the WebAuthn
-- challenge, or the new TOTP secret encrypted like admin_credentials').
CREATE TABLE IF NOT EXISTS admin_step_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  action text NOT NULL,
  target_id text NOT NULL,
  challenge text NOT NULL,
  verified_kind text,
  verified_at timestamptz,
  used_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_step_ups_user_action_idx ON admin_step_ups (user_id, action, target_id);

-- Pages (the /security list) read the credentials without the TOTP secret,
-- and step-ups without their challenge (which may be a pending TOTP secret).
GRANT SELECT (id, user_id, kind, credential_id, public_key, counter, transports, label, created_at, last_used_at)
  ON admin_credentials TO ob_admin_read;
GRANT SELECT (id, user_id, action, target_id, verified_kind, verified_at, used_at, expires_at, created_at)
  ON admin_step_ups TO ob_admin_read;

-- Server actions enrol credentials and run step-ups: they add rows, and
-- change only the counters and timestamps. Nothing deletes.
GRANT SELECT, INSERT ON admin_credentials, admin_step_ups TO ob_admin_write;
GRANT UPDATE (counter, last_used_at) ON admin_credentials TO ob_admin_write;
GRANT UPDATE (verified_kind, verified_at, used_at) ON admin_step_ups TO ob_admin_write;

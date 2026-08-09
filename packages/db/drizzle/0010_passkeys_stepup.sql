-- 0010_passkeys_stepup — passkey + two-factor tables and the step-up clock.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code
-- that writes these. This repo has no drizzle journal; every statement is
-- idempotent. Column names mirror Better Auth's camelCase conventions used
-- by the existing auth tables.

-- @better-auth/passkey plugin (host instance only writes it).
CREATE TABLE IF NOT EXISTS "passkey" (
  id             text        PRIMARY KEY,
  "name"         text        NULL,
  "publicKey"    text        NOT NULL,
  "userId"       text        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "credentialID" text        NOT NULL,
  counter        bigint      NOT NULL,
  "deviceType"   text        NOT NULL,
  "backedUp"     boolean     NOT NULL,
  transports     text        NULL,
  "createdAt"    timestamptz NULL DEFAULT CURRENT_TIMESTAMP,
  aaguid         text        NULL
);
CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey" ("userId");
CREATE INDEX IF NOT EXISTS "passkey_credentialID_idx" ON "passkey" ("credentialID");

-- better-auth twoFactor plugin: TOTP secret + backup (recovery) codes,
-- both stored encrypted by the plugin. Recovery codes come from this
-- plugin — the passkey plugin has none.
CREATE TABLE IF NOT EXISTS "twoFactor" (
  id                        text   PRIMARY KEY,
  secret                    text   NOT NULL,
  "backupCodes"             text   NOT NULL,
  "userId"                  text   NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified                  boolean NULL DEFAULT true,
  "failedVerificationCount" integer NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor" ("userId");
CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "twoFactor" (secret);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" boolean NULL DEFAULT false;

-- Step-up clock: stamped at sign-in, refreshed by successful passkey/TOTP/
-- backup-code verification, read directly from this table (never the cookie
-- cache) by the sensitive-action gate.
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "lastVerifiedAt" timestamptz NULL;

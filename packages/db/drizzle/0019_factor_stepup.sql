-- 0019_factor_stepup — a second step-up clock that only a real factor moves.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent. Column name follows Better Auth's camelCase, like the
-- `lastVerifiedAt` added in 0012.
--
-- `lastVerifiedAt` is stamped at every sign-in, and hosts sign in by magic
-- link or OAuth, so "verified in the last 15 minutes" could mean "clicked an
-- email link". This column is stamped only when a passkey, authenticator code
-- or backup code is verified. Sensitive actions by a host who has a factor
-- require THIS one to be fresh.
--
-- NULL means "no factor verified on this session", which the gate treats as
-- stale. Existing sessions therefore need one factor check before their next
-- sensitive action; nothing else changes for them.

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "lastFactorVerifiedAt" timestamptz NULL;

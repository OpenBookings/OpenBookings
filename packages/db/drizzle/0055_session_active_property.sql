-- 0055_session_active_property — the hotel a login session is working in.
--
-- A business-console user can belong to several hotels (organizations) and
-- switches between them. The current hotel is stored on the Better Auth
-- `session` row, next to activeOrganizationId, so it survives across devices
-- and tabs and is read in one place by packages/authz (raw SQL).
--
-- Deliberately NOT a Better Auth additionalField: nothing in Better Auth
-- reads or writes it, so its /update-session endpoint cannot touch it. Only
-- our own switch action sets it, after a server-side access check.
--
-- ON DELETE SET NULL: a deleted property just means "no current hotel", and
-- the next request falls back to another one the user can reach.
--
-- ob_app (0049) gets column-level SELECT and UPDATE only, like
-- activeOrganizationId. Idempotent: safe to replay.

SET lock_timeout = '5s';

ALTER TABLE session
  ADD COLUMN IF NOT EXISTS "activePropertyId" uuid
  REFERENCES properties(id) ON DELETE SET NULL;

GRANT SELECT ("activePropertyId"), UPDATE ("activePropertyId") ON session TO ob_app;

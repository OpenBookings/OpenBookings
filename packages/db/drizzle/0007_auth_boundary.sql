-- 0007_auth_boundary — portal stamp on the Better Auth session table.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code
-- that writes it: better-auth's session additionalFields insert the column
-- on every sign-in, so a missing column fails session creation. This repo
-- has no drizzle journal, so `bun run db:migrate` does not track these files
-- and must not be used to apply this. Every statement is idempotent.
--
-- portal records which app created the session ('guest' = apps/web,
-- 'host' = apps/business). It is set in session.create.before and re-checked
-- on every session read (sessionForApp in packages/auth), as defence in
-- depth alongside the user.account_type check.

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS portal text NULL;

-- Backfill existing sessions from their user's account_type so the read-side
-- check applies to sessions issued before this column existed. Sessions
-- whose user has no account_type stay NULL; account_type rejects those on
-- read anyway.
UPDATE "session" s
SET portal = CASE u.account_type
  WHEN 'business' THEN 'host'
  WHEN 'private' THEN 'guest'
END
FROM "user" u
WHERE s."userId" = u.id AND s.portal IS NULL;

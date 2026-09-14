-- 0014_portal_backfill_cutover — re-stamp session.portal at deploy time.
--
-- Apply BY HAND, and specifically AT CUTOVER: after the code from this branch
-- is live, not before. Idempotent, so re-running is a no-op.
--
-- Why this exists, when 0009_auth_boundary already backfilled portal:
--
-- 0009 closed the gap for sessions that predated the column, and it worked —
-- but that backfill ran on 2026-08-21 and this branch did not ship. main
-- carried on serving from the same database for the next three and a half
-- weeks, and main's code knows nothing about `portal`, so every session it
-- minted in that window has portal NULL. As of 2026-09-14 that is 7 rows, 4
-- of them unexpired, the newest minted the same day.
--
-- sessionForApp() tolerates a NULL portal on purpose — it is the migration
-- grace for pre-column sessions (see packages/auth/src/shared.ts). Those rows
-- therefore skip the portal check entirely and rest on the user.account_type
-- check alone. That is still a real check, so this is a weakened second layer
-- rather than an open door, but the grace window was only ever meant to be
-- closed by a backfill, and the divergence quietly reopened it.
--
-- Running this BEFORE cutover accomplishes nothing: the old code would just
-- keep minting more NULL rows behind it. Run it once the new code is serving.
--
-- Note the asymmetry with 0009: this one is scoped to rows whose user still
-- has an account_type, and leaves anything else NULL for account_type to
-- reject on read, exactly as 0009 did.
UPDATE "session" s
SET portal = CASE u.account_type
  WHEN 'business' THEN 'host'
  WHEN 'private'  THEN 'guest'
END
FROM "user" u
WHERE s."userId" = u.id
  AND s.portal IS NULL
  AND u.account_type IS NOT NULL;

-- After this runs, nothing legitimate mints a NULL-portal session any more.
-- Tightening sessionForApp() to REJECT rather than tolerate NULL is the
-- natural follow-up, but it is a code change with its own blast radius
-- (anyone still holding an unstamped cookie is signed out), so it is
-- deliberately left as a separate decision rather than bundled here.

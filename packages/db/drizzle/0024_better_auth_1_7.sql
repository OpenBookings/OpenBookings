-- 0024_better_auth_1_7 — what the Better Auth 1.6 -> 1.7 upgrade needs.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- runs 1.7. Idempotent. Both parts are safe to apply while 1.6 is still
-- serving, with one caveat on part 2 (see there).
--
-- This is not optional the way earlier column additions were: 1.7 compares
-- the tables it writes against the database on every request and refuses to
-- serve when a column is missing. Deploying 1.7 without part 1 takes down
-- every auth request on the host portal, not just two-factor.

-- 1. Two-factor lockout.
--
-- 1.7's twoFactor plugin stamps a lockout time after repeated wrong codes.
-- Nullable, no default: NULL means "not locked".
ALTER TABLE "twoFactor" ADD COLUMN IF NOT EXISTS "lockedUntil" timestamptz NULL;

-- 2. Microsoft accounts are keyed on `oid`, not `sub`.
--
-- 1.6 stored the id token's `sub` claim in account."accountId". `sub` is
-- pairwise (specific to our app registration); 1.7 uses `oid`, the directory
-- object id, instead. A row still holding `sub` no longer matches at sign-in,
-- and because implicit linking is off and email is unique, the host then hits
-- the "email already registered" collision and cannot get in.
--
-- The `oid` is taken from the id token stored on the same row. That token is
-- the one Microsoft's token endpoint returned during the code exchange and
-- has only ever lived in this table, which is what makes its claims usable
-- here without re-verifying a signature that has long since expired.
--
-- Guards, all of which must hold for a row to be rewritten:
--   - the token's `sub` equals the stored accountId, i.e. the token really is
--     this row's and the row has not been migrated already;
--   - `oid` is GUID-shaped;
--   - no other microsoft row already holds that `oid`.
--
-- Caveat: a rewritten row stops matching under 1.6. Run this part at the
-- cutover, right before the 1.7 deploy goes live, not days ahead.
--
-- Preview first — this is the same selection, read-only:
--
--   SELECT a.id, a."userId", a."accountId" AS old_sub, c.claims->>'oid' AS new_oid
--   FROM "account" a
--   CROSS JOIN LATERAL (
--     SELECT convert_from(decode(rpad(
--              translate(split_part(a."idToken", '.', 2), '-_', '+/'),
--              (ceil(length(split_part(a."idToken", '.', 2)) / 4.0) * 4)::int, '='),
--            'base64'), 'UTF8')::jsonb AS claims
--   ) c
--   WHERE a."providerId" = 'microsoft' AND a."idToken" IS NOT NULL;
WITH decoded AS (
  SELECT
    a.id,
    a."accountId",
    -- JWT payloads are base64url without padding; Postgres wants base64 with.
    convert_from(
      decode(
        rpad(
          translate(split_part(a."idToken", '.', 2), '-_', '+/'),
          (ceil(length(split_part(a."idToken", '.', 2)) / 4.0) * 4)::int,
          '='
        ),
        'base64'
      ),
      'UTF8'
    )::jsonb AS claims
  FROM "account" a
  WHERE a."providerId" = 'microsoft'
    AND a."idToken" IS NOT NULL
    AND a."idToken" LIKE '%.%.%'
)
UPDATE "account" a
SET "accountId" = d.claims->>'oid'
FROM decoded d
WHERE a.id = d.id
  AND d.claims->>'sub' = a."accountId"
  AND d.claims->>'oid' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM "account" o
    WHERE o."providerId" = 'microsoft'
      AND o."accountId" = d.claims->>'oid'
  );

-- After running: this must return no rows. Anything it lists is a Microsoft
-- account the statement above could not migrate (no stored id token, or one
-- that does not belong to the row) and whose owner cannot sign in with
-- Microsoft on 1.7. They can still use a magic link; fix the row by hand from
-- an Entra export, or delete it and let them re-link from account settings.
--
--   SELECT id, "userId", "accountId", "idToken" IS NOT NULL AS has_id_token
--   FROM "account"
--   WHERE "providerId" = 'microsoft'
--     AND "accountId" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 0048_revoke_data_api_grants — take away what Neon's Data API roles were given.
--
-- Neon creates `authenticated` and `anonymous` for its Data API, and a default
-- privilege on neondb_owner handed `authenticated` SELECT, INSERT, UPDATE and
-- DELETE on every table in public — "user", "account" (password hashes),
-- "session" (tokens) and "twoFactor" (secrets) included, with no RLS
-- underneath. The Data API is off, so nothing can use those grants today, but
-- turning it on in the console would have exposed every row to any holder of
-- a valid JWT. Nothing in this repo connects as either role.
--
-- The four billing report views ran with their owner's rights (Postgres's
-- default), which skips row-level security on the tables they read. They now
-- run with the caller's rights, so RLS applies through them as it does on the
-- tables. Only the invoice job reads them, as a role that may read the tables.
--
-- Plain Postgres (local, CI) has neither role: each block checks first.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

DO $$
DECLARE
  r text;
  fn regprocedure;
  owner_role text;
BEGIN
  FOREACH r IN ARRAY ARRAY['authenticated', 'anonymous'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      -- Only functions actually granted to the role: ALL FUNCTIONS would also
      -- walk the extensions' (postgis, vector) and warn on each one.
      FOR fn IN
        SELECT p.oid::regprocedure FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = r))
      LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn, r);
      END LOOP;
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', r);
      -- Default privileges belong to the role that set them (neondb_owner on
      -- Neon). Edit each such role's entry; altering another role's needs
      -- membership in it, which the migration runner has.
      FOR owner_role IN
        SELECT DISTINCT pg_get_userbyid(d.defaclrole) FROM pg_default_acl d
        WHERE EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = r))
      LOOP
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', owner_role, r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', owner_role, r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', owner_role, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;

ALTER VIEW IF EXISTS v_vat_return_quarter SET (security_invoker = true);
ALTER VIEW IF EXISTS v_icp_listing_quarter SET (security_invoker = true);
ALTER VIEW IF EXISTS v_dac7_fees_quarter SET (security_invoker = true);
ALTER VIEW IF EXISTS v_returned_payments_quarter SET (security_invoker = true);

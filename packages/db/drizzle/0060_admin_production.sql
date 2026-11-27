-- 0060_admin_production — grants for taking the admin console to production.
--
-- apps/admin sits behind Cloudflare Access. Access proves who the person is
-- (their email); staff are the "user" rows with role = 'admin', so the
-- console needs to read that one column. Both roles from 0054 get it: pages
-- look the staff member up as ob_admin_read, server actions as ob_admin_write.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

GRANT SELECT (role) ON "user" TO ob_admin_read, ob_admin_write;

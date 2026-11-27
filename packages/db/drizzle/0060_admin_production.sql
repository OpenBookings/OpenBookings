-- 0060_admin_production — grants for taking the admin console to production.
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

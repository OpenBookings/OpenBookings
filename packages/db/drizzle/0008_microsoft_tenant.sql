-- 0008_microsoft_tenant — Entra tenant id on the Better Auth account table.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code
-- that writes it. This repo has no drizzle journal; every statement is
-- idempotent.
--
-- tenant_id holds the `tid` claim from the Microsoft id token, stamped in
-- account.create.before on the host instance. NULL for every non-Microsoft
-- account. Needed later for org auto-join (match a host's coworkers by
-- Entra tenant).

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS tenant_id text NULL;

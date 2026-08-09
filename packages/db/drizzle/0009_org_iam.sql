-- 0009_org_iam — admin plugin columns, property scoping, audit log.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code
-- that writes these. This repo has no drizzle journal; every statement is
-- idempotent.

-- Better Auth admin plugin fields. All input:false — never settable from
-- client input; role is granted only by an existing admin or directly here.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role text NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS banned boolean NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" text NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" timestamptz NULL;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonatedBy" text NULL;

-- Property scoping for the manager and frontdesk roles. Better Auth's team
-- feature has no per-team permission scoping (verified 1.6.25), so property
-- access lives in our own schema; owner/admin/finance are org-wide and never
-- get rows here. member_id references the org plugin's member row, so
-- removing a member cascades their property grants away.
CREATE TABLE IF NOT EXISTS property_access (
  member_id   text NOT NULL REFERENCES "member"(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, property_id)
);

-- Legal/financial profile of an organization. Typed columns, NOT the org
-- plugin's metadata JSON — these get queried for DAC7 exports.
CREATE TABLE IF NOT EXISTS org_profile (
  organization_id   text NOT NULL PRIMARY KEY REFERENCES "organization"(id) ON DELETE CASCADE,
  legal_entity_name text NOT NULL,
  kvk_number        text NULL,
  vat_number        text NULL,
  stripe_account_id text NULL,
  -- Per-org auth requirements (and eventually SSO) slot in as one more
  -- policy type here instead of a refactor. NULL = platform defaults.
  auth_policy       jsonb NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Consent records for signed host documents (Host/Partner Agreement, DPA).
-- Load-bearing legal artifacts, separate from audit_log on purpose.
CREATE TABLE IF NOT EXISTS org_consent (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text        NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  doc_id            text        NOT NULL,
  signed_by_user_id text        NOT NULL,
  signer_full_name  text        NOT NULL,
  signer_role_title text        NULL,
  signer_ip         text        NULL,
  signed_at         timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_consent_org_idx ON org_consent (organization_id, doc_id);

-- Properties belong to an org (locked decision). owner_user_id stays for
-- now as the legacy authz path; repositories migrate to organization_id
-- with task 11. Existing properties get their org via a one-off backfill
-- once their hosts have provisioned orgs.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS organization_id text NULL REFERENCES "organization"(id);
CREATE INDEX IF NOT EXISTS idx_properties_organization_id ON properties (organization_id);

-- Append-only audit log for privileged actions (impersonation now; org
-- provisioning, role changes, recovery events as those tasks land).
-- actor/target are Better Auth user ids (text, not uuid).
CREATE TABLE IF NOT EXISTS audit_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action         text        NOT NULL,
  actor_user_id  text        NULL,
  target_user_id text        NULL,
  organization_id text       NULL,
  reason         text        NULL,
  ip             text        NULL,
  user_agent     text        NULL,
  detail         jsonb       NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_user_id, created_at);

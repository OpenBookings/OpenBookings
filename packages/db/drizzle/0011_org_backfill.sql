-- 0011_org_backfill — one org per existing host (task 11 transition).
--
-- Apply BY HAND (psql or the Neon SQL editor), AFTER 0009. Idempotent:
-- hosts who already own an org are skipped, so re-running is a no-op and
-- hosts provisioned through the new completeOnboarding flow are never
-- duplicated.
--
-- Every business user who owns properties or has a host_onboarding row
-- gets: an organization (named from their legal step data when present,
-- else their user name), an org_profile, an owner membership, their
-- properties linked, and their live sessions pointed at the org. Slugs are
-- md5-suffixed for uniqueness; they are not user-facing yet and can be
-- renamed later.

WITH hosts AS (
  SELECT u.id AS user_id,
         COALESCE(
           NULLIF(ho.step_data->'legal-n-boring'->>'legalCompanyName', ''),
           u.name
         ) AS org_name,
         ho.step_data->'legal-n-boring'->>'cocNumber'  AS kvk_number,
         NULLIF(ho.step_data->'legal-n-boring'->>'vatNumber', '') AS vat_number,
         ho.step_data->>'stripe_account_id' AS stripe_account_id
  FROM "user" u
  LEFT JOIN host_onboarding ho ON ho.user_id = u.id
  WHERE u.account_type = 'business'
    AND (ho.user_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM properties p WHERE p.owner_user_id = u.id))
    AND NOT EXISTS (
      SELECT 1 FROM "member" m WHERE m."userId" = u.id AND m.role = 'owner'
    )
),
new_orgs AS (
  INSERT INTO "organization" (id, name, slug, "createdAt")
  SELECT gen_random_uuid()::text,
         h.org_name,
         lower(regexp_replace(h.org_name, '[^a-zA-Z0-9]+', '-', 'g'))
           || '-' || substr(md5(h.user_id), 1, 8),
         NOW()
  FROM hosts h
  RETURNING id, slug
),
org_by_host AS (
  -- Re-derive the org each host got via the deterministic md5 suffix.
  SELECT h.user_id, o.id AS organization_id,
         h.kvk_number, h.vat_number, h.stripe_account_id, h.org_name
  FROM hosts h
  JOIN new_orgs o ON o.slug LIKE '%-' || substr(md5(h.user_id), 1, 8)
),
profiles AS (
  INSERT INTO org_profile (organization_id, legal_entity_name, kvk_number, vat_number, stripe_account_id)
  SELECT organization_id, org_name, kvk_number, vat_number, stripe_account_id
  FROM org_by_host
  ON CONFLICT (organization_id) DO NOTHING
),
members AS (
  INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
  SELECT gen_random_uuid()::text, organization_id, user_id, 'owner', NOW()
  FROM org_by_host
),
linked AS (
  UPDATE properties p
  SET organization_id = obh.organization_id
  FROM org_by_host obh
  WHERE p.owner_user_id = obh.user_id AND p.organization_id IS NULL
)
UPDATE "session" s
SET "activeOrganizationId" = obh.organization_id
FROM org_by_host obh
WHERE s."userId" = obh.user_id AND s."activeOrganizationId" IS NULL;

-- Catch-all for properties whose owner already had an org before this ran.
UPDATE properties p
SET organization_id = m."organizationId"
FROM "member" m
WHERE p.organization_id IS NULL
  AND m."userId" = p.owner_user_id
  AND m.role = 'owner';

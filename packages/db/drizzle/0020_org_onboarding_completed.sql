-- 0020_org_onboarding_completed — onboarding completion moves to the organisation.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent.
--
-- Until now "is this host past the onboarding wall?" was answered by
-- host_onboarding.onboarding_completed_at, the wizard's per-user scratchpad.
-- That let the Stripe webhook complete a host who had no organisation yet,
-- left invited members stuck in onboarding (they never have a wizard row),
-- and let a removed owner into an empty dashboard. Completion now lives here,
-- written only by completeOnboarding(); the wall checks membership of an
-- organisation that has it set.
--
-- Backfill: an organisation is complete if its owner's wizard was completed
-- FOR IT — matched on the Stripe account as well as ownership, so a host who
-- owns several organisations marks only the one the wizard created.
--
-- Hosts the webhook completed without an organisation get no flag (they have
-- no org_profile). They return to /onboarding/stripe, where
-- completeOnboarding() now provisions their organisation.
--
-- host_onboarding.onboarding_completed_at is still written (dual-write) so a
-- rollback keeps working. Dropped in 0021 once the deploy is stable.

ALTER TABLE org_profile
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz NULL;

UPDATE org_profile op
SET onboarding_completed_at = ho.onboarding_completed_at
FROM "member" m
JOIN host_onboarding ho ON ho.user_id = m."userId"
WHERE m."organizationId" = op.organization_id
  AND m.role = 'owner'
  AND ho.onboarding_completed_at IS NOT NULL
  AND op.stripe_account_id = ho.step_data->>'stripe_account_id'
  AND op.onboarding_completed_at IS NULL;

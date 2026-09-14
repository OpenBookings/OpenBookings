-- 0007_host_onboarding — the table apps/business onboarding has always used.
--
-- Apply BY HAND (psql or the Neon SQL editor), same as 0006: this repo has no
-- drizzle journal, so `bun run db:migrate` does not track these files. Every
-- statement is IF NOT EXISTS / idempotent, so re-running it against an
-- already-migrated database is a no-op.
--
-- This file is catch-up, not a new feature. `host_onboarding` existed only in
-- the live database: no migration created it and packages/db/src/schema.ts did
-- not describe it, which meant (a) a freshly provisioned environment came up
-- without it, and every business-app request through apps/business/proxy.ts
-- failed on the missing relation, and (b) `drizzle-kit push` diffed the
-- declared schema against the database, found a table nothing declared, and
-- offered to DROP it — taking every host's onboarding progress and connected
-- Stripe account id with it.
--
-- Mirrors `hostOnboarding` in packages/db/src/schema.ts; keep the two in sync.
CREATE TABLE IF NOT EXISTS host_onboarding (
  -- Better Auth user id. Primary key: the upserts in the onboarding actions
  -- depend on ON CONFLICT (user_id).
  user_id                 text        PRIMARY KEY
                                      REFERENCES "user"(id) ON DELETE CASCADE,
  -- Step keys already completed, deduped and sorted on write.
  completed_steps         text[]      NOT NULL DEFAULT '{}',
  -- Accumulated per-step payloads, merged key-by-key (step_data || $new).
  -- Also where the Stripe connected account id lives, as 'stripe_account_id'.
  step_data               jsonb       NOT NULL DEFAULT '{}',
  -- NULL until the host clears the onboarding wall; the proxy gates on this.
  onboarding_completed_at timestamptz
);

-- The Stripe `account.updated` webhook has no user id to work with — it
-- matches on the connected account id buried in step_data, which without this
-- is a sequential scan over every host on every webhook delivery.
CREATE INDEX IF NOT EXISTS host_onboarding_stripe_account_id_idx
  ON host_onboarding ((step_data->>'stripe_account_id'));

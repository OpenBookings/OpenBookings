-- 0001: auth separation & ownership (applied 2026-07-03)
--
-- Pre-flight verification performed before this migration:
--   * SELECT account_type, count(*) FROM "user" GROUP BY 1
--     → no NULL account_type rows existed (column already NOT NULL, enum
--       {private,business}), so the NULL → 'private' backfill was a no-op.
--   * host_onboarding was empty, so no NULL-account_type user had host-shaped
--     data, and the owner_user_id backfill below matched zero rows. The one
--     existing property (Terme Di Saturnia) has no owner and must be assigned
--     manually.
--   * bookings had zero rows, so the user_id type change is data-safe.

BEGIN;

-- Assert the account_type invariant instead of re-creating it: fail loudly if
-- a future environment still has a nullable column (backfill needed there).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'account_type' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'user.account_type is nullable — run the NULL backfill before this migration';
  END IF;
END $$;

-- bookings.user_id was uuid but Better Auth user ids are text. Nothing joins
-- through it yet; align it before ownership checks start relying on it.
ALTER TABLE bookings ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES "user"(id);

-- Property ownership: single owning host user. Org-based ownership is
-- deferred; call sites go through packages/authz so swapping this out later
-- is contained. Nullable: an unowned property is inaccessible to all hosts
-- (authz fails closed on NULL).
ALTER TABLE properties ADD COLUMN owner_user_id text REFERENCES "user"(id);
CREATE INDEX idx_hotels_owner_user_id ON properties (owner_user_id);

-- Backfill from the only existing host↔property association (Stripe account
-- provisioned during onboarding).
UPDATE properties p
SET owner_user_id = ho.user_id
FROM host_onboarding ho
WHERE p.owner_user_id IS NULL
  AND p.stripe_account_id IS NOT NULL
  AND ho.step_data->>'stripe_account_id' = p.stripe_account_id;

COMMIT;

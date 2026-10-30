-- 0027_cancellation_tiers — Annex B cancellation tiers, policy snapshots and refunds.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent.
--
-- The property picks one base tier (Flex, Standard or Limited) for all its
-- refundable rates. A rate plan with `is_refundable = false` is Non-refundable,
-- a separate type of rate rather than a fourth property setting.
--
-- Every reserved room stores a snapshot of the policy it was booked under:
-- the tier, the exact deadlines, and each night's price and tourist tax. Refund
-- logic only ever reads the snapshot, so a later change to the property's tier
-- never alters a booking that already exists. Rooms cancel individually, so
-- `cancelled_at` sits on the reservation; the booking is cancelled once every
-- room is.
--
-- There are no live bookings yet, so the free-text policy columns are dropped
-- in this same migration.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` adds 'checked_in', but Postgres won't let a
-- transaction use a value it added itself. Tests that write 'checked_in' need
-- this file applied to their database before they run.

-- Postgres has no `CREATE TYPE IF NOT EXISTS`; catch the duplicate instead.
DO $$ BEGIN
  CREATE TYPE "cancellation_tier" AS ENUM ('flex', 'standard', 'limited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "reservation_cancellation_tier" AS ENUM ('flex', 'standard', 'limited', 'non_refundable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "refund_reason" AS ENUM (
    'guest_cancellation',
    'early_departure',
    'host_cancellation',
    'property_unable',
    'travel_restriction',
    'goodwill'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'checked_in';

-- The property's base tier. Standard is the closest match to the old
-- "free cancellation until 7 days before" promise.
ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "cancellation_tier" "cancellation_tier" DEFAULT 'standard' NOT NULL;

-- Free-text policies are replaced by the tiers.
ALTER TABLE "rate_plans" DROP COLUMN IF EXISTS "cancellation_policy";
ALTER TABLE "property_content" DROP COLUMN IF EXISTS "free_cancellation_days";

-- Booking Time in Annex B: the grace period counts from confirmation, not
-- from when the pending intent was created.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
-- The last night actually stayed, when the guest left early.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "departed_early_on" date;

-- The policy snapshot, written when the booking is confirmed. NULL on pending
-- reservations, which have no snapshot yet.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "cancellation_tier" "reservation_cancellation_tier";
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "check_in_at" timestamp with time zone;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "grace_until" timestamp with time zone;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "full_refund_until" timestamp with time zone;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "partial_refund_until" timestamp with time zone;
-- [{ "date": "2026-11-03", "price": 100, "touristTax": 3 }], one per night, major units.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "nights" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "policy_version" text;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;

DO $$ BEGIN
  ALTER TABLE "reservations"
    ADD CONSTRAINT "reservations_nights_array" CHECK (jsonb_typeof("nights") = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per refund OpenBookings executes or records. `transactions` stays
-- the payment ledger.
CREATE TABLE IF NOT EXISTS "refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id"),
  "reservation_id" uuid REFERENCES "reservations"("id"),
  "reason" "refund_reason" NOT NULL,
  "accommodation_amount" numeric(10, 2) NOT NULL,
  "tourist_tax_amount" numeric(10, 2) NOT NULL,
  "amount" numeric(10, 2) NOT NULL,
  "breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "payment_status" DEFAULT 'pending' NOT NULL,
  "stripe_refund_id" varchar(255),
  "idempotency_key" varchar(255) NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refunds_idempotency_key_unique" UNIQUE ("idempotency_key"),
  CONSTRAINT "refunds_amount_sum" CHECK (
    "amount" = "accommodation_amount" + "tourist_tax_amount" AND "amount" >= 0
  )
);

CREATE INDEX IF NOT EXISTS "idx_refunds_booking_id" ON "refunds" ("booking_id");

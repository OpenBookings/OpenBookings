-- 0007_property_content — guest-facing listing content, location highlights,
-- and two new `properties` columns (check_in_until, postal_code).
--
-- Apply BY HAND (psql, the Neon SQL editor, or the one-off script used at
-- development time). This repo has no drizzle journal — `bun run db:migrate`
-- has no prior baseline to diff against, so drizzle-kit treats the schema as
-- brand new and tries to recreate everything from `account_type` onward,
-- which fails immediately with "type already exists". Same situation as
-- 0006_support_bot.sql. Hand-written here for the same reason, following the
-- same convention: every statement is IF NOT EXISTS / idempotent (or, for
-- CREATE TYPE, wrapped to tolerate re-running), so re-applying this file
-- against an already-migrated database — staging, prod, or a re-run after a
-- partial failure — is a no-op.
--
-- Mirrors the definitions in packages/db/src/schema.ts (propertyContent,
-- propertyHighlights, cotPolicyEnum, properties.checkInUntil,
-- properties.postalCode); keep the two in sync.

-- Postgres has no `CREATE TYPE IF NOT EXISTS`; catch the duplicate instead.
DO $$ BEGIN
  CREATE TYPE "cot_policy" AS ENUM('free', 'paid', 'unavailable');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "postal_code" varchar(20);
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "check_in_until" time;

-- FKs declared inline so table creation is the only thing that needs to be
-- idempotent (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`).
CREATE TABLE IF NOT EXISTS "property_content" (
	"property_id" uuid PRIMARY KEY REFERENCES "properties"("id") ON DELETE CASCADE,
	"overview_headline" varchar(120),
	"overview_description" text,
	"location_about" text,
	"cta_headline" varchar(120),
	"cta_body" text,
	"fine_print" text[],
	"reception_24h" boolean DEFAULT false NOT NULL,
	"free_cancellation_days" integer,
	"prepayment_required" boolean DEFAULT false NOT NULL,
	"children_welcome" boolean DEFAULT true NOT NULL,
	"min_check_in_age" integer,
	"cot_policy" "cot_policy",
	"cot_fee" bigint,
	"extra_bed_fee" bigint,
	"pets_allowed" boolean DEFAULT false NOT NULL,
	"payment_methods" text[],
	"legal_company_name" varchar(255),
	"contact_email" varchar(255),
	"contact_phone" varchar(50),
	"company_registration" varchar(100),
	"vat_number" varchar(100),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "property_highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
	"label" varchar(100) NOT NULL,
	"icon" varchar(50) NOT NULL,
	"distance" varchar(30) NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_property_highlights_property" ON "property_highlights" ("property_id","sort_order");

-- Normalise property_images.group to three explicit values.
-- Until now NULL ambiguously meant "gallery", and the two listing queries
-- disagreed about it: page.tsx excluded 'logo' AND 'hero-image', while
-- api/query/pr excluded only 'logo' and so returned the hero inside the
-- gallery. Both are changed to filter on group = 'gallery' (Task 17).
-- Already idempotent: re-running finds nothing left to update.
UPDATE property_images SET "group" = 'gallery' WHERE "group" IS NULL;

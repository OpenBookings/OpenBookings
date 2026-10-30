-- 0026_tourist_tax — tourist tax rules per property, and what each booking owed.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent.
--
-- Tourist tax is added on top of the room price: the guest sees one all-in
-- price, and OpenBookings' commission is taken on the room price only. Every
-- town sets it differently, so a rule is a list of charges the host combines
-- (see TouristTaxCharge in packages/pricing/src/tourist-tax.ts for the shape
-- of `charges`).
--
-- A rule applies to nights on or after `effective_from`. Rules are never
-- edited once they have started: a change is a new row with a later date, so
-- what applied on any past night stays answerable. A row with no charges means
-- "no tourist tax from this date".

CREATE TABLE IF NOT EXISTS "tourist_tax_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "effective_from" date NOT NULL,
  "charges" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "children_exempt" boolean NOT NULL DEFAULT false,
  "max_nights" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" text,
  CONSTRAINT "tourist_tax_rules_property_date" UNIQUE ("property_id", "effective_from"),
  CONSTRAINT "tourist_tax_rules_charges_array" CHECK (jsonb_typeof("charges") = 'array'),
  CONSTRAINT "tourist_tax_rules_max_nights" CHECK ("max_nights" IS NULL OR "max_nights" > 0)
);

-- An early draft of this file had a breakfast exclusion. Tourist tax is on
-- the room price alone for now, so a database that ran that draft loses it.
ALTER TABLE "tourist_tax_rules" DROP COLUMN IF EXISTS "breakfast_exclusion_per_person";

-- What the booking owed, fixed when it was made, so a later rule change never
-- alters a past booking. Lines are the breakdown the host and guest were shown.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "tourist_tax_amount" numeric(10, 2) DEFAULT 0 NOT NULL;
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "tourist_tax_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;

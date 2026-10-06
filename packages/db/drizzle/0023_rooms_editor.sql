-- 0023_rooms_editor — what the host-facing Rooms editor stores.
--
-- Apply BY HAND (psql or the Neon SQL editor), BEFORE deploying the code that
-- reads it. Idempotent, and additive only: every column is new and either
-- nullable or defaulted, so the running release keeps working against it
-- (expand/contract — nothing here drops or renames).
--
-- Mirrors `rooms` and `ratePlans` in packages/db/src/schema.ts; keep the two
-- in sync.
--
-- What already existed and is reused rather than duplicated:
--   rooms.total_units            the units count. R&A's availability baseline
--                                reads it (COALESCE(room_inventory.total_rooms,
--                                rooms.total_units)), so it stays the one source.
--   rooms.is_active              "published". The guest page and search filter
--                                on it; a draft is simply not active.
--   rooms.bed_type               the derived bed label, still what guests read.
--   rate_plans.cancellation_policy  the free-text cancellation policy.
--   rate_plans.min_advance_booking  "book at least N days ahead". Nothing read it
--                                before this; R&A owns no advance-booking rule.

-- ── rooms ────────────────────────────────────────────────────────────────────

-- Display order on the guest carousel and the Rooms index.
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "sort_order" smallint DEFAULT 0 NOT NULL;

-- Soft delete. An archived room is hidden everywhere, but its rows stay: past
-- reservations reference it and must keep resolving.
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

-- Bed counts per bed type, e.g. {"king":1,"sofa_bed":1}. bed_type keeps the
-- derived display label ("1 King · 1 Sofa bed") because the guest app reads it.
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "bed_config" jsonb;

-- Room-level amenity keys from the editor's fixed list (ROOM_AMENITIES in
-- apps/business). Keys, not labels, so they can be localised later. NULL means
-- "never saved from the editor": the editor then derives a starting selection
-- from the legacy room_amenities rows instead of showing an empty list.
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "amenity_keys" text[];
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "featured_amenity_keys" text[] DEFAULT '{}'::text[] NOT NULL;

DO $$ BEGIN
  ALTER TABLE "rooms" ADD CONSTRAINT "rooms_featured_amenities_max"
    CHECK (cardinality("featured_amenity_keys") <= 6);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An archived room is never on sale.
DO $$ BEGIN
  ALTER TABLE "rooms" ADD CONSTRAINT "rooms_archived_not_active"
    CHECK ("archived_at" IS NULL OR NOT "is_active");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed the order from what guests see today (the page sorts by name), so the
-- carousel does not reshuffle the day this ships. Only rooms still at the
-- default are touched, which keeps a re-run from undoing a host's reorder.
UPDATE "rooms" r
SET "sort_order" = ranked.pos
FROM (
  SELECT id, (ROW_NUMBER() OVER (PARTITION BY property_id ORDER BY name, id) - 1)::smallint AS pos
  FROM "rooms"
) ranked
WHERE ranked.id = r.id
  AND r."sort_order" = 0
  AND NOT EXISTS (
    SELECT 1 FROM "rooms" o WHERE o.property_id = r.property_id AND o."sort_order" <> 0
  );

CREATE INDEX IF NOT EXISTS "idx_rooms_property_order" ON "rooms" ("property_id", "sort_order");

-- ── rate_plans ───────────────────────────────────────────────────────────────

-- Shown to guests under the rate name.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "description" varchar(200);

-- Meals are independent facts, not one meal-plan enum: "breakfast and dinner"
-- is half board, but "breakfast and lunch" is a real combination too.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "includes_breakfast" boolean DEFAULT false NOT NULL;
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "includes_lunch" boolean DEFAULT false NOT NULL;
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "includes_dinner" boolean DEFAULT false NOT NULL;

-- Extras from the editor's fixed list (RATE_EXTRAS), stored as keys.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "extras" text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "other_inclusion" varchar(120);

-- "Book at most N days ahead". NULL = no limit. The lower bound is the
-- existing min_advance_booking column.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "max_advance_booking" integer;

-- Display order within the room.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "sort_order" smallint DEFAULT 0 NOT NULL;

-- Soft delete. reservations.rate_plan_id references this table, so a rate that
-- was ever booked can never be removed.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;

DO $$ BEGIN
  ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_archived_not_active"
    CHECK ("archived_at" IS NULL OR NOT "is_active");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

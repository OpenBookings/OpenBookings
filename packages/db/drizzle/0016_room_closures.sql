-- 0016_room_closures — closing a whole room type, and naming who set a price.
--
-- Apply BY HAND, same as every file here: this repo has no drizzle journal, so
-- `bun run db:migrate` has no baseline to diff against. Every statement is
-- idempotent, so re-applying against an already-migrated database is a no-op.
--
-- Mirrors `roomClosures` and `rateOverrides.createdBy` in
-- packages/db/src/schema.ts; keep the two in sync.
--
-- Why a table rather than a flag on room_inventory: that table answers "how
-- many units are left", and the three ways of reaching zero are not the same
-- fact. Blocked units mean a broken room; an available_override of 0 reads as
-- sold out and sends the host looking for a booking that does not exist; a
-- closure is a decision someone made and can explain. The ARI grid has to tell
-- a host which one they are looking at, so the store has to keep them apart.
--
-- Shaped like rate_plan_restrictions (ranges, priority, soft delete, created_by)
-- so the grid reads both through the same kind of LATERAL, and so reopening a
-- date preserves the record of who closed it.

CREATE TABLE IF NOT EXISTS "room_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	-- Overlaps resolve by priority DESC, matching rate_overrides and
	-- rate_plan_restrictions.
	"priority" integer DEFAULT 0 NOT NULL,
	-- Soft delete. Reopening sets this false rather than removing the row, so
	-- the detail panel can still say who closed the dates and when.
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	-- Better Auth user id. Nullable: rows the system writes have no host behind
	-- them, and better a null than an invented author.
	"created_by" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_room_closures_room_dates"
	ON "room_closures" ("room_id", "start_date", "end_date");

-- An override is the one price step a person chose deliberately. Without an
-- author the grid's build-up can only report that an override exists, which is
-- the host's question rather than its answer.
ALTER TABLE "rate_overrides" ADD COLUMN IF NOT EXISTS "created_by" text;

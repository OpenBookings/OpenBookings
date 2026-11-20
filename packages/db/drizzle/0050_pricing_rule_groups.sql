-- 0050_pricing_rule_groups — one pricing rule across several rate plans.
--
-- A rate_modifiers row prices one rate plan, and the pricing engine keeps
-- reading it that way. What changes is how hosts manage them: the Pricing
-- rules page edits a rule once for every rate plan it applies to. Rows that
-- are one rule share a rule_group_id, one row per rate plan. Existing rows
-- each become a group of one.
--
-- applies_to_all marks a rule the host set for "All rate plans". Such a rule
-- also applies to rate plans added later: the trigger below copies it onto
-- every new rate plan of the same property, however the plan is created
-- (R&A, the Rooms editor, demo data).
--
-- And a lower last-minute price is now a stay discount (see isStayDiscount
-- in @openbookings/pricing), so like the other discounts (0042) it must be a
-- percentage. The form already refuses a lower fixed amount.
--
-- Idempotent: safe to replay (see packages/db/src/testing/pending-migrations.ts).

SET lock_timeout = '5s';

ALTER TABLE rate_modifiers ADD COLUMN IF NOT EXISTS rule_group_id uuid;

-- Rules that were copied by hand onto several rate plans of one property
-- (same kind, condition, amount and on/off) become one rule. Two identical
-- rows on the same rate plan stay two rules (`dup`), so the unique index
-- below holds.
WITH keyed AS (
  SELECT m.id, r.property_id, m.type, m.trigger_condition, m.adjustment_type,
         m.adjustment_value, m.is_active,
         row_number() OVER (
           PARTITION BY m.rate_plan_id, m.type, m.trigger_condition, m.adjustment_type,
                        m.adjustment_value, m.is_active
           ORDER BY m.id
         ) AS dup
  FROM rate_modifiers m
  JOIN rate_plans rp ON rp.id = m.rate_plan_id
  JOIN rooms r       ON r.id = rp.room_id
  WHERE m.rule_group_id IS NULL
),
grouped AS (
  SELECT id,
         (min(id::text) OVER (
           PARTITION BY property_id, type, trigger_condition, adjustment_type,
                        adjustment_value, is_active, dup
         ))::uuid AS group_id
  FROM keyed
)
UPDATE rate_modifiers m SET rule_group_id = g.group_id
FROM grouped g WHERE g.id = m.id;

UPDATE rate_modifiers SET rule_group_id = id WHERE rule_group_id IS NULL;
ALTER TABLE rate_modifiers ALTER COLUMN rule_group_id SET DEFAULT gen_random_uuid();
ALTER TABLE rate_modifiers ALTER COLUMN rule_group_id SET NOT NULL;

ALTER TABLE rate_modifiers ADD COLUMN IF NOT EXISTS applies_to_all boolean NOT NULL DEFAULT false;

-- A rule prices each rate plan at most once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_modifiers_group_plan
  ON rate_modifiers (rule_group_id, rate_plan_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_modifiers_last_minute_discount_percent') THEN
    ALTER TABLE rate_modifiers
      ADD CONSTRAINT rate_modifiers_last_minute_discount_percent
      CHECK (type <> 'last_minute' OR adjustment_value > 0 OR adjustment_type = 'percent');
  END IF;
END $$;

-- A new rate plan gets every "All rate plans" rule of its property.
CREATE OR REPLACE FUNCTION copy_all_plan_pricing_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rate_modifiers
    (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value,
     is_active, sort_order, rule_group_id, applies_to_all)
  SELECT DISTINCT ON (m.rule_group_id)
    NEW.id, m.type, m.trigger_condition, m.adjustment_type, m.adjustment_value,
    m.is_active, m.sort_order, m.rule_group_id, true
  FROM rate_modifiers m
  JOIN rate_plans rp ON rp.id = m.rate_plan_id
  JOIN rooms r       ON r.id = rp.room_id
  WHERE m.applies_to_all
    AND r.property_id = (SELECT property_id FROM rooms WHERE id = NEW.room_id)
    AND rp.id <> NEW.id
  ORDER BY m.rule_group_id, m.id
  ON CONFLICT (rule_group_id, rate_plan_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rate_plans_copy_pricing_rules ON rate_plans;
CREATE TRIGGER trg_rate_plans_copy_pricing_rules
  AFTER INSERT ON rate_plans
  FOR EACH ROW EXECUTE FUNCTION copy_all_plan_pricing_rules();

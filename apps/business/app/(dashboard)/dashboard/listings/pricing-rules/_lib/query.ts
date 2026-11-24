import { CURRENT_PROPERTY_SQL, getPropertyScopedDb, type SessionLike } from "@openbookings/authz";
import type { ModifierType } from "@openbookings/pricing";
import type { PlanOption, RuleGroup } from "./rule-model";

/**
 * The Pricing rules page's read layer. Bound to the current hotel like R&A:
 * `$1` is the user, `$2` the current hotel, and every row is joined back to
 * it. `db` is a seam for the DB-backed tests.
 */

type PropertyDb = Pick<ReturnType<typeof getPropertyScopedDb>, "query" | "queryOne">;

export type PricingRulesData = {
  property: { id: string; name: string };
  plans: PlanOption[];
  rules: RuleGroup[];
};

type ModifierRow = {
  id: string;
  rule_group_id: string;
  rate_plan_id: string;
  type: ModifierType;
  adjustment_type: "flat" | "percent";
  adjustment_value: string;
  trigger_condition: Record<string, unknown>;
  is_active: boolean;
  applies_to_all: boolean;
  sort_order: number;
};

const PROPERTY_SQL = `
SELECT p.id::text AS id, p.name FROM properties p
WHERE ${CURRENT_PROPERTY_SQL}`;

/** Rate plans that can carry a rule: not archived, on rooms that are not archived. */
const PLANS_SQL = `
SELECT rp.id::text AS id, rp.name, rp.bar_cents::float8 AS bar_cents, r.id::text AS room_id, r.name AS room_name
FROM rate_plans rp
JOIN rooms r      ON r.id = rp.room_id
JOIN properties p ON p.id = r.property_id
WHERE ${CURRENT_PROPERTY_SQL}
  AND r.archived_at IS NULL
  AND rp.archived_at IS NULL
ORDER BY r.sort_order NULLS LAST, r.name, rp.created_at, rp.name`;

const MODIFIERS_SQL = `
SELECT m.id::text AS id, m.rule_group_id::text AS rule_group_id, m.rate_plan_id::text AS rate_plan_id,
       m.type, m.adjustment_type, m.adjustment_value::text AS adjustment_value,
       m.trigger_condition, m.is_active, m.applies_to_all, m.sort_order
FROM rate_modifiers m
JOIN rate_plans rp ON rp.id = m.rate_plan_id
JOIN rooms r       ON r.id = rp.room_id
JOIN properties p  ON p.id = r.property_id
WHERE ${CURRENT_PROPERTY_SQL}
  AND m.type <> 'extra_guest'
  AND r.archived_at IS NULL
  AND rp.archived_at IS NULL
ORDER BY m.sort_order, m.id`;

/** One rule per group, in the order hosts added them. */
export function groupRules(rows: ModifierRow[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  for (const row of rows) {
    const existing = groups.get(row.rule_group_id);
    if (existing) {
      existing.ratePlanIds.push(row.rate_plan_id);
      // A group is switched on or off as a whole; if rows ever disagree, the
      // page shows it on, so the host can see it and switch it off.
      existing.active ||= row.is_active;
      existing.appliesToAll &&= row.applies_to_all;
      existing.sortOrder = Math.min(existing.sortOrder, row.sort_order);
      continue;
    }
    groups.set(row.rule_group_id, {
      id: row.rule_group_id,
      type: row.type,
      adjustmentType: row.adjustment_type,
      adjustmentValue: Number(row.adjustment_value),
      triggerCondition: row.trigger_condition,
      active: row.is_active,
      appliesToAll: row.applies_to_all,
      ratePlanIds: [row.rate_plan_id],
      sortOrder: row.sort_order,
    });
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The current hotel's plans and rules; null without a current hotel. */
export async function loadPricingRules(
  session: SessionLike,
  propertyId: string | null,
  db?: PropertyDb,
): Promise<PricingRulesData | null> {
  if (!propertyId) return null;
  const scoped = db ?? getPropertyScopedDb(session, propertyId);
  const property = await scoped.queryOne<{ id: string; name: string }>(PROPERTY_SQL);
  if (!property) return null;

  const [plans, rows] = await Promise.all([
    scoped.query<{ id: string; name: string; bar_cents: number; room_id: string; room_name: string }>(PLANS_SQL),
    scoped.query<ModifierRow>(MODIFIERS_SQL),
  ]);

  return {
    property,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      barCents: Number(p.bar_cents),
      roomId: p.room_id,
      roomName: p.room_name,
    })),
    rules: groupRules(rows),
  };
}

const GROUP_PROPERTY_SQL = `
SELECT r.property_id::text AS property_id
FROM rate_modifiers m
JOIN rate_plans rp ON rp.id = m.rate_plan_id
JOIN rooms r       ON r.id = rp.room_id
JOIN properties p  ON p.id = r.property_id
WHERE ${CURRENT_PROPERTY_SQL} AND m.rule_group_id = $3
LIMIT 1`;

/**
 * The page data for one rule's edit page; null for a rule the user can't
 * read, a rule of another hotel than the current one, or no such rule.
 */
export async function loadRuleGroup(
  session: SessionLike,
  propertyId: string | null,
  groupId: string,
  db?: PropertyDb,
): Promise<{ data: PricingRulesData; rule: RuleGroup } | null> {
  if (!propertyId || !/^[0-9a-f-]{36}$/i.test(groupId)) return null;
  const scoped = db ?? getPropertyScopedDb(session, propertyId);
  const owner = await scoped.queryOne<{ property_id: string }>(GROUP_PROPERTY_SQL, [groupId]);
  if (!owner) return null;
  const data = await loadPricingRules(session, propertyId, scoped);
  const rule = data?.rules.find((r) => r.id === groupId);
  return data && rule ? { data, rule } : null;
}

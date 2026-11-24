import { userOwnsProperty, type SessionLike } from "@openbookings/authz";
import { withTransaction } from "@openbookings/db";
import { MANAGED_BY_APP, MANAGED_BY_APP_MESSAGE } from "@/lib/apps/managed";
import { currentPropertyPin, pinnedAccess, switchedReason, type PinnedAccess } from "@/lib/current-property";
import { parseRuleGroupForm, type RuleGroupForm } from "./rule-group-schema";

/**
 * Writes behind the Pricing rules page. A rule is one `rate_modifiers` row
 * per rate plan, sharing `rule_group_id` (0050); every write here touches the
 * whole group in one transaction, so the plans never disagree.
 *
 * Ownership: the caller must be able to edit the property, and every rate
 * plan and every existing row of the group must belong to it. An id the
 * caller doesn't own gets the same answer as one that doesn't exist. The
 * property must also be the current hotel: a stale tab still showing another
 * hotel is refused with `reason: "property-switched"`.
 */

export type TxDb = { query: <T>(text: string, values?: unknown[]) => Promise<T[]> };

export type RuleGroupDeps = {
  tx: <T>(fn: (db: TxDb) => Promise<T>) => Promise<T>;
  /** May the caller edit this property, pinned to the current hotel. */
  editAccess: (session: SessionLike, propertyId: string) => Promise<PinnedAccess>;
  newId: () => string;
};

const defaultDeps: RuleGroupDeps = {
  tx: (fn) => withTransaction((client) => fn({ query: async (text, values) => (await client.query(text, values)).rows })),
  editAccess: async (session, propertyId) =>
    pinnedAccess(await currentPropertyPin(), (pin) => userOwnsProperty(session, propertyId, pin)),
  newId: () => crypto.randomUUID(),
};

export type RuleGroupResult =
  | { ok: true; groupId: string; propertyId: string }
  | {
      ok: false;
      error: string;
      errors?: Record<string, string[] | undefined>;
      /** A connected app manages this hotel's rates, so rules do not apply to it. */
      code?: typeof MANAGED_BY_APP;
      /** The rule's hotel is not the current one (a stale tab). */
      reason?: "property-switched";
    };

/** Rules do not apply to rates a connected app sets, so a managed hotel's rules are read-only. */
async function managedRefusal(db: TxDb, propertyId: string): Promise<RuleGroupResult | null> {
  const rows = await db.query(
    `SELECT 1 AS managed FROM app_installations WHERE property_id = $1 AND status = 'active' LIMIT 1`,
    [propertyId],
  );
  return rows.length > 0 ? { ok: false, error: MANAGED_BY_APP_MESSAGE, code: MANAGED_BY_APP } : null;
}

const notFound = (access: PinnedAccess = "denied"): RuleGroupResult => ({
  ok: false,
  error: "Rule not found",
  ...switchedReason(access),
});

export type SaveRuleGroupInput = RuleGroupForm & { propertyId: string; groupId?: string };

/** The rate plans of a property that can carry a rule. */
const PROPERTY_PLANS_SQL = `
SELECT rp.id::text AS id
FROM rate_plans rp
JOIN rooms r ON r.id = rp.room_id
WHERE r.property_id = $1 AND r.archived_at IS NULL AND rp.archived_at IS NULL`;

/** The rows of a group, each with the property its rate plan belongs to. */
const GROUP_ROWS_SQL = `
SELECT m.rate_plan_id::text AS rate_plan_id, m.is_active, r.property_id::text AS property_id
FROM rate_modifiers m
JOIN rate_plans rp ON rp.id = m.rate_plan_id
JOIN rooms r       ON r.id = rp.room_id
WHERE m.rule_group_id = $1`;

type GroupRow = { rate_plan_id: string; is_active: boolean; property_id: string };

/** The property a group belongs to, when the caller may edit it; otherwise why not. */
async function ownedGroupProperty(
  session: SessionLike,
  groupId: string,
  db: TxDb,
  deps: RuleGroupDeps,
): Promise<{ propertyId: string; rows: GroupRow[] } | { refused: PinnedAccess }> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return { refused: "denied" };
  const rows = await db.query<GroupRow>(GROUP_ROWS_SQL, [groupId]);
  if (rows.length === 0) return { refused: "denied" };
  const propertyId = rows[0].property_id;
  if (rows.some((r) => r.property_id !== propertyId)) return { refused: "denied" };
  const access = await deps.editAccess(session, propertyId);
  return access === "ok" ? { propertyId, rows } : { refused: access };
}

export async function saveRuleGroup(
  session: SessionLike,
  input: SaveRuleGroupInput,
  deps: RuleGroupDeps = defaultDeps,
): Promise<RuleGroupResult> {
  const parsed = parseRuleGroupForm(input);
  if (!parsed.ok) return { ok: false, error: "Check the highlighted fields.", errors: parsed.errors };
  const rule = parsed.data;

  if (!input.propertyId) return notFound();
  const access = await deps.editAccess(session, input.propertyId);
  if (access !== "ok") return notFound(access);

  return deps.tx(async (db) => {
    const managed = await managedRefusal(db, input.propertyId);
    if (managed) return managed;
    const propertyPlans = new Set(
      (await db.query<{ id: string }>(PROPERTY_PLANS_SQL, [input.propertyId])).map((p) => p.id),
    );
    if (rule.ratePlanIds.some((id) => !propertyPlans.has(id))) return { ok: false, error: "Rate plan not found" };
    const targets = rule.appliesToAll ? [...propertyPlans] : rule.ratePlanIds;
    if (targets.length === 0) return { ok: false, error: "Add a rate plan to a room first." };

    let groupId: string;
    let active = true;
    if (input.groupId) {
      const owned = await ownedGroupProperty(session, input.groupId, db, deps);
      if ("refused" in owned) return notFound(owned.refused);
      if (owned.propertyId !== input.propertyId) return notFound();
      groupId = input.groupId;
      active = owned.rows.some((r) => r.is_active);
      await db.query(
        `DELETE FROM rate_modifiers WHERE rule_group_id = $1 AND NOT (rate_plan_id = ANY($2::uuid[]))`,
        [groupId, targets],
      );
    } else {
      groupId = deps.newId();
    }

    await db.query(
      `INSERT INTO rate_modifiers
         (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value,
          is_active, sort_order, rule_group_id, applies_to_all)
       SELECT t.plan, $2::rate_modifier_type, $3::jsonb, $4::adjustment_type, $5, $6,
              (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM rate_modifiers WHERE rate_plan_id = t.plan),
              $7, $8
       FROM unnest($1::uuid[]) AS t(plan)
       ON CONFLICT (rule_group_id, rate_plan_id) DO UPDATE SET
         type = EXCLUDED.type,
         trigger_condition = EXCLUDED.trigger_condition,
         adjustment_type = EXCLUDED.adjustment_type,
         adjustment_value = EXCLUDED.adjustment_value,
         applies_to_all = EXCLUDED.applies_to_all`,
      [
        targets,
        rule.type,
        JSON.stringify(rule.triggerCondition),
        rule.adjustmentType,
        rule.adjustmentValue,
        active,
        groupId,
        rule.appliesToAll,
      ],
    );
    return { ok: true, groupId, propertyId: input.propertyId };
  });
}

export async function setRuleGroupActive(
  session: SessionLike,
  groupId: string,
  active: boolean,
  deps: RuleGroupDeps = defaultDeps,
): Promise<RuleGroupResult> {
  return deps.tx(async (db) => {
    const owned = await ownedGroupProperty(session, groupId, db, deps);
    if ("refused" in owned) return notFound(owned.refused);
    const managed = await managedRefusal(db, owned.propertyId);
    if (managed) return managed;
    await db.query(`UPDATE rate_modifiers SET is_active = $1 WHERE rule_group_id = $2`, [active, groupId]);
    return { ok: true, groupId, propertyId: owned.propertyId };
  });
}

export async function deleteRuleGroup(
  session: SessionLike,
  groupId: string,
  deps: RuleGroupDeps = defaultDeps,
): Promise<RuleGroupResult> {
  return deps.tx(async (db) => {
    const owned = await ownedGroupProperty(session, groupId, db, deps);
    if ("refused" in owned) return notFound(owned.refused);
    const managed = await managedRefusal(db, owned.propertyId);
    if (managed) return managed;
    await db.query(`DELETE FROM rate_modifiers WHERE rule_group_id = $1`, [groupId]);
    return { ok: true, groupId, propertyId: owned.propertyId };
  });
}

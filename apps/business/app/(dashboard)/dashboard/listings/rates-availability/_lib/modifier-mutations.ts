import { userOwnsRatePlan, type SessionLike } from "@openbookings/authz";
import { queryOne as dbQueryOne } from "@openbookings/db";
import { modifierSchema } from "./modifier-schema";

/**
 * Writes behind the pricing rules of a rate plan. Ownership is checked on
 * every call through @openbookings/authz; an id the caller doesn't own gets
 * the same answer as one that doesn't exist. The server actions in
 * actions.ts wrap these with the session, revalidation and the page purge.
 */

export type ModifierDeps = {
  queryOne: <T>(text: string, values?: unknown[]) => Promise<T | null>;
};

const defaultDeps: ModifierDeps = { queryOne: dbQueryOne };

export type ModifierResult =
  | { ok: true; id: string; roomId: string }
  | { ok: false; error: string; errors?: Record<string, string[] | undefined> };

/** What the rule editor posts: the rate plan, the rule when editing, and the fields modifierSchema reads. */
export type ModifierForm = { ratePlanId: string; modifierId?: string } & Record<string, unknown>;

const NOT_FOUND = { ok: false, error: "Rule not found" } as const;

/** Columns every write returns, so the caller can purge the room's listing page. */
const RETURNING = `RETURNING id, (SELECT room_id FROM rate_plans WHERE id = rate_plan_id) AS room_id`;

/** The rate plan a rule belongs to, but only for a caller who owns that plan. */
async function ownedRulePlan(session: SessionLike, modifierId: string, deps: ModifierDeps): Promise<string | null> {
  const row = await deps.queryOne<{ rate_plan_id: string }>(
    `SELECT m.rate_plan_id FROM rate_modifiers m WHERE m.id = $1`,
    [modifierId],
  );
  if (!row) return null;
  return (await userOwnsRatePlan(session, row.rate_plan_id, { queryOne: deps.queryOne })) ? row.rate_plan_id : null;
}

export async function saveModifier(
  session: SessionLike,
  form: ModifierForm,
  deps: ModifierDeps = defaultDeps,
): Promise<ModifierResult> {
  if (!(await userOwnsRatePlan(session, form.ratePlanId, { queryOne: deps.queryOne }))) return NOT_FOUND;
  if (form.modifierId && (await ownedRulePlan(session, form.modifierId, deps)) !== form.ratePlanId) return NOT_FOUND;

  const parsed = modifierSchema.safeParse(form);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      errors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>,
    };
  }
  const d = parsed.data;
  const condition = JSON.stringify(d.triggerCondition);

  const row = form.modifierId
    ? await deps.queryOne<{ id: string; room_id: string }>(
        `UPDATE rate_modifiers
         SET type = $1::rate_modifier_type, trigger_condition = $2::jsonb,
             adjustment_type = $3::adjustment_type, adjustment_value = $4
         WHERE id = $5
         ${RETURNING}`,
        [d.type, condition, d.adjustmentType, d.adjustmentValue, form.modifierId],
      )
    : await deps.queryOne<{ id: string; room_id: string }>(
        `INSERT INTO rate_modifiers
           (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
         VALUES ($1, $2::rate_modifier_type, $3::jsonb, $4::adjustment_type, $5, true,
                 (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM rate_modifiers WHERE rate_plan_id = $1))
         ${RETURNING}`,
        [form.ratePlanId, d.type, condition, d.adjustmentType, d.adjustmentValue],
      );
  return row ? { ok: true, id: row.id, roomId: row.room_id } : NOT_FOUND;
}

export async function setModifierActive(
  session: SessionLike,
  modifierId: string,
  active: boolean,
  deps: ModifierDeps = defaultDeps,
): Promise<ModifierResult> {
  if (!(await ownedRulePlan(session, modifierId, deps))) return NOT_FOUND;
  const row = await deps.queryOne<{ id: string; room_id: string }>(
    `UPDATE rate_modifiers SET is_active = $1 WHERE id = $2 ${RETURNING}`,
    [active, modifierId],
  );
  return row ? { ok: true, id: row.id, roomId: row.room_id } : NOT_FOUND;
}

export async function deleteModifier(
  session: SessionLike,
  modifierId: string,
  deps: ModifierDeps = defaultDeps,
): Promise<ModifierResult> {
  if (!(await ownedRulePlan(session, modifierId, deps))) return NOT_FOUND;
  const row = await deps.queryOne<{ id: string; room_id: string }>(
    `DELETE FROM rate_modifiers WHERE id = $1 ${RETURNING}`,
    [modifierId],
  );
  return row ? { ok: true, id: row.id, roomId: row.room_id } : NOT_FOUND;
}

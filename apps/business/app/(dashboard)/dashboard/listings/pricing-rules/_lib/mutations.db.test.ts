/**
 * The Pricing rules writes against Postgres: one rule on several rate plans
 * (0050), the trigger that gives new rate plans the "All rate plans" rules,
 * and the ownership checks. Property ownership is the fake's job here; every
 * statement runs for real in a transaction that is rolled back. Skipped
 * locally without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { deleteRuleGroup, saveRuleGroup, setRuleGroupActive, type RuleGroupDeps } from "./mutations";
import type { RuleGroupForm } from "./rule-group-schema";

describeWithDb("pricing rule groups against Postgres", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let secondPlan: string;
  const owner = { user: { id: "host-owner", account_type: "business" } };

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    ids = await seedProperty(db);
    secondPlan = await addPlan(ids.roomId, "Non-refundable");
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const addPlan = async (roomId: string, name: string) =>
    (
      await db.query(`INSERT INTO rate_plans (room_id, name, bar_cents, is_refundable, is_active) VALUES ($1, $2, 9000, true, true) RETURNING id`, [
        roomId,
        name,
      ])
    ).rows[0].id as string;

  /** Editable properties: the seeded one only. */
  const deps = (editable = [ids.propertyId]): RuleGroupDeps => ({
    tx: (fn) => fn({ query: async (text, values) => (await db.query(text, values)).rows }),
    editAccess: async (_session, propertyId) => (editable.includes(propertyId) ? "ok" : "denied"),
    newId: () => crypto.randomUUID(),
  });

  const weekly: RuleGroupForm = {
    section: "discount",
    kind: "length_of_stay",
    direction: "down",
    adjustmentType: "percent",
    amount: "10",
    daysOfWeek: [],
    minNights: "7",
    daysBeforeArrival: "",
    daysTillArrival: "",
    scope: "all",
    ratePlanIds: [],
  };

  const rows = async (groupId: string) =>
    (
      await db.query(
        `SELECT rate_plan_id::text AS plan, type, adjustment_value::int AS value, is_active, applies_to_all
         FROM rate_modifiers WHERE rule_group_id = $1 ORDER BY rate_plan_id`,
        [groupId],
      )
    ).rows;

  test("a rule for all rate plans is one row per plan, and new plans get it too", async () => {
    const saved = await saveRuleGroup(owner, { ...weekly, propertyId: ids.propertyId }, deps());
    if (!saved.ok) throw new Error(saved.error);
    expect((await rows(saved.groupId)).map((r) => r.plan).sort()).toEqual([ids.ratePlanId, secondPlan].sort());

    const later = await addPlan(ids.roomId, "Breakfast included");
    const copied = (await rows(saved.groupId)).find((r) => r.plan === later);
    expect(copied).toEqual({ plan: later, type: "length_of_stay", value: -10, is_active: true, applies_to_all: true });
  });

  test("a rule for chosen plans is not copied to new plans", async () => {
    const saved = await saveRuleGroup(
      owner,
      { ...weekly, scope: "some", ratePlanIds: [ids.ratePlanId], propertyId: ids.propertyId },
      deps(),
    );
    if (!saved.ok) throw new Error(saved.error);
    await addPlan(ids.roomId, "Breakfast included");
    expect((await rows(saved.groupId)).map((r) => r.plan)).toEqual([ids.ratePlanId]);
  });

  test("editing narrows the plans, changes the amount and keeps the rule switched off", async () => {
    const saved = await saveRuleGroup(owner, { ...weekly, propertyId: ids.propertyId }, deps());
    if (!saved.ok) throw new Error(saved.error);
    expect((await setRuleGroupActive(owner, saved.groupId, false, deps())).ok).toBe(true);

    const edited = await saveRuleGroup(
      owner,
      { ...weekly, amount: "12", scope: "some", ratePlanIds: [secondPlan], propertyId: ids.propertyId, groupId: saved.groupId },
      deps(),
    );
    expect(edited.ok).toBe(true);
    expect(await rows(saved.groupId)).toEqual([
      { plan: secondPlan, type: "length_of_stay", value: -12, is_active: false, applies_to_all: false },
    ]);

    expect((await deleteRuleGroup(owner, saved.groupId, deps())).ok).toBe(true);
    expect(await rows(saved.groupId)).toEqual([]);
  });

  test("another property's rate plans and rules are refused, the same as unknown ids", async () => {
    const other = await seedProperty(db);
    const foreignPlan = await saveRuleGroup(
      owner,
      { ...weekly, scope: "some", ratePlanIds: [other.ratePlanId], propertyId: ids.propertyId },
      deps(),
    );
    expect(foreignPlan).toEqual({ ok: false, error: "Rate plan not found" });

    // A rule on the other property, which this caller may not edit.
    const theirs = await saveRuleGroup(owner, { ...weekly, propertyId: other.propertyId }, deps([other.propertyId]));
    if (!theirs.ok) throw new Error(theirs.error);
    expect(await setRuleGroupActive(owner, theirs.groupId, false, deps())).toEqual({ ok: false, error: "Rule not found" });
    expect(await deleteRuleGroup(owner, theirs.groupId, deps())).toEqual({ ok: false, error: "Rule not found" });
    expect(
      await saveRuleGroup(owner, { ...weekly, propertyId: ids.propertyId, groupId: theirs.groupId }, deps()),
    ).toEqual({ ok: false, error: "Rule not found" });
    expect((await rows(theirs.groupId)).every((r) => r.is_active)).toBe(true);
  });

  test('a flat weekend surcharge of "15.50" stores 1550 cents', async () => {
    const weekend: RuleGroupForm = {
      ...weekly,
      section: "adjustment",
      kind: "weekend",
      direction: "up",
      adjustmentType: "flat",
      amount: "15.50",
      daysOfWeek: ["5", "6"],
      minNights: "",
    };
    const saved = await saveRuleGroup(owner, { ...weekend, propertyId: ids.propertyId }, deps());
    if (!saved.ok) throw new Error(saved.error);
    const stored = await rows(saved.groupId);
    expect(stored.map((r) => [r.type, r.value])).toEqual([
      ["day_of_week", 1550],
      ["day_of_week", 1550],
    ]);
  });

  test("the database refuses a lower last-minute fixed amount", async () => {
    await db.query("SAVEPOINT before_check");
    await expect(
      db.query(
        `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value)
         VALUES ($1, 'last_minute', '{"days_till_arrival": 3}', 'flat', -10)`,
        [ids.ratePlanId],
      ),
    ).rejects.toThrow(/rate_modifiers_last_minute_discount_percent/);
    await db.query("ROLLBACK TO SAVEPOINT before_check");
  });
});

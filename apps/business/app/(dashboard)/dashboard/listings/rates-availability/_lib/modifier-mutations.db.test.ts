/**
 * The pricing-rule writes against Postgres: the SQL, the enums and the
 * discount-sign constraint (0041). Ownership is the fake's job here (see
 * modifier-mutations.test.ts); every other statement runs for real in a
 * transaction that is rolled back. Skipped locally without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { deleteModifier, saveModifier, setModifierActive, type ModifierDeps } from "./modifier-mutations";

describeWithDb("pricing rules against Postgres", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
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
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const deps = (): ModifierDeps => ({
    queryOne: async <T,>(sql: string, values?: unknown[]) =>
      /SELECT TRUE AS ok/.test(sql) ? ({ ok: true } as T) : (((await db.query(sql, values)).rows[0] ?? null) as T | null),
  });
  const rules = async () =>
    (
      await db.query(
        `SELECT type, trigger_condition, adjustment_type, adjustment_value::int AS value, is_active, sort_order
         FROM rate_modifiers WHERE rate_plan_id = $1 ORDER BY sort_order`,
        [ids.ratePlanId],
      )
    ).rows;

  test("create, edit, switch off and delete a rule", async () => {
    const weekend = { kind: "weekend", direction: "up", adjustmentType: "flat", amount: "30", daysOfWeek: ["5", "6"] };
    const created = await saveModifier(owner, { ratePlanId: ids.ratePlanId, ...weekend }, deps());
    if (!created.ok) throw new Error(created.error);
    expect(created.roomId).toBe(ids.roomId);

    const stay = { kind: "length_of_stay", adjustmentType: "percent", amount: "10", minNights: "7" };
    expect((await saveModifier(owner, { ratePlanId: ids.ratePlanId, ...stay }, deps())).ok).toBe(true);
    expect(await rules()).toEqual([
      { type: "day_of_week", trigger_condition: { days_of_week: [5, 6] }, adjustment_type: "flat", value: 30, is_active: true, sort_order: 0 },
      { type: "length_of_stay", trigger_condition: { min_nights: 7 }, adjustment_type: "percent", value: -10, is_active: true, sort_order: 1 },
    ]);

    const edited = await saveModifier(owner, { ratePlanId: ids.ratePlanId, modifierId: created.id, ...weekend, amount: "40" }, deps());
    expect(edited.ok).toBe(true);
    expect((await setModifierActive(owner, created.id, false, deps())).ok).toBe(true);
    expect((await rules())[0]).toMatchObject({ value: 40, is_active: false });

    expect((await deleteModifier(owner, created.id, deps())).ok).toBe(true);
    expect((await rules()).map((r) => r.type)).toEqual(["length_of_stay"]);
  });
});

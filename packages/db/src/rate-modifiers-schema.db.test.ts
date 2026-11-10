/**
 * rate_modifiers rules the database enforces (0041). Every test runs in a
 * transaction that is rolled back; skipped locally without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "./testing/db-harness";

describeWithDb("rate_modifiers against Postgres", () => {
  let db: Client;
  let ratePlanId: string;

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
    ({ ratePlanId } = await seedProperty(db));
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const insert = (type: string, value: number) =>
    db.query(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
       VALUES ($1, $2::rate_modifier_type, '{"min_nights": 3, "days_before_arrival": 30}'::jsonb, 'percent', $3, true, 0)`,
      [ratePlanId, type, value],
    );

  test("a discount is stored as a negative amount", async () => {
    for (const type of ["length_of_stay", "early_bird"]) {
      await db.query("SAVEPOINT s");
      await expect(insert(type, 10)).rejects.toThrow(/rate_modifiers_discount_sign/);
      await db.query("ROLLBACK TO SAVEPOINT s");
    }
  });

  test("a discount below zero and a surcharge either way are fine", async () => {
    await insert("length_of_stay", -10);
    await insert("day_of_week", 20);
    await insert("last_minute", -5);
  });
});

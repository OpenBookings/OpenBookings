import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedGuest, seedProperty } from "./testing/db-harness";

describeWithDb("booking intents schema against Postgres", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let userId: string;

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
    userId = await seedGuest(db);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const insertIntent = async (opts: { checkOut?: string; status?: string } = {}) =>
    (
      await db.query(
        `INSERT INTO booking_intents
           (user_id, property_id, check_in_date, check_out_date, hold_expires_at, snapshot, total_amount, status)
         VALUES ($1, $2, '2031-11-10', $3, now() + interval '15 minutes', '{}'::jsonb, 200.00, COALESCE($4, 'open'))
         RETURNING id, status`,
        [userId, ids.propertyId, opts.checkOut ?? "2031-11-12", opts.status ?? null],
      )
    ).rows[0] as { id: string; status: string };

  test("an intent and its room insert, status defaults to open", async () => {
    const intent = await insertIntent();
    expect(intent.status).toBe("open");
    const room = (
      await db.query(
        `INSERT INTO booking_intent_rooms (intent_id, room_id, rate_plan_id, adults, nights, stay_total)
         VALUES ($1, $2, $3, 2, '[100,100]'::jsonb, 200.00)
         RETURNING children, tourist_tax_amount, tourist_tax_lines, sort_order`,
        [intent.id, ids.roomId, ids.ratePlanId],
      )
    ).rows[0];
    expect(room.children).toBe(0);
    expect(Number(room.tourist_tax_amount)).toBe(0);
    expect(room.tourist_tax_lines).toEqual([]);
    expect(room.sort_order).toBe(0);
  });

  test("check_out_date must be after check_in_date", async () => {
    await expect(insertIntent({ checkOut: "2031-11-10" })).rejects.toThrow();
  });

  test("status must be a known value", async () => {
    await expect(insertIntent({ status: "bogus" })).rejects.toThrow();
  });

  test("nights must be a json array", async () => {
    const intent = await insertIntent();
    await expect(
      db.query(
        `INSERT INTO booking_intent_rooms (intent_id, room_id, rate_plan_id, adults, nights, stay_total)
         VALUES ($1, $2, $3, 2, '{}'::jsonb, 200.00)`,
        [intent.id, ids.roomId, ids.ratePlanId],
      ),
    ).rejects.toThrow();
  });

  test("properties.is_demo defaults to false", async () => {
    const row = (await db.query(`SELECT is_demo FROM properties WHERE id = $1`, [ids.propertyId])).rows[0];
    expect(row.is_demo).toBe(false);
  });
});

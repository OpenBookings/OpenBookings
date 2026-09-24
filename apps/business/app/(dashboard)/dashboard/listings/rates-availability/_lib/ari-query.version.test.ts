/**
 * VERSION_SQL against a real Postgres.
 *
 * This query exists to stop one host publishing over another's edits, so the
 * property under test is narrow and absolute: if anything the grid rendered
 * has changed, the digest must change too. The cases below are the changes a
 * naive implementation misses — a soft delete (which touches no timestamp), a
 * priority tie-break, and an edit just outside the window (which must *not*
 * invalidate anyone).
 *
 * Same harness as ari-query.availability.test.ts: a transaction per test,
 * rolled back, against a throwaway database.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { VERSION_SQL } from "./ari-query";

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.CI) {
  throw new Error(
    "DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.",
  );
}

const describeWithDb = connectionString ? describe : describe.skip;

const RANGE_START = "2031-03-09";
const RANGE_END = "2031-03-13";

describeWithDb("VERSION_SQL", () => {
  let db: Client;
  let ownerUserId: string;
  let propertyId: string;
  let roomId: string;
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

    ownerUserId = `test-business-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, 'Test business', $2, true, 'business'::account_type)`,
      [ownerUserId, `${ownerUserId}@example.test`],
    );

    const property = await db.query<{ id: string }>(
      `INSERT INTO properties
         (name, slug, address_line_1, city, country, timezone, location,
          check_in_time, check_out_time, owner_user_id, is_active)
       VALUES ('Test Property', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326),
               '15:00', '11:00', $2, true)
       RETURNING id`,
      [`test-property-${crypto.randomUUID()}`, ownerUserId],
    );
    propertyId = property.rows[0].id;

    const room = await db.query<{ id: string }>(
      `INSERT INTO rooms
         (property_id, name, base_occupancy, max_adults, total_units, is_active)
       VALUES ($1, 'Double', 2, 2, 5, true)
       RETURNING id`,
      [propertyId],
    );
    roomId = room.rows[0].id;

    const ratePlan = await db.query<{ id: string }>(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable)
       VALUES ($1, 'Standard', 10000, true)
       RETURNING id`,
      [roomId],
    );
    ratePlanId = ratePlan.rows[0].id;
  });

  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  async function version(
    start = RANGE_START,
    end = RANGE_END,
    owner = ownerUserId,
  ): Promise<string> {
    const result = await db.query<{ version: string }>(VERSION_SQL, [
      owner,
      propertyId,
      start,
      end,
    ]);
    return result.rows[0].version;
  }

  test("a window with no rules has a stable, non-null version", async () => {
    expect(await version()).toBe("empty");
    expect(await version()).toBe("empty");
  });

  test("the same state digests the same twice", async () => {
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-03-10', '2031-03-11', 12000)`,
      [ratePlanId],
    );
    expect(await version()).toBe(await version());
  });

  test("adding an override changes it", async () => {
    const before = await version();
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-03-10', '2031-03-11', 12000)`,
      [ratePlanId],
    );
    expect(await version()).not.toBe(before);
  });

  test("repricing an existing override changes it", async () => {
    const override = await db.query<{ id: string }>(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-03-10', '2031-03-11', 12000)
       RETURNING id`,
      [ratePlanId],
    );
    const before = await version();

    await db.query(`UPDATE rate_overrides SET price_per_night = 13000 WHERE id = $1`, [
      override.rows[0].id,
    ]);

    expect(await version()).not.toBe(before);
  });

  test("a soft delete changes it, though it touches no timestamp", async () => {
    // The case a max(updated_at) version cannot see at all: the row still
    // exists, its created_at is unchanged, and the grid now renders an open
    // date where it rendered a closed one.
    const closure = await db.query<{ id: string }>(
      `INSERT INTO rate_plan_restrictions
         (rate_plan_id, start_date, end_date, is_closed)
       VALUES ($1, '2031-03-10', '2031-03-11', TRUE)
       RETURNING id`,
      [ratePlanId],
    );
    const before = await version();

    await db.query(`UPDATE rate_plan_restrictions SET is_active = FALSE WHERE id = $1`, [
      closure.rows[0].id,
    ]);

    expect(await version()).not.toBe(before);
  });

  test("a room closure changes it", async () => {
    const before = await version();
    await db.query(
      `INSERT INTO room_closures (room_id, start_date, end_date)
       VALUES ($1, '2031-03-10', '2031-03-11')`,
      [roomId],
    );
    expect(await version()).not.toBe(before);
  });

  test("a priority change alone changes it", async () => {
    // Two rows covering one date resolve by priority, so reordering them
    // changes what the grid shows without changing any other column.
    const closure = await db.query<{ id: string }>(
      `INSERT INTO room_closures (room_id, start_date, end_date, priority)
       VALUES ($1, '2031-03-10', '2031-03-11', 0)
       RETURNING id`,
      [roomId],
    );
    const before = await version();

    await db.query(`UPDATE room_closures SET priority = 5 WHERE id = $1`, [
      closure.rows[0].id,
    ]);

    expect(await version()).not.toBe(before);
  });

  test("blocking a unit changes it", async () => {
    const before = await version();
    await db.query(
      `INSERT INTO room_inventory (room_id, date, blocked_rooms)
       VALUES ($1, '2031-03-10', 2)`,
      [roomId],
    );
    expect(await version()).not.toBe(before);
  });

  test("an edit outside the window leaves it alone", async () => {
    // Otherwise a host publishing this week is bounced by somebody repricing
    // next winter, and learns to click through the warning.
    const before = await version();
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-06-01', '2031-06-07', 12000)`,
      [ratePlanId],
    );
    expect(await version()).toBe(before);
  });

  test("a rule overlapping only the window's edge still counts", async () => {
    const before = await version();
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-03-01', '2031-03-09', 12000)`,
      [ratePlanId],
    );
    expect(await version()).not.toBe(before);
  });

  test("a different window digests independently", async () => {
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-03-10', '2031-03-11', 12000)`,
      [ratePlanId],
    );
    expect(await version("2031-04-01", "2031-04-07")).toBe("empty");
  });

  test("another host's window is not visible", async () => {
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-03-10', '2031-03-11', 12000)`,
      [ratePlanId],
    );
    expect(await version(RANGE_START, RANGE_END, "some-other-host")).toBe("empty");
  });
});

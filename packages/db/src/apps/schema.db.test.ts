/** drizzle/0060_apps_api.sql: channel codes, app installations, app ARI tables, booking event ordering. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { pendingMigrationSql } from "../testing/pending-migrations";
import { recordBookingEvent } from "../booking-events";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";

describeWithDb("apps schema (0060)", () => {
  let db: Client;

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
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  /** Run a statement that must fail, inside a savepoint so the transaction survives. */
  async function rejects(sqlText: string, values: unknown[] = []): Promise<void> {
    await db.query("SAVEPOINT s");
    let failed = false;
    try {
      await db.query(sqlText, values);
    } catch {
      failed = true;
    }
    await db.query("ROLLBACK TO SAVEPOINT s");
    expect(failed).toBe(true);
  }

  const insertInstallation = (propertyId: string, status: string, hash: string) =>
    db.query(
      `INSERT INTO app_installations (property_id, app_key, status, key_hash, key_last4, connected_at)
       VALUES ($1, 'siteminder', $2, $3, 'abcd', now())`,
      [propertyId, status, hash],
    );

  test("channel codes are set, alphanumeric and unique", async () => {
    const a = await seedProperty(db);
    const b = await seedProperty(db);
    const code = async (table: string, id: string) =>
      ((await db.query(`SELECT channel_code FROM ${table} WHERE id = $1`, [id])).rows[0] as { channel_code: string })
        .channel_code;
    const aCodes = [
      await code("properties", a.propertyId),
      await code("rooms", a.roomId),
      await code("rate_plans", a.ratePlanId),
    ];
    expect(aCodes[0]).toMatch(/^OB[0-9A-F]{10}$/);
    expect(aCodes[1]).toMatch(/^R[0-9A-F]{11}$/);
    expect(aCodes[2]).toMatch(/^P[0-9A-F]{11}$/);
    expect(await code("properties", b.propertyId)).not.toBe(aCodes[0]);
    await rejects(`UPDATE properties SET channel_code = $1 WHERE id = $2`, [aCodes[0], b.propertyId]);
  });

  test("channel codes cannot change", async () => {
    const { roomId } = await seedProperty(db);
    await rejects(`UPDATE rooms SET channel_code = 'RXXXXXXXXXXX' WHERE id = $1`, [roomId]);
  });

  test("one active installation per property", async () => {
    const { propertyId } = await seedProperty(db);
    await insertInstallation(propertyId, "active", "hash-1");
    await rejects(
      `INSERT INTO app_installations (property_id, app_key, status, key_hash, key_last4, connected_at)
       VALUES ($1, 'siteminder', 'active', 'hash-2', 'abcd', now())`,
      [propertyId],
    );
    await insertInstallation(propertyId, "disconnected", "hash-3");
  });

  test("booking events get txid and seq", async () => {
    const ids = await seedProperty(db);
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-03-10", nights: 2 });
    await recordBookingEvent(db, { bookingId, kind: "confirmed", actor: { kind: "system", id: null } });
    const row = (await db.query(`SELECT txid::text AS txid, seq FROM booking_events WHERE booking_id = $1`, [bookingId]))
      .rows[0] as { txid: string | null; seq: string | null };
    expect(row.txid).not.toBeNull();
    expect(row.seq).not.toBeNull();
  });

  test("the migration replays cleanly", async () => {
    const { roomId } = await seedProperty(db);
    const before = (await db.query(`SELECT channel_code FROM rooms WHERE id = $1`, [roomId])).rows[0];
    await db.query(pendingMigrationSql("0060_apps_api.sql"));
    const after = (await db.query(`SELECT channel_code FROM rooms WHERE id = $1`, [roomId])).rows[0];
    expect(after).toEqual(before);
  });

  /** Two property ids sharing their first 18 hex digits, as hand-written seed and demo ids do. */
  const handcrafted = (n: number) => `0b1c0de0-2031-0000-0000-${String(n).padStart(12, "0")}`;
  const insertProperty = (id: string) =>
    db.query(
      `INSERT INTO properties (id, name, slug, address_line_1, city, country, timezone, location, check_in_time, check_in_until, check_out_time)
       VALUES ($1, 'Handcrafted', $2, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326), '15:00', '22:00', '11:00')`,
      [id, `test-handcrafted-${crypto.randomUUID()}`],
    );
  const codeOf = async (id: string) =>
    ((await db.query(`SELECT channel_code FROM properties WHERE id = $1`, [id])).rows[0] as { channel_code: string }).channel_code;

  test("a new row whose short code is taken gets the longer one", async () => {
    await insertProperty(handcrafted(1));
    await insertProperty(handcrafted(2));
    const first = await codeOf(handcrafted(1));
    const second = await codeOf(handcrafted(2));
    expect(first).toBe("OB0B1C0DE020");
    expect(second).toMatch(/^OB[0-9A-F]{18}$/);
    expect(second).not.toBe(first);

    // Rooms and rate plans the same way: R/P + 11, else + 19.
    const room = async (id: string) =>
      (
        await db.query(
          `INSERT INTO rooms (id, property_id, name, base_occupancy, max_adults, total_units, is_active)
           VALUES ($1, $2, 'Double', 2, 2, 1, true) RETURNING channel_code`,
          [id, handcrafted(1)],
        )
      ).rows[0] as { channel_code: string };
    const r1 = await room("0b1c0de0-2031-1111-0000-000000000001");
    const r2 = await room("0b1c0de0-2031-1111-0000-000000000002");
    expect(r1.channel_code).toMatch(/^R[0-9A-F]{11}$/);
    expect(r2.channel_code).toMatch(/^R[0-9A-F]{19}$/);
  });

  test("the backfill gives rows sharing a short code the longer one", async () => {
    await db.query(`ALTER TABLE properties DISABLE TRIGGER channel_code_default`);
    await db.query(`ALTER TABLE properties ALTER COLUMN channel_code DROP NOT NULL`);
    await insertProperty(handcrafted(3));
    await insertProperty(handcrafted(4));
    await db.query(`ALTER TABLE properties ENABLE TRIGGER channel_code_default`);
    await db.query(pendingMigrationSql("0060_apps_api.sql"));
    const codes = [await codeOf(handcrafted(3)), await codeOf(handcrafted(4))];
    for (const c of codes) expect(c).toMatch(/^OB[0-9A-F]{18}$/);
    expect(codes[0]).not.toBe(codes[1]);
  });
});

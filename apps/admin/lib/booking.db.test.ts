import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { loadAdminBooking } from "./booking";

describeWithDb("loadAdminBooking against Postgres", () => {
  let db: Client;
  let ids: Awaited<ReturnType<typeof seedProperty>>;

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
    ids = await seedProperty(db, { tier: "flex" });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("returns null for a non-uuid and for an unknown uuid", async () => {
    expect(await loadAdminBooking(db, "abc")).toBeNull();
    expect(await loadAdminBooking(db, "7f1f6f0e-0000-4000-8000-000000000000")).toBeNull();
  });

  test("loads a seeded booking", async () => {
    const s = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, rooms: 2 });
    const r = await loadAdminBooking(db, s.bookingId);
    expect(r).not.toBeNull();
    expect(r!.rooms.length).toBe(2);
    expect(r!.guest?.email?.endsWith("@example.test")).toBe(true);
    expect(r!.property.name).toBe("Test Property");
    expect(r!.refunds).toEqual([]);
    expect(r!.messages).toEqual([]);
    expect(r!.tickets).toEqual([]);
    expect(r!.events).toEqual([]);
    expect(typeof r!.rooms[0].room_name).toBe("string");
  });

  test("loads linked tickets only", async () => {
    const s = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, rooms: 1 });
    const org = `test-org-${Date.now()}`;
    await db.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, NOW())`, [org]);
    const insert = (conv: number, linkedId: string, title: string) =>
      db.query(
        `INSERT INTO support_tickets (organization_id, chatwoot_conversation_id, category, linked_type, linked_id, title, status)
         VALUES ($1, $2, 'other', 'booking', $3, $4, 'open')`,
        [org, conv, linkedId, title],
      );
    await insert(900000001, s.bookingId, "mine");
    await insert(900000002, "someone-else", "other");
    const r = await loadAdminBooking(db, s.bookingId);
    expect(r!.tickets.map((x) => x.title)).toEqual(["mine"]);
  });
});

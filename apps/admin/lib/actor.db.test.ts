import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedGuest,
  seedProperty,
} from "@openbookings/db/testing";
import { actorFor } from "./actor";

describeWithDb("actorFor against Postgres", () => {
  let db: Client;
  let ids: Awaited<ReturnType<typeof seedProperty>>;
  let guestId: string;
  let bookingId: string;

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
    guestId = await seedGuest(db);
    bookingId = (await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, rooms: 1, userId: guestId })).bookingId;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("guest is the booking's user", async () => {
    expect(await actorFor(db, bookingId, "guest")).toEqual({ kind: "guest", userId: guestId, via: "admin" });
  });

  test("host is the property owner", async () => {
    const owner = await seedGuest(db);
    await db.query(`UPDATE properties SET owner_user_id = $1 WHERE id = $2`, [owner, ids.propertyId]);
    expect(await actorFor(db, bookingId, "host")).toEqual({ kind: "host", userId: owner, via: "admin" });
  });

  test("no owner gives null for host", async () => {
    expect(await actorFor(db, bookingId, "host")).toBeNull();
  });

  test("bad id gives null", async () => {
    expect(await actorFor(db, "abc", "guest")).toBeNull();
    expect(await actorFor(db, "7f1f6f0e-0000-4000-8000-000000000000", "guest")).toBeNull();
  });
});

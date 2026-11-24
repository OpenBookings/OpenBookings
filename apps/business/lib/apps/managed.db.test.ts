/** A property is managed exactly while it has an active app installation. Fixtures sit in 2031+. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyAriBatch, connectApp, disconnectApp } from "@openbookings/db/apps";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { loadManagedRooms, MANAGED_BY_APP, managedBy } from "./managed";

describeWithDb("managedBy", () => {
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

  const now = new Date("2031-03-01T12:00:00Z");

  test("the error code is the one the UI reads", () => {
    expect(MANAGED_BY_APP).toBe("managed-by-app");
  });

  test("null before connecting, SiteMinder while connected, null again after disconnecting", async () => {
    const { propertyId } = await seedProperty(db);
    expect(await managedBy(propertyId, db)).toBeNull();

    const { installation } = await connectApp(db, { propertyId, appKey: "siteminder", userId: "u", sendUpcoming: true, now });
    expect(await managedBy(propertyId, db)).toEqual({ appKey: "siteminder", displayName: "SiteMinder" });

    await disconnectApp(db, { installationId: installation.id, now });
    expect(await managedBy(propertyId, db)).toBeNull();
  });

  test("another property's connection does not manage this one", async () => {
    const a = await seedProperty(db);
    const b = await seedProperty(db);
    await connectApp(db, { propertyId: a.propertyId, appKey: "siteminder", userId: "u", sendUpcoming: true, now });
    expect(await managedBy(b.propertyId, db)).toBeNull();
  });

  test("loadManagedRooms: null unmanaged; while managed, the rooms SiteMinder sent no availability for from today on", async () => {
    const ids = await seedProperty(db);
    expect(await loadManagedRooms(ids.propertyId, db, now)).toBeNull();

    const { installation } = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId: "u", sendUpcoming: true, now });
    const addRoom = async (name: string, active: boolean) =>
      (
        await db.query(
          `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active) VALUES ($1, $2, 2, 2, 1, $3) RETURNING id, channel_code`,
          [ids.propertyId, name, active],
        )
      ).rows[0] as { id: string; channel_code: string };
    const draft = await addRoom("Draft", false);
    const past = await addRoom("Past only", true);
    const archived = await addRoom("Archived", false);
    await db.query(`UPDATE rooms SET archived_at = now() WHERE id = $1`, [archived.id]);
    const linkedCode = (await db.query(`SELECT channel_code FROM rooms WHERE id = $1`, [ids.roomId])).rows[0].channel_code as string;

    // Nothing sent yet: every room that is not archived is unlinked.
    expect([...(await loadManagedRooms(ids.propertyId, db, now))!.unlinkedRoomIds].sort()).toEqual(
      [ids.roomId, draft.id, past.id].sort(),
    );

    await applyAriBatch(
      db,
      installation,
      {
        inventory: [
          { roomCode: linkedCode, from: "2031-03-05", to: "2031-03-06", unitsLeft: 2 },
          { roomCode: past.channel_code, from: "2031-02-01", to: "2031-02-02", unitsLeft: 2 },
        ],
        rates: [],
        restrictions: [],
      },
      now,
    );
    expect([...(await loadManagedRooms(ids.propertyId, db, now))!.unlinkedRoomIds].sort()).toEqual([draft.id, past.id].sort());
  });
});

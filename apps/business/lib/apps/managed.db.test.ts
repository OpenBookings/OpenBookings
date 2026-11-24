/** A property is managed exactly while it has an active app installation. Fixtures sit in 2031+. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { connectApp, disconnectApp } from "@openbookings/db/apps";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { MANAGED_BY_APP, managedBy } from "./managed";

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
});

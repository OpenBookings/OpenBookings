/**
 * The booking gate over a real database: a property that is not ready cannot
 * be booked, unless the gate is switched off. Rolled back; skipped locally
 * without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { propertyBookable } from "./readiness-gate";

describeWithDb("booking readiness gate against Postgres", () => {
  let db: Client;
  let propertyId: string;

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
    ({ propertyId } = await seedProperty(db));
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("checkout refuses a property that is not ready", async () => {
    expect(await propertyBookable(db, propertyId, {})).toBe(false);
  });

  test("with PROPERTY_READINESS_ENFORCE=off checkout is not gated", async () => {
    expect(await propertyBookable(db, propertyId, { PROPERTY_READINESS_ENFORCE: "off" })).toBe(true);
  });
});

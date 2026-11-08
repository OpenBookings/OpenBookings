/**
 * The publish gate over a real database. Rolled back; skipped locally without
 * DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { publishBlocker } from "./publish-readiness";

const charges = async () => true;

describeWithDb("publish readiness against Postgres", () => {
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

  test("publishing a property that is not ready is refused with the missing items", async () => {
    const error = await publishBlocker(db, propertyId, charges, {});
    expect(error).toStartWith("Before going live: ");
    expect(error).toContain("connect Stripe");
    expect(error).toContain("complete your billing details");
  });

  test("with PROPERTY_READINESS_ENFORCE=off publish is not gated", async () => {
    expect(await publishBlocker(db, propertyId, charges, { PROPERTY_READINESS_ENFORCE: "off" })).toBeNull();
  });
});

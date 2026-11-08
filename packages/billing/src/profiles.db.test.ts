import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { getBillingProfile, recordViesResult, upsertBillingProfile } from "./profiles";

describeWithDb("billing profiles against Postgres", () => {
  let db: Client;
  let orgId: string;

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
    orgId = `org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("there is no profile until one is saved", async () => {
    expect(await getBillingProfile(db, orgId)).toBeNull();
  });

  test("saves a profile, normalising the country and VAT id", async () => {
    const p = await upsertBillingProfile(db, orgId, { legalName: "Hotel BV", countryCode: "be", vatId: "BE 0123.456.789" });
    expect(p.countryCode).toBe("BE");
    expect(p.vatId).toBe("BE0123456789");
    expect(p.legalName).toBe("Hotel BV");
    expect(p.city).toBeNull();
  });

  test("only the provided fields change", async () => {
    await upsertBillingProfile(db, orgId, { legalName: "Hotel BV", city: "Gent" });
    const p = await upsertBillingProfile(db, orgId, { city: "Brugge" });
    expect(p.legalName).toBe("Hotel BV");
    expect(p.city).toBe("Brugge");
  });

  test("changing the VAT id clears the VIES result", async () => {
    await upsertBillingProfile(db, orgId, { countryCode: "BE", vatId: "BE0123456789" });
    await recordViesResult(db, orgId, { valid: true, requestId: "WAPI1", checkedAt: new Date("2031-01-01T10:00:00Z") });
    const checked = await getBillingProfile(db, orgId);
    expect(checked?.vatIdValid).toBe(true);
    expect(checked?.viesRequestId).toBe("WAPI1");
    expect(checked?.vatIdCheckedAt?.toISOString()).toBe("2031-01-01T10:00:00.000Z");

    const changed = await upsertBillingProfile(db, orgId, { vatId: "BE0999999999" });
    expect(changed.vatIdValid).toBeNull();
    expect(changed.viesRequestId).toBeNull();
    expect(changed.vatIdCheckedAt).toBeNull();
  });

  test("changing the country clears the VIES result", async () => {
    await upsertBillingProfile(db, orgId, { countryCode: "BE", vatId: "BE0123456789" });
    await recordViesResult(db, orgId, { valid: true, requestId: "WAPI1", checkedAt: new Date() });
    const p = await upsertBillingProfile(db, orgId, { countryCode: "FR" });
    expect(p.vatIdValid).toBeNull();
  });

  test("saving the same VAT id and country again keeps the VIES result", async () => {
    await upsertBillingProfile(db, orgId, { countryCode: "BE", vatId: "BE0123456789" });
    await recordViesResult(db, orgId, { valid: true, requestId: "WAPI1", checkedAt: new Date() });
    const p = await upsertBillingProfile(db, orgId, { countryCode: "be", vatId: "BE 0123456789", city: "Gent" });
    expect(p.vatIdValid).toBe(true);
    expect(p.viesRequestId).toBe("WAPI1");
  });
});

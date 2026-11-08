import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { RATES_TAX_INCLUSIVE_DOC_ID } from "@openbookings/authz/rates-doc";
import { ensureDemoHotels } from "@openbookings/demo";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "@openbookings/db/testing";
import { recordViesResult, upsertBillingProfile } from "./profiles";
import { propertyReadiness, readinessEnforced, readinessCopy } from "./readiness";

describe("readinessEnforced", () => {
  test("is on unless switched off", () => {
    expect(readinessEnforced({})).toBe(true);
    expect(readinessEnforced({ PROPERTY_READINESS_ENFORCE: "on" })).toBe(true);
    expect(readinessEnforced({ PROPERTY_READINESS_ENFORCE: "off" })).toBe(false);
  });
});

describe("readinessCopy", () => {
  test("has plain words for every item", () => {
    expect(readinessCopy("stripe_account")).toBe("Connect Stripe");
    expect(readinessCopy("vat_id_verified")).toBe("Get your VAT number verified");
  });
});

describeWithDb("property readiness against Postgres", () => {
  let db: Client;
  let propertyId: string;
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
    ({ propertyId } = await seedProperty(db));
    orgId = `org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $2 WHERE id = $1`, [propertyId, orgId]);
    await db.query(`INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id) VALUES ($1, 'Hotel BV', $2)`, [
      orgId,
      `acct_${crypto.randomUUID().slice(0, 8)}`,
    ]);
    await db.query(
      `INSERT INTO org_consent (organization_id, doc_id, signed_by_user_id, signer_full_name, signed_at)
       VALUES ($1, $2, 'u', 'Owner', NOW())`,
      [orgId, RATES_TAX_INCLUSIVE_DOC_ID],
    );
    await db.query(`INSERT INTO property_content (property_id, legal_company_name, vat_number) VALUES ($1, 'Hotel BV', 'NL123456789B01')`, [
      propertyId,
    ]);
    await upsertBillingProfile(db, orgId, {
      legalName: "Hotel BV",
      addressLine1: "1 Street",
      postalCode: "1011AA",
      city: "Amsterdam",
      countryCode: "NL",
      vatId: "NL123456789B01",
      billingEmail: "billing@hotel.test",
    });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("a property with everything in place is ready", async () => {
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: true, missing: [] });
  });

  test("an NL host needs no VIES result", async () => {
    const r = await propertyReadiness(db, propertyId);
    expect(r.missing).not.toContain("vat_id_verified");
  });

  test("a missing Stripe account alone makes it not ready", async () => {
    await db.query(`UPDATE org_profile SET stripe_account_id = NULL WHERE organization_id = $1`, [orgId]);
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: false, missing: ["stripe_account"] });
  });

  test("an account that cannot charge alone makes it not ready, only when asked", async () => {
    expect((await propertyReadiness(db, propertyId)).ready).toBe(true);
    expect(await propertyReadiness(db, propertyId, { chargesEnabled: async () => false })).toEqual({
      ready: false,
      missing: ["stripe_charges"],
    });
    expect((await propertyReadiness(db, propertyId, { chargesEnabled: async () => true })).ready).toBe(true);
  });

  test("a Stripe error while checking charges counts as not ready instead of throwing", async () => {
    const r = await propertyReadiness(db, propertyId, {
      chargesEnabled: async () => {
        throw new Error("stripe down");
      },
    });
    expect(r).toEqual({ ready: false, missing: ["stripe_charges"] });
  });

  test("unconfirmed rates alone make it not ready", async () => {
    await db.query(`DELETE FROM org_consent WHERE organization_id = $1`, [orgId]);
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: false, missing: ["rates_confirmed"] });
  });

  test("a blank legal company name alone makes it not ready", async () => {
    await db.query(`UPDATE property_content SET legal_company_name = '  ' WHERE property_id = $1`, [propertyId]);
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: false, missing: ["legal_details"] });
  });

  test("a missing VAT number alone makes it not ready", async () => {
    await db.query(`UPDATE property_content SET vat_number = NULL WHERE property_id = $1`, [propertyId]);
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: false, missing: ["legal_details"] });
  });

  test("no content row means legal details are missing", async () => {
    await db.query(`DELETE FROM property_content WHERE property_id = $1`, [propertyId]);
    expect((await propertyReadiness(db, propertyId)).missing).toEqual(["legal_details"]);
  });

  test("an incomplete billing profile alone makes it not ready", async () => {
    await upsertBillingProfile(db, orgId, { city: "" });
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: false, missing: ["billing_profile"] });
  });

  test("no billing profile at all makes it not ready", async () => {
    await db.query(`DELETE FROM billing_profiles WHERE organization_id = $1`, [orgId]);
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: false, missing: ["billing_profile"] });
  });

  test("an EU reverse-charge host needs a valid VIES result", async () => {
    await upsertBillingProfile(db, orgId, { countryCode: "BE", vatId: "BE0123456789" });
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: false, missing: ["vat_id_verified"] });

    await recordViesResult(db, orgId, { valid: false, requestId: "W1", checkedAt: new Date() });
    expect((await propertyReadiness(db, propertyId)).missing).toEqual(["vat_id_verified"]);

    await recordViesResult(db, orgId, { valid: true, requestId: "W2", checkedAt: new Date() });
    expect(await propertyReadiness(db, propertyId)).toEqual({ ready: true, missing: [] });
  });

  test("a non-EU billing country is a billing profile problem", async () => {
    await upsertBillingProfile(db, orgId, { countryCode: "US" });
    expect((await propertyReadiness(db, propertyId)).missing).toEqual(["billing_profile"]);
  });

  test("a legacy property without an organization is not ready", async () => {
    await db.query(`UPDATE properties SET organization_id = NULL WHERE id = $1`, [propertyId]);
    const r = await propertyReadiness(db, propertyId);
    expect(r.ready).toBe(false);
    expect(r.missing).toContain("billing_profile");
    expect(r.missing).toContain("rates_confirmed");
  });

  test("an unknown property is not ready", async () => {
    const r = await propertyReadiness(db, crypto.randomUUID());
    expect(r.ready).toBe(false);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  test("items come back in a fixed order", async () => {
    await db.query(`DELETE FROM org_consent WHERE organization_id = $1`, [orgId]);
    await db.query(`UPDATE org_profile SET stripe_account_id = NULL WHERE organization_id = $1`, [orgId]);
    await db.query(`DELETE FROM billing_profiles WHERE organization_id = $1`, [orgId]);
    expect((await propertyReadiness(db, propertyId)).missing).toEqual(["stripe_account", "rates_confirmed", "billing_profile"]);
  });

  test("generated demo hotels are ready, with no bypass", async () => {
    const { propertyIds } = await ensureDemoHotels(db, { lat: 50 + Math.random(), lon: 20 + Math.random() });
    expect(propertyIds.length).toBeGreaterThan(0);
    for (const id of propertyIds) expect(await propertyReadiness(db, id)).toEqual({ ready: true, missing: [] });
  });
});

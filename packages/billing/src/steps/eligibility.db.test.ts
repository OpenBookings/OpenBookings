import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { periodFor } from "../period";
import { getBillingProfile, recordViesResult, upsertBillingProfile } from "../profiles";
import { ViesUnavailableError, type ViesDeps, type ViesResult } from "../vies";
import { entry, seedHost, type StripeSide } from "./draft.fixtures";
import { checkEligibility, type EligibilityDeps } from "./eligibility";

const PERIOD = periodFor("2026-10");
const NOW = new Date("2026-11-01T06:00:00Z");
const VIES_DEPS: ViesDeps = { requester: { countryCode: "NL", vatNumber: "NL000000000B01" } };

describeWithDb("checking which hosts can be invoiced", () => {
  let db: Client;
  let stripe: StripeSide;
  let viesCalls: { vatId: string; deps: ViesDeps }[];
  let viesAnswer: () => Promise<ViesResult>;

  const deps = (over: Partial<EligibilityDeps> = {}): EligibilityDeps => ({
    db,
    vies: async (vatId, viesDeps) => {
      viesCalls.push({ vatId, deps: viesDeps });
      return viesAnswer();
    },
    viesDeps: VIES_DEPS,
    now: () => NOW,
    ...over,
  });

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
    stripe = { listed: [] };
    viesCalls = [];
    viesAnswer = async () => ({ valid: true, requestId: "vies-new", checkedAt: NOW });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("an NL host with a complete profile is eligible without a VIES check", async () => {
    const host = await seedHost(db, "NL");
    await entry(db, stripe, host, { gross: 1080n });

    expect(await checkEligibility([host.orgId], PERIOD, deps())).toEqual({ eligible: [host.orgId], blocked: [] });
    expect(viesCalls).toEqual([]);
  });

  test("missing billing email blocks with missing_fields", async () => {
    const host = await seedHost(db, "NL");
    await upsertBillingProfile(db, host.orgId, { billingEmail: "" });
    await entry(db, stripe, host, { gross: 1080n });

    expect(await checkEligibility([host.orgId], PERIOD, deps())).toEqual({
      eligible: [],
      blocked: [{ entityId: host.orgId, reasons: ["missing_fields"], missing: ["billingEmail"] }],
    });
  });

  test("a host without a billing profile blocks with every field missing", async () => {
    const host = await seedHost(db, "NL");
    await entry(db, stripe, host, { gross: 1080n });
    await db.query(`DELETE FROM billing_profiles WHERE organization_id = $1`, [host.orgId]);

    const { blocked } = await checkEligibility([host.orgId], PERIOD, deps());
    expect(blocked).toEqual([
      {
        entityId: host.orgId,
        reasons: ["missing_fields"],
        missing: ["legalName", "addressLine1", "postalCode", "city", "countryCode", "vatId", "billingEmail"],
      },
    ]);
  });

  test("a non-EU country blocks with non_eu", async () => {
    const host = await seedHost(db, "US");
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });

    expect((await checkEligibility([host.orgId], PERIOD, deps())).blocked).toEqual([{ entityId: host.orgId, reasons: ["non_eu"] }]);
    expect(viesCalls).toEqual([]);
  });

  test("mixed treatments in the month block the entity", async () => {
    const host = await seedHost(db, "NL");
    await entry(db, stripe, host, { gross: 1080n, treatment: "NL_DOMESTIC" });
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE", occurredAt: "2026-10-28T09:00:00Z" });

    expect(await checkEligibility([host.orgId], PERIOD, deps())).toEqual({
      eligible: [],
      blocked: [{ entityId: host.orgId, reasons: ["mixed_vat_treatment"] }],
    });
  });

  test("entries taxed differently from the profile's treatment block the entity", async () => {
    const host = await seedHost(db, "BE");
    await entry(db, stripe, host, { gross: 1080n, treatment: "NL_DOMESTIC" });

    expect((await checkEligibility([host.orgId], PERIOD, deps())).blocked).toEqual([
      { entityId: host.orgId, reasons: ["mixed_vat_treatment"] },
    ]);
  });

  test("returned entries and other months do not make a month mixed", async () => {
    const host = await seedHost(db, "NL");
    await entry(db, stripe, host, { gross: 1080n });
    const returned = await entry(db, stripe, host, { gross: 2000n, treatment: "EU_REVERSE_CHARGE", disposition: "returned" });
    await entry(db, stripe, host, { gross: -2000n, treatment: "EU_REVERSE_CHARGE", disposition: "returned", refundsEntryId: returned.id });
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE", occurredAt: "2026-09-10T12:00:00Z" });

    expect((await checkEligibility([host.orgId], PERIOD, deps())).eligible).toEqual([host.orgId]);
  });

  test("invalid VIES blocks", async () => {
    const host = await seedHost(db, "BE", new Date("2026-09-01T10:00:00Z"));
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });
    viesAnswer = async () => ({ valid: false, requestId: "vies-no", checkedAt: NOW });

    expect(await checkEligibility([host.orgId], PERIOD, deps())).toEqual({
      eligible: [],
      blocked: [{ entityId: host.orgId, reasons: ["vies_invalid"] }],
    });
    expect(viesCalls).toEqual([{ vatId: "BE0123456789", deps: VIES_DEPS }]);
    const profile = await getBillingProfile(db, host.orgId);
    expect([profile?.vatIdValid, profile?.viesRequestId, profile?.vatIdCheckedAt?.toISOString()]).toEqual([false, "vies-no", NOW.toISOString()]);
  });

  test("a recent VIES check that found the VAT id invalid blocks without asking again", async () => {
    const host = await seedHost(db, "BE");
    await recordViesResult(db, host.orgId, { valid: false, requestId: "vies-no", checkedAt: new Date("2026-10-25T10:00:00Z") });
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });

    expect((await checkEligibility([host.orgId], PERIOD, deps())).blocked).toEqual([{ entityId: host.orgId, reasons: ["vies_invalid"] }]);
    expect(viesCalls).toEqual([]);
  });

  test("VIES down blocks with vies_unavailable", async () => {
    const host = await seedHost(db, "BE", null);
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });
    viesAnswer = async () => {
      throw new ViesUnavailableError();
    };

    expect(await checkEligibility([host.orgId], PERIOD, deps())).toEqual({
      eligible: [],
      blocked: [{ entityId: host.orgId, reasons: ["vies_unavailable"] }],
    });
    expect((await getBillingProfile(db, host.orgId))?.vatIdCheckedAt).toBeNull();
  });

  test("a VIES check younger than 30 days is not repeated", async () => {
    const host = await seedHost(db, "BE", new Date(NOW.getTime() - 29 * 86_400_000));
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });

    expect(await checkEligibility([host.orgId], PERIOD, deps())).toEqual({ eligible: [host.orgId], blocked: [] });
    expect(viesCalls).toEqual([]);
  });

  test("a VIES check older than 30 days is repeated and stored", async () => {
    const host = await seedHost(db, "BE", new Date(NOW.getTime() - 31 * 86_400_000));
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });

    expect((await checkEligibility([host.orgId], PERIOD, deps())).eligible).toEqual([host.orgId]);
    expect(viesCalls).toHaveLength(1);
    const profile = await getBillingProfile(db, host.orgId);
    expect([profile?.vatIdValid, profile?.viesRequestId]).toEqual([true, "vies-new"]);
  });

  test("a dry run asks VIES but stores nothing", async () => {
    const host = await seedHost(db, "BE", null);
    await entry(db, stripe, host, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });

    expect((await checkEligibility([host.orgId], PERIOD, deps({ dryRun: true }))).eligible).toEqual([host.orgId]);
    expect(viesCalls).toHaveLength(1);
    expect((await getBillingProfile(db, host.orgId))?.vatIdCheckedAt).toBeNull();
  });

  test("every reason is listed, and each host is judged on its own", async () => {
    const ok = await seedHost(db, "NL");
    const bad = await seedHost(db, "BE", null);
    await upsertBillingProfile(db, bad.orgId, { city: " " });
    await entry(db, stripe, ok, { gross: 1080n });
    await entry(db, stripe, bad, { gross: 1080n, treatment: "EU_REVERSE_CHARGE" });
    await entry(db, stripe, bad, { gross: 1080n, treatment: "NL_DOMESTIC" });
    viesAnswer = async () => ({ valid: false, requestId: null, checkedAt: NOW });

    expect(await checkEligibility([ok.orgId, bad.orgId], PERIOD, deps())).toEqual({
      eligible: [ok.orgId],
      blocked: [{ entityId: bad.orgId, reasons: ["missing_fields", "mixed_vat_treatment", "vies_invalid"], missing: ["city"] }],
    });
  });
});

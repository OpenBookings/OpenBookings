import { describe, expect, test } from "bun:test";
import { ViesUnavailableError } from "@openbookings/billing/vies";
import type { BillingProfile } from "@openbookings/billing/profiles";
import { billingDetailsSchema, runVatCheck, viesRequester } from "./details";

const valid = {
  legalName: "Hotel BV",
  addressLine1: "1 Canal Street",
  addressLine2: "",
  postalCode: "1011 AA",
  city: "Amsterdam",
  countryCode: "nl",
  vatId: "nl 1234.56.789 b01",
  kvkNumber: "",
  billingEmail: "billing@hotel.test",
};

describe("billing details schema", () => {
  test("accepts a complete form and tidies it", () => {
    const r = billingDetailsSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ countryCode: "NL", vatId: "NL123456789B01", addressLine2: null, kvkNumber: null });
  });

  test("text fields must be a single line", () => {
    for (const patch of [{ legalName: "Evil\nHost" }, { city: "A\r\nB" }, { addressLine2: "x\u2028y" }]) {
      const r = billingDetailsSchema.safeParse({ ...valid, ...patch });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("single line");
    }
    expect(billingDetailsSchema.safeParse({ ...valid, legalName: "H".repeat(200) }).success).toBe(true);
  });

  test("country must be an EU member state", () => {
    expect(billingDetailsSchema.safeParse({ ...valid, countryCode: "US", vatId: "US123456789" }).success).toBe(false);
    expect(billingDetailsSchema.safeParse({ ...valid, countryCode: "GB", vatId: "GB123456789" }).success).toBe(false);
    expect(billingDetailsSchema.safeParse({ ...valid, countryCode: "BE", vatId: "BE0123456789" }).success).toBe(true);
  });

  test("VAT number and billing email are required", () => {
    expect(billingDetailsSchema.safeParse({ ...valid, vatId: "" }).success).toBe(false);
    expect(billingDetailsSchema.safeParse({ ...valid, billingEmail: "" }).success).toBe(false);
    expect(billingDetailsSchema.safeParse({ ...valid, billingEmail: "nope" }).success).toBe(false);
  });

  test("the VAT prefix must match the country, Greece being EL", () => {
    expect(billingDetailsSchema.safeParse({ ...valid, vatId: "BE0123456789" }).success).toBe(false);
    expect(billingDetailsSchema.safeParse({ ...valid, countryCode: "GR", vatId: "EL123456789" }).success).toBe(true);
  });
});

const profile = (countryCode: string): BillingProfile =>
  ({ organizationId: "org", countryCode, vatId: `${countryCode}0123456789` }) as BillingProfile;
const requester = { countryCode: "NL", vatNumber: "123456789B01" } as const;
const fakeDb = (sink: unknown[][] = []) => ({ query: async (_t: string, v?: unknown[]) => (sink.push(v ?? []), { rows: [] }) });

describe("VAT number check", () => {
  test("Dutch hosts are not checked", async () => {
    const check = async () => {
      throw new Error("must not be called");
    };
    expect(await runVatCheck(fakeDb(), profile("NL"), { check, requester })).toBe("not_needed");
  });

  test("without a requester VAT number no check is made", async () => {
    expect(await runVatCheck(fakeDb(), profile("BE"), { requester: null })).toBe("not_configured");
  });

  test("VIES down leaves the number unverified and stores nothing", async () => {
    const sink: unknown[][] = [];
    const check = async () => {
      throw new ViesUnavailableError();
    };
    expect(await runVatCheck(fakeDb(sink), profile("BE"), { check, requester })).toBe("unavailable");
    expect(sink).toEqual([]);
  });

  test("an answer is stored", async () => {
    const sink: unknown[][] = [];
    const checkedAt = new Date();
    const ok = async () => ({ valid: true, requestId: "r1", checkedAt });
    expect(await runVatCheck(fakeDb(sink), profile("BE"), { check: ok, requester })).toBe("verified");
    expect(sink).toEqual([["org", true, "r1", checkedAt]]);
    const no = async () => ({ valid: false, requestId: null, checkedAt });
    expect(await runVatCheck(fakeDb(), profile("BE"), { check: no, requester })).toBe("invalid");
  });

  test("the requester is read from VIES_REQUESTER_VAT", () => {
    expect(viesRequester({ VIES_REQUESTER_VAT: "NL 1234.56.789 B01" })).toEqual({ countryCode: "NL", vatNumber: "123456789B01" });
    expect(viesRequester({})).toBeNull();
    expect(viesRequester({ VIES_REQUESTER_VAT: "BE0123456789" })).toBeNull();
  });
});

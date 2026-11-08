import { describe, expect, test } from "bun:test";
import { mergeProfileSources } from "./profile-backfill";

const orgProfile = { legalEntityName: "Hotel BV", kvkNumber: "12345678", vatNumber: "NL123456789B01" };
const stripeAccount = {
  country: "NL",
  email: "owner@hotel.test",
  business_profile: { support_email: "support@hotel.test" },
  company: { address: { line1: "Dam 1", line2: null, postal_code: "1012 JS", city: "Amsterdam", country: "NL" } },
};

describe("mergeProfileSources", () => {
  test("pre-fills empty fields only", () => {
    const patch = mergeProfileSources(
      { legalName: "Kept Name BV", city: "Rotterdam", vatId: null },
      orgProfile,
      stripeAccount,
    );
    expect(patch.legalName).toBeUndefined();
    expect(patch.city).toBeUndefined();
    expect(patch).toMatchObject({
      vatId: "NL123456789B01",
      kvkNumber: "12345678",
      addressLine1: "Dam 1",
      postalCode: "1012 JS",
      countryCode: "NL",
      billingEmail: "support@hotel.test",
    });
    expect(patch.addressLine2).toBeUndefined();
  });

  test("works from nothing and treats blank strings as empty", () => {
    const patch = mergeProfileSources({ legalName: "  " }, orgProfile, null);
    expect(patch).toEqual({ legalName: "Hotel BV", kvkNumber: "12345678", vatId: "NL123456789B01" });
  });

  test("falls back to the account email and its country", () => {
    const patch = mergeProfileSources(null, null, { country: "de", email: "a@b.test" });
    expect(patch).toEqual({ countryCode: "DE", billingEmail: "a@b.test" });
  });

  test("prefixes a bare VAT number with the country", () => {
    const patch = mergeProfileSources({ countryCode: "BE" }, { legalEntityName: "X", kvkNumber: null, vatNumber: "0123.456.789" }, null);
    expect(patch.vatId).toBe("BE0123456789");
    const gr = mergeProfileSources({ countryCode: "GR" }, { legalEntityName: "X", kvkNumber: null, vatNumber: "123456789" }, null);
    expect(gr.vatId).toBe("EL123456789");
  });

  test("skips a bare VAT number when no country is known", () => {
    const patch = mergeProfileSources(null, { legalEntityName: "X", kvkNumber: null, vatNumber: "123456789" }, null);
    expect(patch.vatId).toBeUndefined();
  });
});

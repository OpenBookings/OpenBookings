import { describe, expect, test } from "bun:test";
import { SELLER_VARIABLES, SellerConfigError, sellerFromEnv } from "./seller";

const FULL = {
  SELLER_LEGAL_NAME: "OpenBookings B.V.",
  SELLER_ADDRESS: "Keizersgracht 1\n1015 CC Amsterdam",
  SELLER_KVK: "12345678",
  SELLER_VAT_ID: "NL123456789B01",
  SELLER_BILLING_EMAIL: "billing@openbookings.test",
};

describe("sellerFromEnv", () => {
  test("live mode lists every missing seller variable", () => {
    let caught: unknown;
    try {
      sellerFromEnv({ SELLER_KVK: "12345678", SELLER_ADDRESS: "  " }, "live");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SellerConfigError);
    const error = caught as SellerConfigError;
    expect(error.missing).toEqual(["SELLER_LEGAL_NAME", "SELLER_ADDRESS", "SELLER_VAT_ID", "SELLER_BILLING_EMAIL"]);
    for (const name of error.missing) expect(error.message).toContain(name);
    expect(() => sellerFromEnv({}, "live")).toThrow(SELLER_VARIABLES.join(", "));
  });

  test("live mode builds the seller from the environment, one address line per newline", () => {
    expect(sellerFromEnv(FULL, "live")).toEqual({
      legalName: "OpenBookings B.V.",
      addressLines: ["Keizersgracht 1", "1015 CC Amsterdam"],
      countryName: "Netherlands",
      vatId: "NL123456789B01",
      kvk: "12345678",
      email: "billing@openbookings.test",
    });
    // An escaped newline, as some secret stores keep it, splits the same way.
    expect(sellerFromEnv({ ...FULL, SELLER_ADDRESS: "Keizersgracht 1\\n1015 CC Amsterdam" }, "live").addressLines).toEqual([
      "Keizersgracht 1",
      "1015 CC Amsterdam",
    ]);
  });

  test("test mode fills what is missing with placeholders", () => {
    expect(sellerFromEnv({ SELLER_KVK: "12345678" }, "test")).toEqual({
      legalName: "[SELLER_LEGAL_NAME]",
      addressLines: ["[SELLER_ADDRESS]"],
      countryName: "Netherlands",
      vatId: "[SELLER_VAT_ID]",
      kvk: "12345678",
      email: "[SELLER_BILLING_EMAIL]",
    });
  });
});

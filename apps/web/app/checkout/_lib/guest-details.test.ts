import { describe, expect, test } from "bun:test";
import { splitPhone } from "@/app/account/personal-details/_lib/phone";
import { isCompleteForCheckout, prefillToFormData, toStripeContact, type GuestDetailsPrefill } from "./guest-details";

const complete: GuestDetailsPrefill = {
  name: "Sanne de Vries",
  email: "sanne.devries@example.com",
  phone: { country: "NL", number: "6 23456789" },
  address: { line1: "Oudegracht 112", line2: null, postalCode: "3511 AV", city: "Utrecht", country: "NL" },
};

describe("isCompleteForCheckout", () => {
  test("a fully saved account goes straight to the summary", () => {
    expect(isCompleteForCheckout(complete)).toBe(true);
  });

  test("anything required missing opens the form", () => {
    expect(isCompleteForCheckout({ ...complete, address: null })).toBe(false);
    expect(isCompleteForCheckout({ ...complete, phone: { country: "NL", number: "" } })).toBe(false);
    expect(isCompleteForCheckout({ ...complete, name: "" })).toBe(false);
  });

  test("a number saved before the picker that doesn't parse opens the form", () => {
    expect(isCompleteForCheckout({ ...complete, phone: { country: "NL", number: "06-123" } })).toBe(false);
  });

  test("a first booking with no saved details: form, Dutch dialling code by default", () => {
    const firstTime: GuestDetailsPrefill = {
      name: "Sanne de Vries",
      email: "sanne.devries@example.com",
      phone: splitPhone(null, "NL"),
      address: null,
    };
    expect(firstTime.phone.country).toBe("NL");
    expect(isCompleteForCheckout(firstTime)).toBe(false);
  });
});

describe("prefillToFormData", () => {
  test("uses the account form's field names, empty for what's missing", () => {
    const data = prefillToFormData({ ...complete, address: null });
    expect(data.get("name")).toBe("Sanne de Vries");
    expect(data.get("phone")).toBe("6 23456789");
    expect(data.get("phoneCountry")).toBe("NL");
    expect(data.get("line1")).toBe("");
    expect(data.get("country")).toBe("");
  });
});

describe("toStripeContact", () => {
  test("maps the saved details to Stripe's billing address and an E.164 phone", () => {
    expect(
      toStripeContact({
        name: "Sanne de Vries",
        phone: "+31 6 23456789",
        address: { line1: "Oudegracht 112", line2: null, postalCode: "3511 AV", city: "Utrecht", country: "NL" },
      }),
    ).toEqual({
      billingAddress: {
        name: "Sanne de Vries",
        address: { line1: "Oudegracht 112", line2: null, postal_code: "3511 AV", city: "Utrecht", country: "NL" },
      },
      phoneNumber: "+31623456789",
    });
  });
});

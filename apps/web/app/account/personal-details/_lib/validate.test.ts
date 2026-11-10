import { describe, expect, test } from "bun:test";
import {
  PHONE_ERROR,
  PHONE_REQUIRED,
  parseAddress,
  parseCheckoutDetails,
  parseDetails,
  parseName,
  parsePhone,
} from "./validate";

function form(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseName", () => {
  test("trims and accepts 1–100 characters", () => {
    expect(parseName(form({ name: "  Anna de Vries  " }))).toEqual({ ok: true, value: "Anna de Vries" });
  });
  test("rejects empty and over-long names", () => {
    expect(parseName(form({ name: "   " }))).toEqual({ ok: false, errors: { name: "Enter your name." } });
    expect(parseName(form({ name: "a".repeat(101) })).ok).toBe(false);
  });
});

describe("parsePhone", () => {
  test("empty means no phone number", () => {
    expect(parsePhone(form({ phone: "  ", phoneCountry: "NL" }))).toEqual({ ok: true, value: null });
  });
  test("joins the picked country and the number, dropping the national 0", () => {
    expect(parsePhone(form({ phone: "06 1234 5678", phoneCountry: "NL" }))).toEqual({ ok: true, value: "+31 6 12345678" });
    expect(parsePhone(form({ phone: "6 12345678", phoneCountry: "nl" }))).toEqual({ ok: true, value: "+31 6 12345678" });
  });
  test("a number typed with its own + code wins over the picked country", () => {
    expect(parsePhone(form({ phone: "+44 7911 123456", phoneCountry: "NL" }))).toEqual({ ok: true, value: "+44 7911 123456" });
  });
  test("rejects letters and numbers that don't fit the country", () => {
    expect(parsePhone(form({ phone: "call me", phoneCountry: "NL" }))).toEqual({ ok: false, errors: { phone: PHONE_ERROR } });
    expect(parsePhone(form({ phone: "12", phoneCountry: "NL" })).ok).toBe(false);
  });
});

describe("parseAddress", () => {
  const full = { line1: "Oudegracht 1", line2: "", postalCode: "3511 AA", city: "Utrecht", country: "NL" };

  test("all empty means no address", () => {
    expect(parseAddress(form({ line1: "", line2: "", postalCode: "", city: "", country: "" }))).toEqual({
      ok: true,
      value: null,
    });
  });
  test("a full address is kept, empty line 2 becomes null", () => {
    expect(parseAddress(form(full))).toEqual({
      ok: true,
      value: { line1: "Oudegracht 1", line2: null, postalCode: "3511 AA", city: "Utrecht", country: "NL" },
    });
  });
  test("any real country works, not only EU ones", () => {
    expect(parseAddress(form({ ...full, country: "US" })).ok).toBe(true);
  });
  test("a partial address names each missing field", () => {
    expect(parseAddress(form({ ...full, city: "", postalCode: "" }))).toEqual({
      ok: false,
      errors: { city: "Enter a city.", postalCode: "Enter a postcode." },
    });
  });
  test("unknown country codes are refused", () => {
    expect(parseAddress(form({ ...full, country: "ZZ" }))).toEqual({
      ok: false,
      errors: { country: "Choose a country." },
    });
  });
});

describe("parseDetails", () => {
  const full = {
    name: "Anna de Vries",
    phone: "06 1234 5678",
    phoneCountry: "NL",
    line1: "Oudegracht 1",
    line2: "",
    postalCode: "3511 AA",
    city: "Utrecht",
    country: "NL",
  };

  test("a valid form gives name, phone and address together", () => {
    expect(parseDetails(form(full))).toEqual({
      ok: true,
      value: {
        name: "Anna de Vries",
        phone: "+31 6 12345678",
        address: { line1: "Oudegracht 1", line2: null, postalCode: "3511 AA", city: "Utrecht", country: "NL" },
      },
    });
  });
  test("only a name is required", () => {
    const empty = { ...full, phone: "", line1: "", postalCode: "", city: "", country: "" };
    expect(parseDetails(form(empty))).toEqual({
      ok: true,
      value: { name: "Anna de Vries", phone: null, address: null },
    });
  });
  test("errors from every part are reported at once", () => {
    expect(parseDetails(form({ ...full, name: "", phone: "call me", city: "" }))).toEqual({
      ok: false,
      errors: {
        name: "Enter your name.",
        phone: PHONE_ERROR,
        city: "Enter a city.",
      },
    });
  });
});

describe("parseCheckoutDetails", () => {
  const complete = {
    name: "Sanne de Vries",
    phone: "6 23456789",
    phoneCountry: "NL",
    line1: "Oudegracht 112",
    line2: "",
    postalCode: "3511 AV",
    city: "Utrecht",
    country: "nl",
  };

  test("accepts a complete form in the stored formats", () => {
    const parsed = parseCheckoutDetails(form(complete));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.phone).toBe("+31 6 23456789");
    expect(parsed.value.address.country).toBe("NL");
    expect(parsed.value.address.line2).toBeNull();
  });

  test("requires a phone number", () => {
    expect(parseCheckoutDetails(form({ ...complete, phone: "" }))).toEqual({ ok: false, errors: { phone: PHONE_REQUIRED } });
  });

  test("a number saved before the picker, with no country, is rejected rather than guessed", () => {
    expect(parseCheckoutDetails(form({ ...complete, phone: "0612345678", phoneCountry: "" }))).toEqual({
      ok: false,
      errors: { phone: PHONE_ERROR },
    });
  });

  test("requires the address, naming each missing part", () => {
    const parsed = parseCheckoutDetails(form({ ...complete, line1: "", postalCode: "", city: "", country: "" }));
    expect(parsed).toEqual({
      ok: false,
      errors: {
        line1: "Enter a street and number.",
        postalCode: "Enter a postcode.",
        city: "Enter a city.",
        country: "Choose a country.",
      },
    });
  });

  test("reports every missing part at once", () => {
    const parsed = parseCheckoutDetails(form({ ...complete, name: "", phone: "" }));
    expect(parsed).toEqual({ ok: false, errors: { name: "Enter your name.", phone: PHONE_REQUIRED } });
  });

  test("the account page still treats phone and address as optional", () => {
    expect(parseDetails(form({ name: "Sanne de Vries", phone: "", phoneCountry: "NL" })).ok).toBe(true);
  });
});

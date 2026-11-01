import { describe, expect, test } from "bun:test";
import { parseAddress, parseName, parsePhone } from "./validate";

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
    expect(parsePhone(form({ phone: "  " }))).toEqual({ ok: true, value: null });
  });
  test("accepts international formats and keeps them as typed, trimmed", () => {
    expect(parsePhone(form({ phone: " +31 6 1234 5678 " }))).toEqual({ ok: true, value: "+31 6 1234 5678" });
    expect(parsePhone(form({ phone: "(020) 123-4567" }))).toEqual({ ok: true, value: "(020) 123-4567" });
  });
  test("rejects letters and too few digits", () => {
    expect(parsePhone(form({ phone: "call me" }))).toEqual({
      ok: false,
      errors: { phone: "Enter a phone number with country code, like +31 6 1234 5678." },
    });
    expect(parsePhone(form({ phone: "+31 12" })).ok).toBe(false);
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

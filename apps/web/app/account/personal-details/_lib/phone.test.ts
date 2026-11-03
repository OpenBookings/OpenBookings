import { describe, expect, test } from "bun:test";
import { dialCode, flag, joinPhone, splitPhone } from "./phone";

describe("phone", () => {
  test("flag turns a country code into its emoji", () => {
    expect(flag("NL")).toBe("🇳🇱");
  });
  test("dialCode knows supported countries only", () => {
    expect(dialCode("NL")).toBe("31");
    expect(dialCode("AQ")).toBeNull();
  });
  test("splitPhone reads the country from the stored number", () => {
    expect(splitPhone("+44 7911 123456", "NL")).toEqual({ country: "GB", number: "7911 123456" });
    expect(splitPhone("+1 415 555 2671", "NL").country).toBe("US");
  });
  test("splitPhone prefers the fallback when it shares the dialling code", () => {
    expect(splitPhone("+1 416 555 0123", "CA")).toEqual({ country: "CA", number: "416 555 0123" });
  });
  test("splitPhone falls back for empty or unparseable numbers", () => {
    expect(splitPhone(null, "DE")).toEqual({ country: "DE", number: "" });
    expect(splitPhone("(020) 123-4567", "AQ")).toEqual({ country: "NL", number: "(020) 123-4567" });
  });
  test("joinPhone round-trips what splitPhone gives", () => {
    const { country, number } = splitPhone("+31 6 12345678", "NL");
    expect(joinPhone(number, country)).toBe("+31 6 12345678");
  });
});

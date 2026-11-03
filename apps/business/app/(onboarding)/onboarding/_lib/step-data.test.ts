import { describe, expect, test } from "bun:test";
import { isClientStep, parseClientStepData } from "./step-data";

const text = { displayName: "Villa", tagline: "Quiet", description: "Nice", houseRulesText: "No parties" };
const location = { streetAddress: "1 Main St", city: "Amsterdam", country: "NL", postalCode: "1011AB", coordinates: [4.9, 52.37] };

describe("saveStepData step allowlist", () => {
  test("only the two steps the onboarding forms save", () => {
    expect(isClientStep("core-info-text")).toBe(true);
    expect(isClientStep("core-info-location")).toBe(true);
  });

  test("never the server-owned keys that share the same JSON", () => {
    // stripe_account_id is the payout account promotion.ts copies onto the property.
    for (const step of ["stripe_account_id", "legal-n-boring", "completed_steps", "__proto__", "constructor", "toString", "", 1, null, undefined]) {
      expect(isClientStep(step)).toBe(false);
      expect(parseClientStepData(step, { anything: 1 })).toBeNull();
    }
  });

  test("an attacker-chosen payout account is rejected, not stored", () => {
    expect(parseClientStepData("stripe_account_id", "acct_ATTACKER")).toBeNull();
  });
});

describe("step payloads", () => {
  test("valid data round-trips", () => {
    expect(parseClientStepData("core-info-text", text)).toEqual(text);
    expect(parseClientStepData("core-info-location", location)).toEqual(location);
    expect(parseClientStepData("core-info-location", { ...location, coordinates: null })).toEqual({ ...location, coordinates: null });
  });

  test("unknown fields are dropped rather than persisted", () => {
    expect(parseClientStepData("core-info-text", { ...text, photos: ["x"], stripe_account_id: "acct_x" })).toEqual(text);
  });

  test("wrong types, missing fields and oversized text are rejected", () => {
    expect(parseClientStepData("core-info-text", { ...text, displayName: 5 })).toBeNull();
    expect(parseClientStepData("core-info-text", { displayName: "x" })).toBeNull();
    expect(parseClientStepData("core-info-text", { ...text, description: "x".repeat(10_001) })).toBeNull();
    expect(parseClientStepData("core-info-text", null)).toBeNull();
    expect(parseClientStepData("core-info-text", "string")).toBeNull();
  });

  test("coordinates must be a [lng, lat] pair on the globe", () => {
    for (const coordinates of [[200, 0], [0, 91], [1], [1, 2, 3], ["1", "2"], [Number.NaN, 0]]) {
      expect(parseClientStepData("core-info-location", { ...location, coordinates })).toBeNull();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { hasPin } from "./geo";

describe("hasPin", () => {
  test("accepts a real coordinate", () => {
    expect(hasPin(42.8134, 10.3235)).toBe(true);
  });

  test("rejects the 0,0 sentinel onboarding writes", () => {
    // properties.location is NOT NULL, so promotion.ts stores POINT(0 0) for a
    // host who never placed a pin. Every reader has to know that.
    expect(hasPin(0, 0)).toBe(false);
  });

  test("rejects a missing coordinate", () => {
    expect(hasPin(null, null)).toBe(false);
    expect(hasPin(52.37, null)).toBe(false);
    expect(hasPin(null, 4.9)).toBe(false);
  });

  test("accepts a real place with a zero in one axis", () => {
    // The equator and the Greenwich meridian are real; only the exact origin
    // is the sentinel.
    expect(hasPin(0, 4.9)).toBe(true);
    expect(hasPin(52.37, 0)).toBe(true);
  });
});

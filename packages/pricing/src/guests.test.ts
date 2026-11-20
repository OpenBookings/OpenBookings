import { describe, expect, test } from "bun:test";
import { AGE_BANDS, AGE_RANGES } from "./guests";

describe("age bands", () => {
  test("adults 13 or over, children 2–12, infants under 2", () => {
    expect(AGE_BANDS).toEqual({ adults: "Ages 13 or above", children: "Ages 2–12", infants: "Under 2" });
    expect(AGE_RANGES).toEqual({ adults: "13 or over", children: "2–12", infants: "under 2" });
  });
});

import { describe, expect, test } from "bun:test";
import { EU_PLACES, nearestEuPlace } from "./places";

describe("EU_PLACES", () => {
  test("has the 27 capitals, one per country", () => {
    expect(EU_PLACES).toHaveLength(27);
    expect(new Set(EU_PLACES.map((p) => p.country)).size).toBe(27);
  });
});

describe("nearestEuPlace", () => {
  test("Amsterdam is in NL", () => {
    expect(nearestEuPlace(52.37, 4.9).country).toBe("NL");
  });
  test("Rome is on Europe/Rome", () => {
    expect(nearestEuPlace(41.9, 12.5).timezone).toBe("Europe/Rome");
  });
  test("a point in Dublin is IE", () => {
    expect(nearestEuPlace(53.35, -6.26).country).toBe("IE");
  });
});

import { describe, expect, test } from "bun:test";
import { demoCityLabel, EU_PLACES, isNearEu, nearestEuPlace } from "./places";

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

describe("isNearEu", () => {
  test("EU cities, the outermost regions included, are near", () => {
    expect(isNearEu(52.37, 4.9)).toBe(true); // Amsterdam
    expect(isNearEu(69.9, 27.0)).toBe(true); // Utsjoki, Lapland
    expect(isNearEu(28.1, -15.4)).toBe(true); // Las Palmas, Canary Islands
    expect(isNearEu(37.74, -25.67)).toBe(true); // Ponta Delgada, Azores
  });
  test("the rest of the world is not", () => {
    expect(isNearEu(-33.87, 151.21)).toBe(false); // Sydney
    expect(isNearEu(40.71, -74.0)).toBe(false); // New York
    expect(isNearEu(25.2, 55.27)).toBe(false); // Dubai
  });
});

describe("demoCityLabel", () => {
  test("keeps a real place name, first part only", () => {
    expect(demoCityLabel("Utrecht", "Amsterdam")).toBe("Utrecht");
    expect(demoCityLabel("Celje, Slovenia", "Ljubljana")).toBe("Celje");
    expect(demoCityLabel("’s-Hertogenbosch", "Amsterdam")).toBe("’s-Hertogenbosch");
    expect(demoCityLabel("Düsseldorf", "Berlin")).toBe("Düsseldorf");
  });
  test("falls back to the capital for text that isn't a place name", () => {
    expect(demoCityLabel("CALL +31 600 000", "Amsterdam")).toBe("Amsterdam");
    expect(demoCityLabel("visit evil.example/win", "Amsterdam")).toBe("Amsterdam");
    expect(demoCityLabel("a@b", "Amsterdam")).toBe("Amsterdam");
    expect(demoCityLabel("x".repeat(61), "Amsterdam")).toBe("Amsterdam");
    expect(demoCityLabel(null, "Amsterdam")).toBe("Amsterdam");
    expect(demoCityLabel("  ", "Amsterdam")).toBe("Amsterdam");
  });
});

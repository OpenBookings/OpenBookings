import { describe, expect, test } from "bun:test";
import { makeDelta } from "./delta";

/**
 * The label matters as much as the number. The spec forbids relying on colour
 * alone, so every delta carries text a screen reader can read out and a
 * colourblind host can see.
 */
describe("makeDelta", () => {
  test("a rise reads up, with a rounded percentage", () => {
    expect(makeDelta(112, 100)).toEqual({
      pct: 12,
      direction: "up",
      label: "up 12%",
      goodDirection: "up",
    });
  });

  test("a fall reads down, with the magnitude, not the sign", () => {
    expect(makeDelta(80, 100)).toMatchObject({ pct: -20, direction: "down", label: "down 20%" });
  });

  test("no change reads flat", () => {
    expect(makeDelta(100, 100)).toMatchObject({ direction: "flat", label: "no change" });
  });

  test("no comparison data renders an em dash, not a zero", () => {
    // Zero would say "trading was identical last period", which is a different
    // claim from "we have nothing to compare against".
    expect(makeDelta(100, null)).toEqual({
      pct: null,
      direction: "flat",
      label: "—",
      goodDirection: "up",
    });
    expect(makeDelta(null, 100)).toMatchObject({ pct: null, label: "—" });
  });

  test("a previous period of zero has no percentage to give", () => {
    expect(makeDelta(500, 0)).toMatchObject({ pct: null, label: "—" });
  });

  test("goodDirection travels with the delta for the inverted widgets", () => {
    expect(makeDelta(12, 8, "down")).toMatchObject({
      direction: "up",
      label: "up 50%",
      goodDirection: "down",
    });
  });

  test("percentages round to one decimal below 10 and none above", () => {
    expect(makeDelta(103.7, 100).label).toBe("up 3.7%");
    expect(makeDelta(147.4, 100).label).toBe("up 47%");
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The info text sits in a tooltip, which renders only when open, so the copy
 * is checked in the source: guest details reach back 24 months, not further.
 */
describe("guests page copy", () => {
  const source = readFileSync(new URL("./guests-view.tsx", import.meta.url), "utf8");
  test("returning guests says what it measures: the last 24 months, not all history", () => {
    expect(source).toContain("A guest counts as returning if they stayed with you before, within the last 24 months.");
    expect(source).not.toContain("across all your history");
  });
});

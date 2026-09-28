import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { SECTION_TITLES, type SectionId } from "./csv";

/**
 * Each section is its own page, and the sidebar is the only way to reach one.
 * Nothing in the type system ties a `SectionId` to a route directory, so a
 * sixth section could ship deriving data, exporting CSV and appearing in no
 * navigation at all. This is the tie.
 */
const ANALYTICS_DIR = "app/(dashboard)/dashboard/analytics";

async function routeSegments(): Promise<string[]> {
  const entries = await readdir(ANALYTICS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
}

describe("analytics routes", () => {
  test("every section has a page", async () => {
    const segments = await routeSegments();
    const sections = Object.keys(SECTION_TITLES) as SectionId[];
    expect(segments.sort()).toEqual([...sections].sort());
  });
});

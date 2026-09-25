import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * We only ever see OpenBookings bookings, never the host's other channels, so
 * the denominator is the inventory they gave us — not the hotel. A host who
 * reads "occupancy" will compare it against their PMS and conclude we are
 * wrong. The word must not survive anywhere a host can reach it, which
 * includes CSV headers, aria-labels and tooltips, so this walks source rather
 * than checking rendered output.
 */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
    }),
  );
  return files.flat().filter((f) => /\.tsx?$/.test(f));
}

const ROOTS = ["lib/analytics", "app/(dashboard)/dashboard/analytics"];

/**
 * This guard has to name the word in order to search for it — its own regex,
 * test name and the paragraph above all contain it. Excluding itself is what
 * makes the check about the feature's copy rather than about itself.
 */
const SELF = "vocabulary.test.ts";

describe("analytics vocabulary", () => {
  test("says sell-through, never occupancy", async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of await walk(root)) {
        if (file.endsWith(SELF)) continue;
        const source = await readFile(file, "utf8");
        source.split("\n").forEach((line, i) => {
          if (/occupanc/i.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

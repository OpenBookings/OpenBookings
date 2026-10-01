import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
    }),
  );
  return files.flat().filter((file) => /\.tsx?$/.test(file));
}

const ROOTS = ["lib/analytics", "app/(dashboard)/dashboard/analytics"];
/** This file has to name what it forbids. */
const SELF = "guards.test.ts";

async function offenders(pattern: RegExp, allow: string[] = []): Promise<string[]> {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of await walk(root)) {
      if (file.endsWith(SELF) || allow.some((name) => file.endsWith(name))) continue;
      (await readFile(file, "utf8")).split("\n").forEach((line, index) => {
        if (pattern.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
  }
  return found;
}

describe("analytics guards", () => {
  /**
   * The host's property comes from the session, on the server, in one file.
   * Anything else that names a property identifier is a way to ask for
   * someone else's numbers.
   */
  test("no property identifier outside the readiness query", async () => {
    expect(
      await offenders(/propertyId|property_id|params\.property\b|["']property["']/, ["readiness-query.ts"]),
    ).toEqual([]);
  });

  test("hosts read occupancy, never the old term", async () => {
    expect(await offenders(/sell[- ]?through/i, ["routes.test.ts"])).toEqual([]);
  });

  test("no pie, donut or radial chart", async () => {
    expect(await offenders(/PieChart|RadialBar|<Pie\b/)).toEqual([]);
  });

  test("no smoothed lines", async () => {
    expect(await offenders(/type=["']monotone["']|type=["']natural["']|type=["']basis["']/)).toEqual([]);
  });

  test("no demo-only failure switch", async () => {
    expect(await offenders(/params\.fail\b|\bfail\?:/)).toEqual([]);
  });
});

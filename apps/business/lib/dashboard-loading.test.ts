import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const DASHBOARD = "app/(dashboard)/dashboard";

/** Every directory under `dir` holding a page.tsx, relative to `dir`. */
async function pageDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name === "page.tsx")
    .map((entry) => path.relative(dir, entry.parentPath));
}

describe("dashboard loading states", () => {
  // A loading.tsx above analytics or finance shows its fallback on a full page
  // load before their own logo loader streams in.
  test("no loading boundary sits above analytics or finance", () => {
    for (const dir of ["app", "app/(dashboard)", DASHBOARD, `${DASHBOARD}/analytics`, `${DASHBOARD}/finance`]) {
      expect(existsSync(`${dir}/loading.tsx`)).toBe(false);
    }
  });

  test("every analytics and finance page has its own logo loader", async () => {
    for (const section of ["analytics", "finance"]) {
      const root = `${DASHBOARD}/${section}`;
      for (const dir of await pageDirs(root)) {
        if (dir === "") continue; // analytics' index only redirects
        const loading = await readFile(path.join(root, dir, "loading.tsx"), "utf8");
        expect(loading).toMatch(/AnalyticsLoading|PageLoading/);
      }
    }
  });

  // Decided 2026-11-20: no grey placeholder blocks anywhere in the business
  // app. Pages show the logo loader, parts of a page the small InlineLoader.
  test("nothing outside components/ui uses a skeleton or a pulsing placeholder", async () => {
    const offenders: string[] = [];
    for (const root of ["app", "components", "lib"]) {
      const entries = await readdir(root, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
        const file = path.join(entry.parentPath, entry.name);
        if (file.startsWith(path.join("components", "ui"))) continue;
        const source = await readFile(file, "utf8");
        if (source.includes("components/ui/skeleton") || /animate-pulse[^"]*\bbg-/.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { PAGE_IDS } from "./pages";

const ANALYTICS_DIR = "app/(dashboard)/dashboard/analytics";

describe("analytics routes", () => {
  test("every page id has a route directory and no other directory exists", async () => {
    const entries = await readdir(ANALYTICS_DIR, { withFileTypes: true });
    const segments = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name);
    expect(segments.sort()).toEqual([...PAGE_IDS].sort());
  });

  test("the sidebar is built from the page list", async () => {
    const source = await readFile("components/dashboard/sidebar-08/app-sidebar.tsx", "utf8");
    expect(source).toContain("PAGE_IDS.map");
  });

  test("renamed routes redirect permanently", async () => {
    const config = await readFile("next.config.ts", "utf8");
    expect(config).toContain('source: "/dashboard/analytics/sell-through"');
    expect(config).toContain('destination: "/dashboard/analytics/occupancy"');
    expect(config).toContain('source: "/dashboard/analytics/bookings"');
    expect(config).toContain('destination: "/dashboard/analytics/booking-patterns"');
  });
});

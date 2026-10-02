import { describe, expect, test } from "bun:test";
import { csvFilename, pageCsv } from "./csv";
import { getPageData } from "./get-analytics";
import { PAGE_IDS } from "./pages";
import { resolvePeriod } from "./period";
import type { AnyPageData } from "./types";

const TODAY = "2026-10-01";
const q = { period: resolvePeriod("last-3-months", TODAY), compare: "previous" as const, today: TODAY, demo: true };

describe("pageCsv", () => {
  test("every page exports a header and rows, with no stray undefined or NaN", async () => {
    for (const page of PAGE_IDS) {
      // A loop variable is the whole union, which TypeScript cannot narrow per iteration.
      const csv = pageCsv((await getPageData(page, q)) as AnyPageData);
      expect(csv.startsWith("Page,")).toBe(true);
      expect(csv).toContain("From,2026-07-02");
      expect(csv).toContain("Metric,Key,Value,Note");
      expect(csv).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  test("money is in euros with cents", async () => {
    const csv = pageCsv(await getPageData("revenue", q));
    expect(csv).toMatch(/^Revenue \(EUR\),,\d+\.\d{2},/m);
  });

  test("the guests export names exactly the countries the page names", async () => {
    const data = await getPageData("guests", q);
    if (!data.view.countries.ok) throw new Error("countries did not render");
    const exported = pageCsv(data).split("\n").filter((line) => line.startsWith("Booker country,")).map((line) => line.split(",")[1]);
    expect(exported).toEqual(data.view.countries.value.map((row) => row.label));
  });

  test("a widget below its minimum says so, without figures", async () => {
    const thin = await getPageData("guests", { ...q, period: resolvePeriod("custom", TODAY, { from: "2022-01-01", to: "2022-01-02" }) });
    expect(pageCsv(thin)).toContain("Booker country,,not enough data,");
  });

  test("the filename carries the page and range and no property", async () => {
    expect(csvFilename(await getPageData("booking-patterns", q))).toBe("analytics-booking-patterns-2026-07-02-to-2026-10-01.csv");
  });
});

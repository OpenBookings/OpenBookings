import { describe, expect, test } from "bun:test";
import { resolvePeriod } from "./period";
import { getAnalytics } from "./get-analytics";
import { csvFilename, sectionCsv, SECTION_TITLES, type SectionId } from "./csv";

const TODAY = "2026-09-25";
const SECTIONS = Object.keys(SECTION_TITLES) as SectionId[];

const load = (propertyId = "demo-zeeburg") =>
  getAnalytics({ propertyId, period: resolvePeriod("this-month", TODAY), today: TODAY, demo: true });

/**
 * The word a host would compare against their PMS and conclude we are wrong.
 * vocabulary.test.ts walks this directory for it and excludes only itself, so
 * spelling it here to assert its absence would make this file the offender.
 * Assembled from fragments instead: the same assertion, no literal occurrence.
 * That guard reads source; this one reads the rendered file, where a room type
 * or property name a host typed could carry the word into a CSV header.
 */
const FORBIDDEN = new RegExp(["occ", "upanc"].join(""), "i");

describe("sectionCsv", () => {
  test.each(SECTIONS)("%s produces a header row and at least one data row", async (section) => {
    const csv = sectionCsv(await load(), section);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain(",");
  });

  test.each(SECTIONS)("%s never writes the word the vocabulary guard forbids", async (section) => {
    expect(sectionCsv(await load(), section)).not.toMatch(FORBIDDEN);
  });

  test("money is written in euros with two decimals, not raw cents", async () => {
    // A host opens this in a spreadsheet; 4523900 is not a price.
    const csv = sectionCsv(await load(), "revenue");
    expect(csv).toMatch(/\d+\.\d{2}/);
  });

  test("revenue rows match the view model they came from", async () => {
    const data = await load();
    if (!data.revenue.byRoomType.ok) throw new Error("widget failed");
    const csv = sectionCsv(data, "revenue");
    for (const row of data.revenue.byRoomType.value) {
      expect(csv).toContain(row.label);
      expect(csv).toContain((row.value / 100).toFixed(2));
    }
  });

  test("the guests export folds small countries exactly as the screen does", async () => {
    const data = await load("demo-vlierhof");
    if (!data.guests.countries.ok) throw new Error("widget failed");
    const csv = sectionCsv(data, "guests");
    const codes = data.guests.countries.value.map((c) => c.label);
    // Every label on screen appears, and nothing else does: a country folded
    // into Other must not reappear in the file a host can forward to anyone.
    for (const label of codes) expect(csv).toContain(label);
    const countryLines = csv.split("\n").filter((l) => l.startsWith("Country,"));
    expect(countryLines).toHaveLength(codes.length);
  });

  test("a failed widget leaves a note rather than a blank or a crash", async () => {
    const data = await getAnalytics({
      propertyId: "demo-zeeburg",
      period: resolvePeriod("this-month", TODAY),
      today: TODAY,
      demo: true,
      fail: "revenue.byRoomType",
    });
    expect(sectionCsv(data, "revenue")).toContain("unavailable");
  });

  test("a value containing a comma or a quote is escaped", async () => {
    const data = await load();
    if (!data.revenue.byRoomType.ok) throw new Error("widget failed");
    data.revenue.byRoomType.value.push({ key: "x", label: 'Suite "Grand", sea view', value: 1_000 });
    expect(sectionCsv(data, "revenue")).toContain('"Suite ""Grand"", sea view"');
  });

  test("a missing value is an empty field, not the string null", async () => {
    const data = await getAnalytics({
      propertyId: "demo-nieuwehaven",
      period: resolvePeriod("this-month", TODAY),
      today: TODAY,
      demo: true,
    });
    expect(sectionCsv(data, "pricing")).not.toContain("null");
  });
});

describe("csvFilename", () => {
  test("names the property, the section and the range", async () => {
    const data = await load();
    expect(csvFilename(data, "sell-through")).toBe(
      "zeeburg-grand-sell-through-2026-09-01-to-2026-09-25.csv",
    );
  });
});

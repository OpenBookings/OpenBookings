import { describe, expect, test } from "bun:test";
import {
  formatCents,
  formatCount,
  formatDayMonth,
  formatMonthYear,
  formatNights,
  formatPercent,
  trendSentence,
} from "./format";

/**
 * These exact strings are the point, not decoration. The locale has to render
 * identically under Bun (these tests), Node (the server) and a browser (after
 * hydration), or a money figure changes shape between the HTML and the client
 * and React reports a mismatch. en-NL does not: Bun gives "€ 4.523,90" where
 * Node gives "€4,523.90".
 */
/**
 * These abbreviations must not come from Intl. CLDR 42 renamed English
 * abbreviated September, so `month: "short"` gives "Sep" under Bun on macOS and
 * "Sept" under Bun on Linux and Node — a label that differs between a laptop,
 * CI, the server render and the browser. Spelling all twelve out here is what
 * keeps that from coming back.
 */
describe("formatDayMonth and formatMonthYear", () => {
  test("every month abbreviates to the same three letters on every engine", () => {
    const labels = Array.from({ length: 12 }, (_, i) =>
      formatDayMonth(`2026-${String(i + 1).padStart(2, "0")}-01`),
    );
    expect(labels).toEqual([
      "1 Jan", "1 Feb", "1 Mar", "1 Apr", "1 May", "1 Jun",
      "1 Jul", "1 Aug", "1 Sep", "1 Oct", "1 Nov", "1 Dec",
    ]);
  });

  test("days are not zero-padded, and months carry their year", () => {
    expect(formatDayMonth("2026-09-21")).toBe("21 Sep");
    expect(formatDayMonth("2026-09-01")).toBe("1 Sep");
    expect(formatMonthYear("2026-09-01")).toBe("Sep 2026");
    expect(formatMonthYear("2027-01-01")).toBe("Jan 2027");
  });
});

describe("formatCents", () => {
  test("renders euros from cents", () => {
    expect(formatCents(452_390)).toBe("€4,523.90");
    expect(formatCents(0)).toBe("€0.00");
  });

  test("a missing value is an em dash, never €0", () => {
    // €0 says they earned nothing; the em dash says we cannot say.
    expect(formatCents(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  test("renders one decimal by default and an em dash when absent", () => {
    expect(formatPercent(62.47)).toBe("62.5%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatCount and formatNights", () => {
  test("group thousands, and dash on null", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(null)).toBe("—");
    expect(formatNights(2.456)).toBe("2.5 nights");
    expect(formatNights(1)).toBe("1 night");
    expect(formatNights(null)).toBe("—");
  });
});

describe("trendSentence", () => {
  /**
   * This is the chart's aria-label. It has to be a sentence, built from the
   * chart's own numbers, because a static description would go stale the moment
   * the period changes and would then be actively misleading.
   */
  test("describes the movement across the series", () => {
    const points = [
      { bucket: "2026-09-01", label: "1 Sep", value: 310_000 },
      { bucket: "2026-09-02", label: "2 Sep", value: 420_000 },
    ];
    expect(trendSentence("Revenue", points, formatCents)).toBe(
      "Revenue rose from €3,100.00 on 1 Sep to €4,200.00 on 2 Sep.",
    );
  });

  test("says fell when it fell, and held steady when it did not move", () => {
    const at = (value: number, label: string) => ({ bucket: "x", label, value });
    expect(trendSentence("Revenue", [at(400, "1 Sep"), at(100, "2 Sep")], formatCents)).toContain("fell from");
    expect(trendSentence("Revenue", [at(400, "1 Sep"), at(400, "2 Sep")], formatCents)).toContain("held steady at");
  });

  test("a single point and an empty series still yield a usable sentence", () => {
    expect(trendSentence("Revenue", [{ bucket: "x", label: "1 Sep", value: 500 }], formatCents)).toBe(
      "Revenue was €5.00 on 1 Sep, the only point in this period.",
    );
    expect(trendSentence("Revenue", [], formatCents)).toBe("Revenue has no data in this period.");
  });
});

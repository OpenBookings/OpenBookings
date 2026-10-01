import { describe, expect, test } from "bun:test";
import { lineRows, MIN_CHART_POINTS } from "./chart-data";
import type { Point } from "./types";

const point = (value: number | null, incomplete = false, compare: number | null = null): Point => ({
  bucket: "2026-09-01", label: "1 Sep", value, compare, incomplete,
});

describe("lineRows", () => {
  test("a chart needs seven points", () => {
    expect(MIN_CHART_POINTS).toBe(7);
  });

  test("with nothing incomplete, everything is solid", () => {
    const rows = lineRows([point(1), point(2), point(3)]);
    expect(rows.map((r) => r.solid)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.dashed)).toEqual([null, null, null]);
  });

  test("the dashed segment starts at the last complete point so the two lines join", () => {
    const rows = lineRows([point(1), point(2), point(3, true)]);
    expect(rows.map((r) => r.solid)).toEqual([1, 2, null]);
    expect(rows.map((r) => r.dashed)).toEqual([null, 2, 3]);
  });

  test("gaps stay gaps and the comparison passes through", () => {
    const rows = lineRows([point(null, false, 4), point(2, false, 5)]);
    expect(rows[0]).toMatchObject({ solid: null, compare: 4 });
    expect(rows[1]).toMatchObject({ solid: 2, compare: 5 });
  });
});

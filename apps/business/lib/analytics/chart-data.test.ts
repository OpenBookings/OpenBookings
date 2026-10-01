import { describe, expect, test } from "bun:test";
import { declinedMessage, isEmptySample, lineRows, MIN_CHART_POINTS, tooltipLine } from "./chart-data";
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

describe("declinedMessage", () => {
  test("says how many are needed and how many there are, in the widget's own unit", () => {
    expect(declinedMessage({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 3 }))
      .toBe("Needs at least 5 bookings (3 so far)");
    expect(declinedMessage({ ok: false, reason: "below-minimum", basis: "stay", needed: 5, have: 0 }))
      .toBe("Needs at least 5 nights sold (0 so far)");
  });

  test("a caller can name a more precise unit", () => {
    expect(declinedMessage({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 1 }, "guests"))
      .toBe("Needs at least 5 guests (1 so far)");
  });

  test("an error shows its fixed message", () => {
    expect(declinedMessage({ ok: false, reason: "error", message: "We could not work this one out." }))
      .toBe("We could not work this one out.");
  });
});

describe("lineRows with a partial first bucket", () => {
  test("a leading partial bucket is dashed up to the first complete point", () => {
    const rows = lineRows([point(1, true), point(2), point(3), point(4, true)]);
    expect(rows.map((r) => r.solid)).toEqual([null, 2, 3, null]);
    expect(rows.map((r) => r.dashed)).toEqual([1, 2, 3, 4]);
  });

  test("complete points far from a partial one carry no dashed value", () => {
    const rows = lineRows([point(1, true), point(2), point(3), point(4), point(5)]);
    expect(rows.map((r) => r.dashed)).toEqual([1, 2, null, null, null]);
  });
});

describe("tooltipLine", () => {
  const labels = { solid: "Revenue", dashed: "Revenue, in progress", compare: "Previous period" };
  const euro = (v: number) => `€${v}`;

  test("names the series beside its value", () => {
    expect(tooltipLine("solid", 5, { solid: 5, dashed: null }, labels, euro)).toBe("Revenue: €5");
    expect(tooltipLine("compare", 3, { solid: 5, dashed: null }, labels, euro)).toBe("Previous period: €3");
  });

  test("at the join, the dashed duplicate of the solid value is dropped", () => {
    expect(tooltipLine("dashed", 5, { solid: 5, dashed: 5 }, labels, euro)).toBeNull();
    expect(tooltipLine("dashed", 7, { solid: null, dashed: 7 }, labels, euro)).toBe("Revenue, in progress: €7");
  });
});

describe("isEmptySample", () => {
  test("nothing at all in the period is empty, whether or not the widget has a minimum", () => {
    expect(isEmptySample({ ok: true, value: [], basis: "booking", sample: 0 })).toBe(true);
    expect(isEmptySample({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 0 })).toBe(true);
  });

  test("a few is not empty, and an error is not empty", () => {
    expect(isEmptySample({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 3 })).toBe(false);
    expect(isEmptySample({ ok: true, value: [], basis: "booking", sample: 4 })).toBe(false);
    expect(isEmptySample({ ok: false, reason: "error", message: "x" })).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { buckets, overlay, toSeries } from "./buckets";
import { makeDelta } from "./delta";
import { widget } from "./widget";

describe("widget", () => {
  test("carries its basis and sample", () => {
    expect(widget("stay", 12, () => 7)).toEqual({ ok: true, value: 7, basis: "stay", sample: 12 });
  });

  test("declines below its minimum sample and says how far short it is", () => {
    expect(widget("booking", 3, () => 7, 5)).toEqual({
      ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 3,
    });
  });

  test("contains a throwing derivation without leaking its message", () => {
    const w = widget("booking", 9, () => {
      throw new Error("secret detail");
    });
    expect(w).toEqual({ ok: false, reason: "error", message: "We could not work this one out." });
  });
});

describe("makeDelta", () => {
  test("null without a comparison, or against zero", () => {
    expect(makeDelta(10, null)).toBeNull();
    expect(makeDelta(null, 10)).toBeNull();
    expect(makeDelta(10, 0)).toBeNull();
  });

  test("null when the change rounds to zero, so no chip says 0%", () => {
    expect(makeDelta(1000, 1000)).toBeNull();
    expect(makeDelta(10_000, 10_003)).toBeNull();
  });

  test("direction, magnitude and tone", () => {
    expect(makeDelta(110, 100)).toEqual({ pct: 10, direction: "up", label: "up 10%", tone: "directional" });
    expect(makeDelta(95, 100, "neutral")).toEqual({ pct: -5, direction: "down", label: "down 5%", tone: "neutral" });
  });
});

describe("buckets", () => {
  test("weekly buckets cover the range and start on Monday", () => {
    const b = buckets({ from: "2026-09-01", to: "2026-09-20" }, "week", "2026-12-31");
    expect(b.map((x) => x.key)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(b.every((x) => !x.incomplete)).toBe(true);
  });

  test("the bucket containing today is incomplete", () => {
    const b = buckets({ from: "2026-09-01", to: "2026-09-24" }, "week", "2026-09-24");
    expect(b.map((x) => x.incomplete)).toEqual([false, false, false, true]);
  });

  test("a bucket cut short by the range end is incomplete even in the past", () => {
    const b = buckets({ from: "2026-06-01", to: "2026-06-17" }, "week", "2026-12-31");
    expect(b.at(-1)).toMatchObject({ key: "2026-06-15", incomplete: true });
  });

  test("today's daily bucket is incomplete, yesterday's is not", () => {
    const b = buckets({ from: "2026-09-23", to: "2026-09-24" }, "day", "2026-09-24");
    expect(b.map((x) => x.incomplete)).toEqual([false, true]);
  });
});

describe("toSeries and overlay", () => {
  const rows = [
    { date: "2026-09-01", v: 5 },
    { date: "2026-09-01", v: 7 },
    { date: "2026-09-03", v: 1 },
    { date: "2026-08-31", v: 99 },
  ];

  test("groups rows in range, keeps empty buckets, ignores rows outside", () => {
    const points = toSeries(rows, (r) => r.date, { from: "2026-09-01", to: "2026-09-03" }, "day", "2026-12-31",
      (group) => group.reduce((t, r) => t + r.v, 0));
    expect(points.map((p) => p.value)).toEqual([12, 0, 1]);
    expect(points.every((p) => p.compare === null)).toBe(true);
  });

  test("overlay aligns by position and never invents a value", () => {
    const current = toSeries(rows, (r) => r.date, { from: "2026-09-01", to: "2026-09-03" }, "day", "2026-12-31", (g) => g.length);
    const shorter = current.slice(0, 2).map((p) => ({ ...p, value: 40 }));
    expect(overlay(current, shorter).map((p) => p.compare)).toEqual([40, 40, null]);
    expect(overlay(current, null).map((p) => p.compare)).toEqual([null, null, null]);
  });
});

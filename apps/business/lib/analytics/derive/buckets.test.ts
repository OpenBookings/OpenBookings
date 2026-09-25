import { describe, expect, test } from "bun:test";
import { bucketKey, bucketLabel, emptyBuckets, toSeries } from "./buckets";

describe("bucketKey", () => {
  test("day is the date, week is its Monday, month is the first", () => {
    expect(bucketKey("2026-09-25", "day")).toBe("2026-09-25");
    expect(bucketKey("2026-09-25", "week")).toBe("2026-09-21");
    expect(bucketKey("2026-09-25", "month")).toBe("2026-09-01");
  });
});

describe("emptyBuckets", () => {
  test("a gap with no trading still gets a bucket", () => {
    // Without this a quiet fortnight would close up and the line would lie
    // about how fast revenue moved.
    expect(emptyBuckets("2026-09-01", "2026-09-05", "day")).toEqual([
      "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05",
    ]);
  });

  test("weeks start on the Monday on or before the range start", () => {
    expect(emptyBuckets("2026-09-02", "2026-09-20", "week")).toEqual([
      "2026-08-31", "2026-09-07", "2026-09-14",
    ]);
  });

  test("months cover partial months at both ends", () => {
    expect(emptyBuckets("2026-07-15", "2026-09-04", "month")).toEqual([
      "2026-07-01", "2026-08-01", "2026-09-01",
    ]);
  });
});

describe("toSeries", () => {
  const rows = [
    { date: "2026-09-21", value: 100 },
    { date: "2026-09-22", value: 50 },
    { date: "2026-09-28", value: 30 },
  ];
  const opts = {
    date: (r: (typeof rows)[number]) => r.date,
    value: (r: (typeof rows)[number]) => r.value,
    from: "2026-09-21",
    to: "2026-09-30",
  } as const;

  test("sums into weekly buckets", () => {
    expect(toSeries(rows, { ...opts, granularity: "week" })).toEqual([
      { bucket: "2026-09-21", label: "21 Sep", value: 150 },
      { bucket: "2026-09-28", label: "28 Sep", value: 30 },
    ]);
  });

  test("a day with no rows is present with a zero, not absent", () => {
    const series = toSeries(rows, { ...opts, granularity: "day" });
    expect(series).toHaveLength(10);
    expect(series.find((p) => p.bucket === "2026-09-23")).toEqual({
      bucket: "2026-09-23",
      label: "23 Sep",
      value: 0,
    });
  });

  test("mean divides by the rows present, not by the bucket length", () => {
    expect(
      toSeries(rows, { ...opts, granularity: "week", reduce: "mean" })[0].value,
    ).toBe(75);
  });

  test("an empty bucket under mean is 0, not NaN", () => {
    const series = toSeries([], { ...opts, granularity: "day", reduce: "mean" });
    expect(series.every((p) => Number.isFinite(p.value))).toBe(true);
    expect(series[0].value).toBe(0);
  });
});

describe("bucketLabel", () => {
  test("labels read for their grain", () => {
    expect(bucketLabel("2026-09-25", "day")).toBe("25 Sep");
    expect(bucketLabel("2026-09-21", "week")).toBe("21 Sep");
    expect(bucketLabel("2026-09-01", "month")).toBe("Sep 2026");
  });
});

import { describe, expect, test } from "bun:test";
import {
  addDays,
  comparisonRange,
  daysBetween,
  enumerateDates,
  granularityFor,
  parsePeriodParams,
  resolvePeriod,
  startOfWeek,
  weekdayOf,
  amsterdamToday,
  parseCompareParam,
} from "./period";

describe("date helpers", () => {
  test("addDays crosses months and years without a Date local getter", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  /**
   * Review Focus 3. Europe/Amsterdam moves to summer time on 2026-03-29 and
   * back on 2026-10-25. Date arithmetic that goes through a Date object and
   * local getters lands on the wrong day across those boundaries, and — worse —
   * lands on a *different* wrong day on a server in UTC than in a browser in
   * CET, which is a hydration mismatch that only appears twice a year.
   */
  test("date arithmetic is unaffected by DST transitions", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(3);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(3);
  });

  test("daysBetween is inclusive of both ends", () => {
    expect(daysBetween("2026-09-25", "2026-09-25")).toBe(1);
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(30);
  });

  test("startOfWeek snaps back to Monday, and is idempotent", () => {
    expect(startOfWeek("2026-09-25")).toBe("2026-09-21"); // Fri -> Mon
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // Sun belongs to the week before
  });

  test("weekdayOf is 1..7 with Monday first", () => {
    expect(weekdayOf("2026-09-21")).toBe(1);
    expect(weekdayOf("2026-09-25")).toBe(5);
    expect(weekdayOf("2026-09-27")).toBe(7);
  });

  test("enumerateDates covers both ends", () => {
    expect(enumerateDates("2026-09-25", "2026-09-27")).toEqual([
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
    expect(enumerateDates("2026-09-25", "2026-09-25")).toEqual(["2026-09-25"]);
  });
});

describe("granularityFor", () => {
  test("31 days buckets by day, 32 by week", () => {
    expect(granularityFor({ from: "2026-01-01", to: "2026-01-31" })).toBe("day");
    expect(granularityFor({ from: "2026-01-01", to: "2026-02-01" })).toBe("week");
  });

  test("six months buckets by week, a day more by month", () => {
    expect(granularityFor({ from: "2026-01-01", to: "2026-06-30" })).toBe("week");
    expect(granularityFor({ from: "2026-01-01", to: "2026-07-02" })).toBe("month");
  });
});


describe("resolvePeriod", () => {
  const TODAY = "2026-10-01";

  test("last 7 and last 30 days are inclusive of today", () => {
    expect(resolvePeriod("last-7-days", TODAY)).toEqual({ preset: "last-7-days", from: "2026-09-25", to: TODAY });
    expect(resolvePeriod("last-30-days", TODAY)).toEqual({ preset: "last-30-days", from: "2026-09-02", to: TODAY });
  });

  test("last 3 and last 12 months start the day after the same date back", () => {
    expect(resolvePeriod("last-3-months", TODAY).from).toBe("2026-07-02");
    expect(resolvePeriod("last-12-months", TODAY).from).toBe("2025-10-02");
  });

  test("year to date starts on 1 January", () => {
    expect(resolvePeriod("ytd", TODAY)).toEqual({ preset: "ytd", from: "2026-01-01", to: TODAY });
  });

  test("a custom range the wrong way round is swapped", () => {
    expect(resolvePeriod("custom", TODAY, { from: "2026-03-10", to: "2026-03-01" })).toEqual({
      preset: "custom", from: "2026-03-01", to: "2026-03-10",
    });
  });

  test("a custom range with a malformed date falls back to the default preset", () => {
    expect(resolvePeriod("custom", TODAY, { from: "2026-13-45", to: "2026-03-01" }).preset).toBe("last-3-months");
  });
});

describe("parsePeriodParams", () => {
  const TODAY = "2026-10-01";

  test("defaults to the last 3 months", () => {
    expect(parsePeriodParams({}, TODAY).preset).toBe("last-3-months");
  });

  test("an unknown or retired preset falls back", () => {
    expect(parsePeriodParams({ period: "this-month" }, TODAY).preset).toBe("last-3-months");
    expect(parsePeriodParams({ period: "'; drop table" }, TODAY).preset).toBe("last-3-months");
  });

  test("a repeated param uses its first value", () => {
    expect(parsePeriodParams({ period: ["last-7-days", "ytd"] }, TODAY).preset).toBe("last-7-days");
  });
});

describe("parseCompareParam", () => {
  test("defaults to the previous period", () => {
    expect(parseCompareParam(undefined)).toBe("previous");
    expect(parseCompareParam("foo")).toBe("previous");
  });

  test("accepts each mode, and the first of a repeated param", () => {
    expect(parseCompareParam("none")).toBe("none");
    expect(parseCompareParam(["last-year", "none"])).toBe("last-year");
  });
});

describe("comparisonRange", () => {
  const range = { from: "2026-09-01", to: "2026-09-30" };

  test("none has no comparison", () => {
    expect(comparisonRange(range, "none")).toBeNull();
  });

  test("previous is the equal-length span immediately before", () => {
    expect(comparisonRange(range, "previous")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
  });

  test("last-year shifts both ends back one year, clamping 29 February", () => {
    expect(comparisonRange(range, "last-year")).toEqual({ from: "2025-09-01", to: "2025-09-30" });
    expect(comparisonRange({ from: "2024-02-29", to: "2024-02-29" }, "last-year")).toEqual({
      from: "2023-02-28", to: "2023-02-28",
    });
  });
});

describe("amsterdamToday", () => {
  test("late evening UTC in summer is already tomorrow in Amsterdam", () => {
    expect(amsterdamToday(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });

  test("in winter the day turns at 23:00 UTC", () => {
    expect(amsterdamToday(new Date("2026-01-15T22:59:00Z"))).toBe("2026-01-15");
    expect(amsterdamToday(new Date("2026-01-15T23:00:00Z"))).toBe("2026-01-16");
  });

  test("the last-7-days range follows the Amsterdam day, not the UTC one", () => {
    const today = amsterdamToday(new Date("2026-07-01T22:30:00Z"));
    expect(resolvePeriod("last-7-days", today)).toEqual({ preset: "last-7-days", from: "2026-06-26", to: "2026-07-02" });
  });
});

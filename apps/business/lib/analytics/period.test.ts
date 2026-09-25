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
} from "./period";

const TODAY = "2026-09-25"; // a Friday

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

describe("resolvePeriod", () => {
  test("this month runs from the 1st to today, not to month end", () => {
    expect(resolvePeriod("this-month", TODAY)).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-25",
    });
  });

  test("last month is the whole previous calendar month", () => {
    expect(resolvePeriod("last-month", TODAY)).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  test("last month handles a January today by stepping into last year", () => {
    expect(resolvePeriod("last-month", "2026-01-15")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("last 3 months ends today", () => {
    expect(resolvePeriod("last-3-months", TODAY)).toMatchObject({
      from: "2026-06-26",
      to: "2026-09-25",
    });
  });

  test("year to date starts 1 January", () => {
    expect(resolvePeriod("ytd", TODAY)).toMatchObject({
      from: "2026-01-01",
      to: "2026-09-25",
    });
  });

  test("last 12 months ends today", () => {
    expect(resolvePeriod("last-12-months", TODAY)).toMatchObject({
      from: "2025-09-26",
      to: "2026-09-25",
    });
  });
});

describe("parsePeriodParams", () => {
  test("defaults to this month", () => {
    expect(parsePeriodParams({}, TODAY).preset).toBe("this-month");
  });

  test("an unknown preset falls back to this month rather than throwing", () => {
    expect(parsePeriodParams({ period: "since-forever" }, TODAY).preset).toBe(
      "this-month",
    );
  });

  test("a custom range is honoured", () => {
    expect(
      parsePeriodParams(
        { period: "custom", from: "2026-07-01", to: "2026-07-31" },
        TODAY,
      ),
    ).toMatchObject({ preset: "custom", from: "2026-07-01", to: "2026-07-31" });
  });

  /**
   * Review Focus 2. A host dragging backwards through the Calendar popover
   * produces from > to for as long as the drag lasts. Rejecting it blanks the
   * page mid-gesture; swapping shows them the range they are drawing.
   */
  test("a reversed custom range is swapped, not rejected", () => {
    expect(
      parsePeriodParams(
        { period: "custom", from: "2026-07-31", to: "2026-07-01" },
        TODAY,
      ),
    ).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
  });

  test("a single-day custom range survives", () => {
    const period = parsePeriodParams(
      { period: "custom", from: "2026-07-04", to: "2026-07-04" },
      TODAY,
    );
    expect(period).toMatchObject({ from: "2026-07-04", to: "2026-07-04" });
    expect(granularityFor(period)).toBe("day");
  });

  test("a custom range spanning the year boundary survives intact", () => {
    expect(
      parsePeriodParams(
        { period: "custom", from: "2025-12-15", to: "2026-01-15" },
        TODAY,
      ),
    ).toMatchObject({ from: "2025-12-15", to: "2026-01-15" });
  });

  test("a malformed custom date falls back to this month", () => {
    expect(
      parsePeriodParams({ period: "custom", from: "yesterday" }, TODAY).preset,
    ).toBe("this-month");
    expect(
      parsePeriodParams({ period: "custom", from: "2026-13-45", to: "2026-07-01" }, TODAY)
        .preset,
    ).toBe("this-month");
  });

  test("a custom range is clamped to five years so one URL cannot ask for everything", () => {
    const period = parsePeriodParams(
      { period: "custom", from: "1999-01-01", to: "2026-09-25" },
      TODAY,
    );
    expect(daysBetween(period.from, period.to)).toBeLessThanOrEqual(366 * 5);
  });
});

describe("granularityFor", () => {
  test("31 days buckets by day, 32 by week", () => {
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-01-31" })).toBe("day");
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-02-01" })).toBe("week");
  });

  test("six months buckets by week, a day more by month", () => {
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-06-30" })).toBe("week");
    expect(granularityFor({ preset: "custom", from: "2026-01-01", to: "2026-07-02" })).toBe("month");
  });
});

describe("comparisonRange", () => {
  test("an ordinary period compares against the equal-length span before it", () => {
    expect(
      comparisonRange({ preset: "this-month", from: "2026-09-01", to: "2026-09-25" }),
    ).toEqual({ from: "2026-08-07", to: "2026-08-31" });
  });

  test("year to date compares against the same span last year", () => {
    expect(comparisonRange({ preset: "ytd", from: "2026-01-01", to: "2026-09-25" })).toEqual({
      from: "2025-01-01",
      to: "2025-09-25",
    });
  });
});

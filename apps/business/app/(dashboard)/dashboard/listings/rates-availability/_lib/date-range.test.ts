import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { dateRange, isoDate, MAX_RANGE_DAYS, parseIsoDate } from "./date-range";

const range = (startDate: string, endDate: string) => dateRange.safeParse({ startDate, endDate });

describe("isoDate", () => {
  test("accepts real dates, including leap days", () => {
    for (const d of ["2026-01-31", "2028-02-29", "2000-02-29", "0001-01-01", "9999-12-31"]) {
      expect(isoDate.safeParse(d).success).toBe(true);
    }
  });

  test("rejects calendar-invalid dates that match the shape", () => {
    for (const d of ["2026-13-45", "2026-00-10", "2026-02-30", "2027-02-29", "1900-02-29", "2026-04-31", "2026-01-00"]) {
      expect(isoDate.safeParse(d).success).toBe(false);
    }
  });

  test("rejects anything not shaped YYYY-MM-DD", () => {
    for (const d of ["2026-1-5", "26-01-05", "2026/01/05", "2026-01-05T00:00", " 2026-01-05", ""]) {
      expect(isoDate.safeParse(d).success).toBe(false);
    }
  });

  test("parseIsoDate does not treat years 0-99 as 19xx", () => {
    expect(parseIsoDate("0050-06-01")).toBe(new Date("0050-06-01T00:00:00Z").getTime());
  });
});

describe("dateRange", () => {
  test("a single day and a normal stay window are fine", () => {
    expect(range("2026-06-01", "2026-06-01").success).toBe(true);
    expect(range("2026-06-01", "2026-06-30").success).toBe(true);
  });

  test("exactly MAX_RANGE_DAYS (inclusive) is allowed; one more is not", () => {
    // 2026-01-01 + 369 days = 2027-01-05 → 370 dates inclusive.
    expect(range("2026-01-01", "2027-01-05").success).toBe(true);
    const over = range("2026-01-01", "2027-01-06");
    expect(over.success).toBe(false);
    expect(!over.success && over.error.issues[0].message).toContain(String(MAX_RANGE_DAYS));
  });

  test("the whole-calendar range that would fan out to ~3.6M rows is refused", () => {
    expect(range("0001-01-01", "9999-12-31").success).toBe(false);
  });

  test("a leap year does not push a 370-day window over or under", () => {
    // 2028 has 366 days, so day 370 of a window starting on 1 Jan is 4 Jan 2029.
    expect(range("2028-01-01", "2029-01-04").success).toBe(true);
    expect(range("2028-01-01", "2029-01-05").success).toBe(false);
  });

  test("end before start is refused", () => {
    expect(range("2026-06-02", "2026-06-01").success).toBe(false);
  });

  test("an invalid calendar date is refused with a calendar message, not a span error", () => {
    const r = range("2026-06-01", "2026-13-45");
    expect(r.success).toBe(false);
    // The action returns issues[0].message to the host.
    expect(!r.success && r.error.issues[0].message).toBe("Not a real calendar date");
    expect(!r.success && r.error.issues.some((i) => i.message.includes("at most"))).toBe(false);
  });

  test("extra fields compose with .and() the way the action schemas use it", () => {
    const schema = dateRange.and(z.object({ roomId: z.string() }));
    expect(schema.safeParse({ startDate: "2026-06-01", endDate: "2026-06-02", roomId: "r" }).success).toBe(true);
    expect(schema.safeParse({ startDate: "2026-06-01", endDate: "2028-06-02", roomId: "r" }).success).toBe(false);
  });
});

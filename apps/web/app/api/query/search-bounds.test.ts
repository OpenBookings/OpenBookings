import { describe, expect, test } from "bun:test";
import { MAX_SEARCH_NIGHTS, parseSearchDate, searchBoundErrors } from "./search-bounds";

const ok = { lat: 52.37, lon: 4.9 };
const errs = (checkin: string, checkout: string, geo = ok) => searchBoundErrors({ ...geo, checkin, checkout });

describe("searchBoundErrors", () => {
  test("a normal stay passes", () => {
    expect(errs("2026-06-01", "2026-06-04")).toEqual([]);
    expect(errs("2026-06-01", "2026-06-02")).toEqual([]); // one night
  });

  test(`exactly ${MAX_SEARCH_NIGHTS} nights passes, one more does not`, () => {
    expect(errs("2026-06-01", "2026-07-01")).toEqual([]);
    expect(errs("2026-06-01", "2026-07-02")).toEqual([`stay cannot be longer than ${MAX_SEARCH_NIGHTS} nights`]);
  });

  test("the whole-calendar range that would fan out to ~3.6M dates is refused", () => {
    expect(errs("0001-01-01", "9999-12-31")).toHaveLength(1);
  });

  test("checkout must be after checkin: same day and reversed are refused", () => {
    expect(errs("2026-06-01", "2026-06-01")).toEqual(["checkout must be after checkin"]);
    expect(errs("2026-06-05", "2026-06-01")).toEqual(["checkout must be after checkin"]);
  });

  test("impossible or oddly shaped dates are a 400, not a database error", () => {
    expect(errs("2026-02-30", "2026-03-02")).toEqual(["checkin must be a valid date (YYYY-MM-DD)"]);
    expect(errs("2026-06-01", "2026-13-01")).toEqual(["checkout must be a valid date (YYYY-MM-DD)"]);
    expect(errs("2026-6-1", "2026-6-4")).toHaveLength(2);
    expect(errs("tomorrow", "next week")).toHaveLength(2);
  });

  test("coordinates must be on the globe", () => {
    expect(errs("2026-06-01", "2026-06-02", { lat: 91, lon: 4.9 })).toEqual(["lat must be between -90 and 90"]);
    expect(errs("2026-06-01", "2026-06-02", { lat: 52, lon: -181 })).toEqual(["lon must be between -180 and 180"]);
    expect(errs("2026-06-01", "2026-06-02", { lat: Infinity, lon: 4.9 })).toHaveLength(1);
  });
});

describe("parseSearchDate", () => {
  test("handles leap days and early years", () => {
    expect(parseSearchDate("2028-02-29")).not.toBeNull();
    expect(parseSearchDate("2027-02-29")).toBeNull();
    expect(parseSearchDate("0050-06-01")).toBe(new Date("0050-06-01T00:00:00Z").getTime());
  });
});

import { describe, expect, test } from "bun:test";
import { periodFor, periodOf, previousPeriod } from "./period";

describe("periodFor", () => {
  test("bounds are Amsterdam midnights, including the 25-hour day", () => {
    const oct = periodFor("2026-10");
    expect(oct.start).toBe("2026-10-01");
    expect(oct.end).toBe("2026-10-31");
    expect(oct.from.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(oct.to.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(periodFor("2026-03").to.toISOString()).toBe(
      "2026-03-31T22:00:00.000Z",
    );
  });

  test("end is the last calendar day", () => {
    expect(periodFor("2026-02").end).toBe("2026-02-28");
    expect(periodFor("2028-02").end).toBe("2028-02-29");
    expect(periodFor("2026-12").end).toBe("2026-12-31");
    expect(periodFor("2026-12").to.toISOString()).toBe(
      "2026-12-31T23:00:00.000Z",
    );
  });

  test("rejects malformed input", () => {
    expect(() => periodFor("2026-13")).toThrow();
    expect(() => periodFor("2026-00")).toThrow();
    expect(() => periodFor("2026-1")).toThrow();
    expect(() => periodFor("abc")).toThrow();
  });
});

describe("periodOf", () => {
  test("reads the month in Amsterdam", () => {
    expect(periodOf(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
    expect(periodOf(new Date("2026-10-31T22:30:00Z"))).toBe("2026-10");
  });
});

describe("previousPeriod", () => {
  test("returns the month before now in Amsterdam", () => {
    expect(previousPeriod(new Date("2026-11-01T05:00:00Z")).start).toBe(
      "2026-10-01",
    );
    expect(previousPeriod(new Date("2026-01-01T06:00:00Z")).start).toBe(
      "2025-12-01",
    );
  });
});

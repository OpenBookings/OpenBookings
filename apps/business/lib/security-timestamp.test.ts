import { describe, expect, test } from "bun:test";
import { formatSecurityTimestamp } from "./security-timestamp";

const AMS = "Europe/Amsterdam";
const now = new Date("2026-10-10T18:45:00+02:00");

describe("formatSecurityTimestamp", () => {
  test("the same calendar day reads as today, on a 24-hour clock", () => {
    expect(formatSecurityTimestamp("2026-10-10T18:38:05+02:00", now, AMS)).toBe("Today, 18:38");
    expect(formatSecurityTimestamp("2026-10-10T00:05:00+02:00", now, AMS)).toBe("Today, 00:05");
  });

  test("the day before reads as yesterday, however many hours ago it was", () => {
    expect(formatSecurityTimestamp("2026-10-09T23:59:00+02:00", now, AMS)).toBe("Yesterday, 23:59");
    expect(formatSecurityTimestamp("2026-10-09T00:01:00+02:00", now, AMS)).toBe("Yesterday, 00:01");
  });

  test("anything older gets its date", () => {
    expect(formatSecurityTimestamp("2026-10-08T09:07:00+02:00", now, AMS)).toBe("8 Oct 2026, 09:07");
  });

  test("the day is the viewer's, not UTC's", () => {
    // 23:30 UTC on the 9th is already the 10th in Amsterdam.
    expect(formatSecurityTimestamp("2026-10-09T23:30:00Z", now, AMS)).toBe("Today, 01:30");
    expect(formatSecurityTimestamp("2026-10-09T23:30:00Z", now, "UTC")).toBe("Yesterday, 23:30");
  });

  test("yesterday survives the clocks going back", () => {
    const afterChange = new Date("2026-10-26T08:00:00+01:00");
    expect(formatSecurityTimestamp("2026-10-25T01:30:00+02:00", afterChange, AMS)).toBe("Yesterday, 01:30");
  });

  test("a missing or unreadable date gives nothing to print", () => {
    expect(formatSecurityTimestamp(null, now, AMS)).toBeNull();
    expect(formatSecurityTimestamp("not a date", now, AMS)).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { parseStayInput, todayInZone } from "./stay-input";

const TODAY = "2031-11-01";
const stay = (over: Record<string, unknown> = {}) =>
  parseStayInput({ checkin: "2031-11-10", checkout: "2031-11-13", adults: "2", children: "0", rooms: "1", ...over }, TODAY);

describe("quote rejects bad stays", () => {
  test("a valid stay parses", () => {
    expect(stay()).toEqual({
      ok: true,
      value: { checkIn: "2031-11-10", checkOut: "2031-11-13", adults: 2, children: 0, infants: 0, rooms: 1 },
    });
  });

  test("URLSearchParams work, and children default to 0", () => {
    const p = new URLSearchParams({ checkin: "2031-11-01", checkout: "2031-11-02", adults: "3", rooms: "2" });
    expect(parseStayInput(p, TODAY)).toEqual({
      ok: true,
      value: { checkIn: "2031-11-01", checkOut: "2031-11-02", adults: 3, children: 0, infants: 0, rooms: 2 },
    });
  });

  test("infants are read, at most 4 per room", () => {
    expect(stay({ infants: "2" })).toMatchObject({ ok: true, value: { infants: 2 } });
    expect(stay({ infants: "4" }).ok).toBe(true);
    expect(stay({ infants: "5" })).toEqual({ ok: false, errors: ["at most 4 infants per room"] });
    expect(stay({ infants: "5", adults: "2", rooms: "2" }).ok).toBe(true);
    expect(stay({ infants: "x" })).toEqual({ ok: false, errors: ["infants must be a whole number from 0 to 36"] });
  });

  test("check-out on the check-in day is refused", () => {
    expect(stay({ checkout: "2031-11-10" })).toEqual({ ok: false, errors: ["checkout must be after checkin"] });
  });

  test("a check-in before today in the property's zone is refused", () => {
    expect(stay({ checkin: "2031-10-31", checkout: "2031-11-02" })).toEqual({
      ok: false,
      errors: ["checkin cannot be in the past"],
    });
    expect(stay({ checkin: TODAY, checkout: "2031-11-02" }).ok).toBe(true);
  });

  test("31 nights is refused, 30 is fine", () => {
    expect(stay({ checkin: "2031-11-10", checkout: "2031-12-11" })).toEqual({
      ok: false,
      errors: ["stay cannot be longer than 30 nights"],
    });
    expect(stay({ checkin: "2031-11-10", checkout: "2031-12-10" }).ok).toBe(true);
  });

  test("no adults is refused", () => {
    expect(stay({ adults: "0" })).toEqual({ ok: false, errors: ["adults must be a whole number from 1 to 30"] });
  });

  test("no rooms is refused", () => {
    expect(stay({ rooms: "0" })).toEqual({ ok: false, errors: ["rooms must be a whole number from 1 to 9"] });
  });

  test("more rooms than adults is refused", () => {
    expect(stay({ adults: "1", rooms: "2" })).toEqual({ ok: false, errors: ["every room needs an adult"] });
  });

  test("missing, fractional and odd values are refused", () => {
    const r = parseStayInput({ adults: "1.5", children: "-1", rooms: "x" }, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      "checkin is required",
      "checkout is required",
      "adults must be a whole number from 1 to 30",
      "children must be a whole number from 0 to 20",
      "rooms must be a whole number from 1 to 9",
    ]);
  });

  test("impossible dates are refused", () => {
    expect(stay({ checkin: "2031-02-30", checkout: "2031-03-02" })).toEqual({
      ok: false,
      errors: ["checkin must be a valid date (YYYY-MM-DD)"],
    });
  });
});

describe("todayInZone", () => {
  test("is the local calendar date", () => {
    const now = new Date("2031-11-01T23:30:00Z");
    expect(todayInZone("Europe/Lisbon", now)).toBe("2031-11-01");
    expect(todayInZone("Europe/Amsterdam", now)).toBe("2031-11-02");
  });
});

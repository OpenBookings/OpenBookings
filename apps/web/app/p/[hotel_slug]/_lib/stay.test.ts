import { describe, expect, test } from "bun:test";
import { guestsLabel, partyFromParams, stayDatesLabel, stayFromParams, stayToParams } from "./stay";

const TODAY = "2026-11-06";
const params = (s: string) => new URLSearchParams(s);

describe("stayFromParams", () => {
  test("reads a valid stay and counts the nights", () => {
    expect(stayFromParams(params("checkin=2026-12-16&checkout=2026-12-19&adults=2&rooms=1"), TODAY)).toEqual({
      checkIn: "2026-12-16",
      checkOut: "2026-12-19",
      nights: 3,
      adults: 2,
      children: 0,
      rooms: 1,
    });
  });

  test("defaults the party when only dates are given", () => {
    expect(stayFromParams(params("checkin=2026-12-16&checkout=2026-12-17"), TODAY)).toMatchObject({
      nights: 1,
      adults: 2,
      children: 0,
      rooms: 1,
    });
  });

  test("checkout on or before checkin is no stay", () => {
    expect(stayFromParams(params("checkin=2026-12-16&checkout=2026-12-16&adults=2&rooms=1"), TODAY)).toBeNull();
    expect(stayFromParams(params("checkin=2026-12-16&checkout=2026-12-15&adults=2&rooms=1"), TODAY)).toBeNull();
  });

  test("a check-in in the past is no stay", () => {
    expect(stayFromParams(params("checkin=2026-11-05&checkout=2026-11-08&adults=2&rooms=1"), TODAY)).toBeNull();
  });

  test("stayFromParams returns null without dates", () => {
    expect(stayFromParams(params(""), TODAY)).toBeNull();
    expect(stayFromParams(params("adults=2&rooms=1"), TODAY)).toBeNull();
    expect(stayFromParams(params("checkin=2026-12-16&adults=2"), TODAY)).toBeNull();
  });

  test("an impossible party is no stay", () => {
    expect(stayFromParams(params("checkin=2026-12-16&checkout=2026-12-19&adults=1&rooms=2"), TODAY)).toBeNull();
  });
});

describe("stayToParams", () => {
  test("round-trips through stayFromParams", () => {
    const stay = { checkIn: "2026-12-16", checkOut: "2026-12-20", adults: 3, children: 1, rooms: 2 };
    expect(stayFromParams(stayToParams(stay), TODAY)).toEqual({ ...stay, nights: 4 });
  });

  test("leaves out children when there are none", () => {
    const p = stayToParams({ checkIn: "2026-12-16", checkOut: "2026-12-20", adults: 2, children: 0, rooms: 1 });
    expect(p.toString()).toBe("checkin=2026-12-16&checkout=2026-12-20&adults=2&rooms=1");
  });
});

describe("partyFromParams", () => {
  test("reads the party without dates and clamps it", () => {
    expect(partyFromParams(params("adults=3&children=1&rooms=2"))).toEqual({ adults: 3, children: 1, rooms: 2 });
    expect(partyFromParams(params(""))).toEqual({ adults: 2, children: 0, rooms: 1 });
    expect(partyFromParams(params("adults=1&rooms=4"))).toEqual({ adults: 1, children: 0, rooms: 1 });
    expect(partyFromParams(params("adults=abc"))).toEqual({ adults: 2, children: 0, rooms: 1 });
  });
});

describe("labels", () => {
  test("dates read as month and day, whatever the browser's zone", () => {
    expect(stayDatesLabel({ checkIn: "2026-12-16", checkOut: "2026-12-20" })).toBe("Dec 16 – Dec 20");
  });

  test("guests read as adults and children", () => {
    expect(guestsLabel({ adults: 2, children: 0 })).toBe("2 adults");
    expect(guestsLabel({ adults: 1, children: 1 })).toBe("1 adult, 1 child");
    expect(guestsLabel({ adults: 2, children: 3 })).toBe("2 adults, 3 children");
  });
});

import { describe, expect, test } from "bun:test";
import { guestsLabel, partyFromParams, stayDatesLabel, stayFromParams, stayToParams, withStay } from "./stay";

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
      infants: 0,
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
    const stay = { checkIn: "2026-12-16", checkOut: "2026-12-20", adults: 3, children: 1, infants: 1, rooms: 2 };
    expect(stayFromParams(stayToParams(stay), TODAY)).toEqual({ ...stay, nights: 4 });
    expect(stayToParams({ ...stay, infants: 0 }).has("infants")).toBe(false);
  });

  test("leaves out children when there are none", () => {
    const p = stayToParams({ checkIn: "2026-12-16", checkOut: "2026-12-20", adults: 2, children: 0, infants: 0, rooms: 1 });
    expect(p.toString()).toBe("checkin=2026-12-16&checkout=2026-12-20&adults=2&rooms=1");
  });
});

describe("partyFromParams", () => {
  test("reads the party without dates and clamps it", () => {
    expect(partyFromParams(params("adults=3&children=1&infants=1&rooms=2"))).toEqual({ adults: 3, children: 1, infants: 1, rooms: 2 });
    expect(partyFromParams(params(""))).toEqual({ adults: 2, children: 0, infants: 0, rooms: 1 });
    expect(partyFromParams(params("adults=1&rooms=4"))).toEqual({ adults: 1, children: 0, infants: 0, rooms: 1 });
    expect(partyFromParams(params("adults=abc"))).toEqual({ adults: 2, children: 0, infants: 0, rooms: 1 });
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
    expect(guestsLabel({ adults: 2, children: 1, infants: 1 })).toBe("2 adults, 1 child, 1 infant");
    expect(guestsLabel({ adults: 2, children: 0, infants: 2 })).toBe("2 adults, 2 infants");
  });
});

describe("withStay", () => {
  test("writes picked dates and party over the URL's, keeping other params", () => {
    const next = withStay(params("checkin=2026-12-16&checkout=2026-12-19&adults=2&rooms=1&utm=x"), {
      checkIn: "2026-12-20",
      checkOut: "2026-12-22",
      adults: 3,
      children: 1,
      infants: 1,
      rooms: 2,
    });
    expect(next.get("utm")).toBe("x");
    expect(stayFromParams(next, TODAY)).toEqual({
      checkIn: "2026-12-20",
      checkOut: "2026-12-22",
      nights: 2,
      adults: 3,
      children: 1,
      infants: 1,
      rooms: 2,
    });
  });

  test("a party without dates is kept for when dates are picked", () => {
    const next = withStay(params(""), { checkIn: null, checkOut: null, adults: 1, children: 0, rooms: 1 });
    expect(next.toString()).toBe("adults=1&rooms=1");
  });

  test("drops children when there are none and a pending booking", () => {
    const next = withStay(params("children=2&book=abc:1"), { checkIn: "2026-12-20", checkOut: "2026-12-22", adults: 2, children: 0, rooms: 1 });
    expect(next.has("children")).toBe(false);
    expect(next.has("book")).toBe(false);
  });
});

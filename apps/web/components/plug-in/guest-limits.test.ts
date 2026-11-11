import { describe, expect, test } from "bun:test";
import { clampGuests } from "./guest-limits";

describe("clampGuests", () => {
  test("keeps a valid party", () => {
    expect(clampGuests({ adults: 2, children: 1, infants: 1, rooms: 1 })).toEqual({ adults: 2, children: 1, infants: 1, rooms: 1 });
  });

  test("never goes below one adult or one room", () => {
    expect(clampGuests({ adults: 0, children: -1, infants: -1, rooms: 0 })).toEqual({ adults: 1, children: 0, infants: 0, rooms: 1 });
  });

  test("no more rooms than adults, and at most 9", () => {
    expect(clampGuests({ adults: 2, children: 0, infants: 0, rooms: 3 })).toEqual({ adults: 2, children: 0, infants: 0, rooms: 2 });
    expect(clampGuests({ adults: 20, children: 0, infants: 0, rooms: 10 })).toEqual({ adults: 20, children: 0, infants: 0, rooms: 9 });
  });

  test("caps adults and children at what search accepts", () => {
    expect(clampGuests({ adults: 31, children: 21, infants: 0, rooms: 1 })).toEqual({ adults: 30, children: 20, infants: 0, rooms: 1 });
  });

  test("at most 4 infants a room, and fewer rooms take infants down with them", () => {
    expect(clampGuests({ adults: 2, children: 0, infants: 5, rooms: 1 }).infants).toBe(4);
    expect(clampGuests({ adults: 2, children: 0, infants: 5, rooms: 2 }).infants).toBe(5);
  });

  test("an adults-only property keeps children and infants at 0", () => {
    expect(clampGuests({ adults: 2, children: 1, infants: 1, rooms: 1 }, { childrenWelcome: false })).toEqual({
      adults: 2,
      children: 0,
      infants: 0,
      rooms: 1,
    });
  });
});

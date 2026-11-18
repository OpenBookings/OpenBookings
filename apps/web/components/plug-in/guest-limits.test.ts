import { describe, expect, test } from "bun:test";
import { clampGuests, fewestRoomsThatFit } from "./guest-limits";

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

describe("fewestRoomsThatFit", () => {
  const double = { maxAdults: 2, maxChildren: 1 };
  const family = { maxAdults: 2, maxChildren: 2 };

  test("the rooms asked for, when the party already fits", () => {
    expect(fewestRoomsThatFit({ adults: 2, children: 1, rooms: 1 }, [double])).toBe(1);
    expect(fewestRoomsThatFit({ adults: 4, children: 0, rooms: 3 }, [double])).toBe(3);
  });

  test("more rooms when one room cannot take the party's share", () => {
    expect(fewestRoomsThatFit({ adults: 6, children: 0, rooms: 1 }, [double])).toBe(3);
    expect(fewestRoomsThatFit({ adults: 5, children: 0, rooms: 1 }, [double])).toBe(3);
    expect(fewestRoomsThatFit({ adults: 2, children: 2, rooms: 1 }, [double, family])).toBe(1);
    expect(fewestRoomsThatFit({ adults: 2, children: 3, rooms: 1 }, [double, family])).toBe(2);
  });

  test("never more rooms than adults, nor than one booking takes", () => {
    expect(fewestRoomsThatFit({ adults: 1, children: 3, rooms: 1 }, [double])).toBeNull();
    expect(fewestRoomsThatFit({ adults: 30, children: 0, rooms: 1 }, [double])).toBeNull();
  });

  test("counts the units left when they are known", () => {
    expect(fewestRoomsThatFit({ adults: 4, children: 0, rooms: 1 }, [{ ...double, unitsLeft: 1 }])).toBeNull();
    expect(fewestRoomsThatFit({ adults: 4, children: 0, rooms: 1 }, [{ ...double, unitsLeft: 1 }, { ...double, unitsLeft: 1 }])).toBe(2);
  });

  test("no rooms known: null", () => {
    expect(fewestRoomsThatFit({ adults: 2, children: 0, rooms: 1 }, [])).toBeNull();
  });
});

describe("clampGuests with the hotel's rooms", () => {
  const rooms = [{ maxAdults: 2, maxChildren: 1 }];

  test("adds rooms when the party outgrows them", () => {
    expect(clampGuests({ adults: 3, children: 0, infants: 0, rooms: 1 }, { roomCapacities: rooms }).rooms).toBe(2);
  });

  test("keeps rooms from going below what the party needs", () => {
    expect(clampGuests({ adults: 4, children: 0, infants: 0, rooms: 1 }, { roomCapacities: rooms }).rooms).toBe(2);
  });

  test("leaves rooms alone when nothing would fit", () => {
    expect(clampGuests({ adults: 1, children: 3, infants: 0, rooms: 1 }, { roomCapacities: rooms }).rooms).toBe(1);
  });
});

import { describe, expect, test } from "bun:test";
import { evenRoomParties, partyKey, possibleRoomParties } from "./room-parties";

describe("room parties", () => {
  test("one room takes the whole party", () => {
    expect(evenRoomParties({ adults: 2, children: 1, infants: 0, rooms: 1 })).toEqual([{ adults: 2, children: 1, infants: 0 }]);
  });

  test("every party one room could be given, within the room and the party", () => {
    const parties = possibleRoomParties({ adults: 3, children: 1, infants: 0 }, { maxAdults: 2, maxChildren: 2, maxInfants: 4 });
    expect(parties.map(partyKey)).toEqual(["1/0/0", "1/1/0", "2/0/0", "2/1/0"]);
  });

  test("covers every share of an even split", () => {
    const party = { adults: 5, children: 3, infants: 2 };
    const keys = new Set(possibleRoomParties(party, { maxAdults: 3, maxChildren: 2, maxInfants: 4 }).map(partyKey));
    for (const rooms of [2, 3, 4, 5]) {
      for (const share of evenRoomParties({ ...party, rooms })) expect(keys.has(partyKey(share))).toBe(true);
    }
  });
});

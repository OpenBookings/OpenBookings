import { describe, expect, test } from "bun:test";
import { splitParty, type Unit } from "./split-party";

const unit = (roomId: string, maxAdults = 2, maxChildren = 1, ratePlanId = `${roomId}-rate`): Unit => ({
  roomId,
  ratePlanId,
  maxAdults,
  maxChildren,
});

const parties = (r: ReturnType<typeof splitParty>) => (r.ok ? r.rooms.map((x) => [x.adults, x.children]) : r);

describe("splitParty", () => {
  test("4 adults over 2 doubles is 2 and 2", () => {
    expect(parties(splitParty(4, 0, [unit("a"), unit("a")]))).toEqual([[2, 0], [2, 0]]);
  });

  test("3 adults over 2 doubles: the first room gets the extra", () => {
    expect(parties(splitParty(3, 0, [unit("a"), unit("b")]))).toEqual([[2, 0], [1, 0]]);
  });

  test("keeps each unit's room and rate", () => {
    const r = splitParty(2, 0, [unit("a", 2, 0, "flex"), unit("b", 2, 0, "nr")]);
    expect(r).toEqual({
      ok: true,
      rooms: [
        { roomId: "a", ratePlanId: "flex", adults: 1, children: 0, cots: 0, extraBeds: 0 },
        { roomId: "b", ratePlanId: "nr", adults: 1, children: 0, cots: 0, extraBeds: 0 },
      ],
    });
  });

  test("a unit's cots and extra beds go with its room", () => {
    const r = splitParty(2, 0, [{ ...unit("a"), cots: 1 }, { ...unit("b"), extraBeds: 1 }]);
    expect(r.ok && r.rooms.map((x) => [x.cots, x.extraBeds])).toEqual([[1, 0], [0, 1]]);
  });

  test("every room needs an adult", () => {
    expect(splitParty(2, 0, [unit("a"), unit("a"), unit("a")])).toEqual({ ok: false, reason: "too_many_rooms" });
  });

  test("no rooms is too few", () => {
    expect(splitParty(2, 0, [])).toEqual({ ok: false, reason: "too_few_rooms" });
  });

  test("a single room too small for the party does not fit", () => {
    expect(splitParty(2, 0, [unit("single", 1, 0)])).toEqual({ ok: false, reason: "does_not_fit", roomId: "single" });
    expect(splitParty(1, 2, [unit("a", 2, 1)])).toEqual({ ok: false, reason: "does_not_fit", roomId: "a" });
  });

  test("rooms that together sleep fewer than the party are too few", () => {
    expect(splitParty(5, 0, [unit("a"), unit("b")])).toEqual({ ok: false, reason: "too_few_rooms" });
  });

  test("children are dealt after adults", () => {
    expect(parties(splitParty(2, 2, [unit("a"), unit("b")]))).toEqual([[1, 1], [1, 1]]);
    expect(parties(splitParty(3, 1, [unit("a"), unit("b")]))).toEqual([[2, 1], [1, 0]]);
  });

  test("a full room is skipped, so mixed rooms still fit", () => {
    expect(parties(splitParty(3, 0, [unit("single", 1, 0), unit("double", 2, 0)]))).toEqual([[1, 0], [2, 0]]);
    expect(parties(splitParty(2, 1, [unit("a", 2, 0), unit("b", 2, 1)]))).toEqual([[1, 0], [1, 1]]);
  });
});

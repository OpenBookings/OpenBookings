import { describe, expect, test } from "bun:test";
import type { QuotedRoom } from "@/lib/booking/quote";
import { fitAdvice } from "./fit-advice";

type Reason = QuotedRoom["reasons"][number];

const quoted = (over: { maxAdults: number; maxChildren?: number; unitsLeft?: number; reasons?: Reason[]; planReasons?: Reason[] }) =>
  ({
    maxAdults: over.maxAdults,
    maxChildren: over.maxChildren ?? 0,
    unitsLeft: over.unitsLeft ?? 5,
    reasons: over.reasons ?? ["too_many_guests"],
    ratePlans: [{ reasons: over.planReasons ?? [] }],
  }) as unknown as QuotedRoom;

describe("fitAdvice", () => {
  test("suggests the fewest rooms that take the party", () => {
    expect(fitAdvice([quoted({ maxAdults: 2 })], { adults: 6, children: 0, rooms: 1 })).toEqual({ kind: "more_rooms", rooms: 3 });
    expect(fitAdvice([quoted({ maxAdults: 2 }), quoted({ maxAdults: 4 })], { adults: 6, children: 0, rooms: 1 })).toEqual({
      kind: "more_rooms",
      rooms: 2,
    });
  });

  test("too big for the hotel when no number of rooms fits", () => {
    expect(fitAdvice([quoted({ maxAdults: 2, unitsLeft: 1 })], { adults: 4, children: 0, rooms: 1 })).toEqual({ kind: "too_big" });
    expect(fitAdvice([quoted({ maxAdults: 2 })], { adults: 1, children: 3, rooms: 1 })).toEqual({ kind: "too_big" });
  });

  test("not about size when the rooms are sold out, closed, or their rates are not open", () => {
    expect(fitAdvice([quoted({ maxAdults: 2, reasons: ["sold_out"] })], { adults: 2, children: 0, rooms: 1 })).toBeNull();
    expect(fitAdvice([quoted({ maxAdults: 2, reasons: ["too_many_guests", "sold_out"] })], { adults: 6, children: 0, rooms: 1 })).toBeNull();
    expect(fitAdvice([quoted({ maxAdults: 2, planReasons: ["min_stay"] })], { adults: 6, children: 0, rooms: 1 })).toBeNull();
    expect(fitAdvice([], { adults: 2, children: 0, rooms: 1 })).toBeNull();
  });
});

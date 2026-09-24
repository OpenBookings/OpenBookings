import { describe, expect, test } from "bun:test";
import { availabilityLevel, resolveStatus, type StatusInput } from "./derive";
import type { RestrictionRule, RoomClosureRule } from "./types";

/**
 * Status precedence.
 *
 * Two things are being pinned here, and the second is the one that breaks
 * quietly: which reason the host sees *first*, and that every other reason
 * survives anyway. A cell that drops its min-stay rule while it happens to be
 * sold out is a cell that reopens into a surprise.
 */

const closureRule = (over: Partial<RestrictionRule> = {}): RestrictionRule => ({
  id: "rule-closed",
  startDate: "2026-07-01",
  endDate: "2026-07-05",
  isClosed: true,
  minStay: null,
  maxStay: null,
  closedToArrival: false,
  closedToDeparture: false,
  note: "Refurbishment",
  createdBy: "user-1",
  createdByName: "Sam",
  createdAt: "2026-06-01T10:00:00Z",
  ...over,
});

const stayRule = (over: Partial<RestrictionRule> = {}): RestrictionRule => ({
  ...closureRule({ id: "rule-stay", isClosed: false, note: null }),
  ...over,
});

const roomClosure = (over: Partial<RoomClosureRule> = {}): RoomClosureRule => ({
  id: "room-closure-1",
  startDate: "2026-07-01",
  endDate: "2026-07-10",
  note: "Whole floor out",
  createdBy: "user-2",
  createdByName: "Alex",
  createdAt: "2026-06-02T09:00:00Z",
  ...over,
});

const input = (over: Partial<StatusInput> = {}): StatusInput => ({
  available: 3,
  roomClosure: null,
  closure: null,
  restriction: null,
  effectiveMinStay: 1,
  planMinStay: 1,
  ...over,
});

describe("each level on its own", () => {
  test("nothing applies — open and bookable", () => {
    const result = resolveStatus(input());
    expect(result.primary).toBeNull();
    expect(result.reasons).toEqual([]);
    expect(result.state).toBe("open");
    expect(result.bookable).toBe(true);
  });

  test("a room closure closes the room type", () => {
    const result = resolveStatus(input({ roomClosure: roomClosure() }));
    expect(result.primary).toBe("ROOM_CLOSED");
    expect(result.state).toBe("room_closed");
    expect(result.bookable).toBe(false);
  });

  test("no availability is sold out, and nobody set it", () => {
    const result = resolveStatus(input({ available: 0 }));
    expect(result.primary).toBe("SOLD_OUT");
    expect(result.reasons[0].source).toEqual({ kind: "system" });
    expect(result.reasons[0].ruleId).toBeNull();
    expect(result.bookable).toBe(false);
  });

  test("a plan closure is a stop-sell, and names who set it", () => {
    const result = resolveStatus(input({ closure: closureRule() }));
    expect(result.primary).toBe("STOP_SELL");
    expect(result.state).toBe("closed");
    expect(result.reasons[0].source).toMatchObject({
      kind: "host",
      userName: "Sam",
      note: "Refurbishment",
    });
  });

  test("closed to arrival is restricted but still bookable", () => {
    const result = resolveStatus(
      input({ restriction: stayRule({ closedToArrival: true }) }),
    );
    expect(result.primary).toBe("CLOSED_TO_ARRIVAL");
    expect(result.state).toBe("restricted");
    expect(result.bookable).toBe(true);
  });

  test("a min stay above the plan default carries its value", () => {
    const result = resolveStatus(
      input({
        restriction: stayRule({ minStay: 3 }),
        effectiveMinStay: 3,
        planMinStay: 1,
      }),
    );
    expect(result.primary).toBe("MIN_STAY");
    expect(result.reasons[0].value).toBe(3);
  });

  test("a max stay is a restriction in its own right", () => {
    const result = resolveStatus(
      input({ restriction: stayRule({ maxStay: 7 }) }),
    );
    expect(result.primary).toBe("MAX_STAY");
    expect(result.reasons[0].value).toBe(7);
  });

  test("a restriction row repeating the plan's own min stay says nothing", () => {
    const result = resolveStatus(
      input({
        restriction: stayRule({ minStay: 2 }),
        effectiveMinStay: 2,
        planMinStay: 2,
      }),
    );
    expect(result.primary).toBeNull();
    expect(result.state).toBe("open");
  });
});

describe("combinations keep every reason", () => {
  test("sold out outranks a min stay, and the min stay survives", () => {
    const result = resolveStatus(
      input({
        available: 0,
        restriction: stayRule({ minStay: 3 }),
        effectiveMinStay: 3,
        planMinStay: 1,
      }),
    );

    expect(result.primary).toBe("SOLD_OUT");
    expect(result.reasons.map((r) => r.code)).toEqual(["SOLD_OUT", "MIN_STAY"]);
  });

  test("sold out outranks a plan closure", () => {
    const result = resolveStatus(
      input({ available: 0, closure: closureRule() }),
    );
    expect(result.primary).toBe("SOLD_OUT");
    expect(result.reasons.map((r) => r.code)).toEqual(["SOLD_OUT", "STOP_SELL"]);
  });

  test("a room closure outranks everything under it", () => {
    const result = resolveStatus(
      input({
        available: 0,
        roomClosure: roomClosure(),
        closure: closureRule(),
        restriction: stayRule({ maxStay: 7, closedToDeparture: true }),
      }),
    );

    expect(result.primary).toBe("ROOM_CLOSED");
    expect(result.reasons.map((r) => r.code)).toEqual([
      "ROOM_CLOSED",
      "SOLD_OUT",
      "STOP_SELL",
      "CLOSED_TO_DEPARTURE",
      "MAX_STAY",
    ]);
  });

  test("a room closure is marked inherited; a plan rule is not", () => {
    const result = resolveStatus(
      input({ roomClosure: roomClosure(), closure: closureRule() }),
    );
    expect(result.reasons[0].inherited).toBe(true);
    expect(result.reasons[1].inherited).toBe(false);
  });

  test("a reason reports its rule's range, not the cell's date", () => {
    const result = resolveStatus(input({ roomClosure: roomClosure() }));
    expect(result.reasons[0].range).toEqual({
      start: "2026-07-01",
      end: "2026-07-10",
    });
  });

  test("several restrictions on one row all appear, in precedence order", () => {
    const result = resolveStatus(
      input({
        restriction: stayRule({
          closedToArrival: true,
          closedToDeparture: true,
          minStay: 2,
          maxStay: 9,
        }),
        effectiveMinStay: 2,
        planMinStay: 1,
      }),
    );

    expect(result.reasons.map((r) => r.code)).toEqual([
      "CLOSED_TO_ARRIVAL",
      "CLOSED_TO_DEPARTURE",
      "MIN_STAY",
      "MAX_STAY",
    ]);
    expect(result.bookable).toBe(true);
  });
});

describe("availability level", () => {
  test("nothing left is sold out at any size", () => {
    expect(availabilityLevel(0, 1)).toBe("sold_out");
    expect(availabilityLevel(0, 12)).toBe("sold_out");
  });

  test("a one- or two-unit room type is never low", () => {
    expect(availabilityLevel(1, 1)).toBe("ok");
    expect(availabilityLevel(1, 2)).toBe("ok");
    expect(availabilityLevel(2, 2)).toBe("ok");
  });

  test("at three units, the last one is low", () => {
    expect(availabilityLevel(1, 3)).toBe("low");
    expect(availabilityLevel(2, 3)).toBe("ok");
  });

  test("larger room types use a quarter of the total", () => {
    expect(availabilityLevel(3, 12)).toBe("low");
    expect(availabilityLevel(4, 12)).toBe("ok");
    expect(availabilityLevel(5, 20)).toBe("low");
    expect(availabilityLevel(6, 20)).toBe("ok");
  });
});

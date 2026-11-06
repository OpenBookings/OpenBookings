import { describe, expect, test } from "bun:test";
import {
  bookableUnits,
  nightTotal,
  perRoomParty,
  pickReason,
  stayRuleReasons,
  type StayRule,
} from "./availability";

const rule = (date: string, extra: Partial<StayRule> = {}): StayRule => ({
  date,
  isClosed: false,
  minStay: null,
  maxStay: null,
  closedToArrival: false,
  closedToDeparture: false,
  ...extra,
});

const stay = { checkIn: "2026-07-01", checkOut: "2026-07-04", planMinStay: null, planMaxStay: null };

describe("nightTotal", () => {
  test("an override wins and blocked is not subtracted", () => {
    expect(nightTotal({ override: 8, totalRooms: null, totalUnits: 10, blocked: 2 })).toBe(8);
  });
  test("total_rooms minus blocked", () => {
    expect(nightTotal({ override: null, totalRooms: 5, totalUnits: 10, blocked: 1 })).toBe(4);
  });
  test("floors at zero", () => {
    expect(nightTotal({ override: null, totalRooms: null, totalUnits: 1, blocked: 3 })).toBe(0);
  });
});

describe("bookableUnits", () => {
  test("subtracts booked and held", () => {
    expect(bookableUnits({ total: 8, booked: 3, held: 2 })).toBe(3);
  });
  test("floors at zero", () => {
    expect(bookableUnits({ total: 1, booked: 1, held: 1 })).toBe(0);
  });
});

describe("stayRuleReasons", () => {
  test("plan minimum stay applies without a rule", () => {
    expect(stayRuleReasons({ ...stay, planMinStay: 5, rules: [] })).toEqual(["min_stay"]);
  });
  test("the arrival date's rule overrides the plan default", () => {
    expect(stayRuleReasons({ ...stay, planMinStay: 5, rules: [rule("2026-07-01", { minStay: 2 })] })).toEqual([]);
  });
  test("max stay", () => {
    expect(stayRuleReasons({ ...stay, planMaxStay: 2, rules: [] })).toEqual(["max_stay"]);
    expect(stayRuleReasons({ ...stay, planMaxStay: 2, rules: [rule("2026-07-01", { maxStay: 3 })] })).toEqual([]);
  });
  test("closed to arrival on check-in", () => {
    expect(stayRuleReasons({ ...stay, rules: [rule("2026-07-01", { closedToArrival: true })] })).toEqual([
      "closed_to_arrival",
    ]);
  });
  test("closed to arrival on a middle night is fine", () => {
    expect(stayRuleReasons({ ...stay, rules: [rule("2026-07-02", { closedToArrival: true })] })).toEqual([]);
  });
  test("closed to departure on check-out", () => {
    expect(stayRuleReasons({ ...stay, rules: [rule("2026-07-04", { closedToDeparture: true })] })).toEqual([
      "closed_to_departure",
    ]);
  });
  test("a closed night makes the rate closed", () => {
    expect(stayRuleReasons({ ...stay, rules: [rule("2026-07-03", { isClosed: true })] })).toEqual(["rate_closed"]);
  });
  test("isClosed on the departure date only is fine", () => {
    expect(stayRuleReasons({ ...stay, rules: [rule("2026-07-04", { isClosed: true })] })).toEqual([]);
  });
  test("reasons come back in priority order", () => {
    expect(
      stayRuleReasons({
        ...stay,
        planMinStay: 5,
        rules: [
          rule("2026-07-04", { closedToDeparture: true }),
          rule("2026-07-01", { closedToArrival: true }),
          rule("2026-07-02", { isClosed: true }),
        ],
      }),
    ).toEqual(["rate_closed", "closed_to_arrival", "closed_to_departure", "min_stay"]);
  });
  test("month boundaries count whole days", () => {
    expect(
      stayRuleReasons({ ...stay, checkIn: "2026-07-30", checkOut: "2026-08-02", planMinStay: 3, rules: [] }),
    ).toEqual([]);
  });
});

describe("perRoomParty", () => {
  test("ceil-divides across rooms", () => {
    expect(perRoomParty({ adults: 3, children: 1, rooms: 2 })).toEqual({ adults: 2, children: 1 });
  });
  test("zero rooms is treated as one", () => {
    expect(perRoomParty({ adults: 2, children: 0, rooms: 0 })).toEqual({ adults: 2, children: 0 });
  });
});

describe("pickReason", () => {
  test("highest priority wins", () => {
    expect(pickReason(["too_many_guests", "sold_out"])).toBe("sold_out");
  });
  test("null when empty", () => {
    expect(pickReason([])).toBeNull();
  });
});

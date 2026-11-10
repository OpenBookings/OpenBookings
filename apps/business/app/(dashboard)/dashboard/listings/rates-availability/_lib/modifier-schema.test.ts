import { describe, expect, test } from "bun:test";
import { modifierSchema } from "./modifier-schema";

const rule = (over: Record<string, unknown>) => ({
  kind: "weekend",
  direction: "up",
  adjustmentType: "flat",
  amount: "30",
  daysOfWeek: ["5", "6"],
  minNights: "",
  daysBeforeArrival: "",
  daysTillArrival: "",
  ...over,
});

const errorOn = (input: Record<string, unknown>, field: string) =>
  (modifierSchema.safeParse(rule(input)).error?.flatten().fieldErrors as Record<string, string[] | undefined>)?.[
    field
  ]?.[0];

describe("modifierSchema", () => {
  test("each kind maps to its modifier type and trigger condition", () => {
    expect(modifierSchema.parse(rule({}))).toEqual({
      type: "day_of_week",
      triggerCondition: { days_of_week: [5, 6] },
      adjustmentType: "flat",
      adjustmentValue: 30,
    });
    expect(modifierSchema.parse(rule({ kind: "length_of_stay", direction: "down", adjustmentType: "percent", amount: "10", minNights: "7" }))).toEqual({
      type: "length_of_stay",
      triggerCondition: { min_nights: 7 },
      adjustmentType: "percent",
      adjustmentValue: -10,
    });
    expect(modifierSchema.parse(rule({ kind: "early_bird", direction: "down", amount: "15", adjustmentType: "percent", daysBeforeArrival: "30" })).triggerCondition).toEqual({
      days_before_arrival: 30,
    });
    expect(modifierSchema.parse(rule({ kind: "last_minute", direction: "down", amount: "10", adjustmentType: "percent", daysTillArrival: "3" }))).toMatchObject({
      type: "last_minute",
      triggerCondition: { days_till_arrival: 3 },
      adjustmentValue: -10,
    });
  });

  test("the direction becomes the sign, and a discount kind always lowers the price", () => {
    expect(modifierSchema.parse(rule({ direction: "down" })).adjustmentValue).toBe(-30);
    expect(modifierSchema.parse(rule({ kind: "length_of_stay", direction: "up", minNights: "3" })).adjustmentValue).toBe(-30);
  });

  test("a percentage is 1 to 90, a flat amount 1 to 9999 euros", () => {
    expect(errorOn({ adjustmentType: "percent", amount: "95" }, "amount")).toBe("A percentage can be at most 90.");
    expect(errorOn({ amount: "0" }, "amount")).toBeDefined();
    expect(errorOn({ amount: "10000" }, "amount")).toBeDefined();
    expect(errorOn({ amount: "2.5" }, "amount")).toBeDefined();
  });

  test("each kind needs its own condition", () => {
    expect(errorOn({ daysOfWeek: [] }, "daysOfWeek")).toBe("Pick at least one day.");
    expect(errorOn({ daysOfWeek: ["7"] }, "daysOfWeek")).toBeDefined();
    expect(errorOn({ kind: "length_of_stay", minNights: "1" }, "minNights")).toBe("Stays of at least 2 nights.");
    expect(errorOn({ kind: "early_bird", daysBeforeArrival: "" }, "daysBeforeArrival")).toBeDefined();
    expect(errorOn({ kind: "last_minute", daysTillArrival: "31" }, "daysTillArrival")).toBeDefined();
    // Another kind's field is ignored.
    expect(modifierSchema.safeParse(rule({ minNights: "abc" })).success).toBe(true);
  });

  test("unknown kinds are refused", () => {
    expect(errorOn({ kind: "extra_guest" }, "kind")).toBeDefined();
  });
});

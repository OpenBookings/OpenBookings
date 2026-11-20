import { describe, expect, test } from "bun:test";
import type { Modifier, Night } from "@openbookings/pricing";
import { breakDown } from "./try-stay";

/** Consecutive nights from Fri 22 Jan 2027 at one price. */
const nights = (count: number, price: number): Night[] =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2027, 0, 22 + i)).toISOString().slice(0, 10),
    base_price: price,
    has_override: false,
  }));

const weekend: Modifier = {
  type: "day_of_week",
  adjustment_type: "flat",
  adjustment_value: 30,
  trigger_condition: { days_of_week: [5, 6] },
  sort_order: 0,
};
const weekly: Modifier = {
  type: "length_of_stay",
  adjustment_type: "percent",
  adjustment_value: -10,
  trigger_condition: { min_nights: 7 },
  sort_order: 1,
};
const earlyBooking: Modifier = {
  type: "early_bird",
  adjustment_type: "percent",
  adjustment_value: -15,
  trigger_condition: { days_before_arrival: 60 },
  sort_order: 2,
};

describe("Try a stay", () => {
  test("the example on the page: weekend nights up, early booking beats weekly", () => {
    // 7 nights × €185 from Fri 22 Jan 2027, booked 63 days ahead.
    const r = breakDown(nights(7, 185), [weekend, weekly, earlyBooking], 2, { arrival: "2027-01-22", bookedOn: "2026-11-20" });
    expect(r.base).toBe(1295);
    expect(r.adjustments).toEqual([{ label: "Fri, Sat · per night +€30", amount: 60 }]);
    expect(r.discount).toEqual({ label: "Early booking discount −15%", amount: -203.25 });
    expect(r.beaten).toEqual([{ label: "Weekly discount −10%", amount: -135.5 }]);
    expect(r.total).toBe(1151.75);
  });

  test("no rules: the nights at their own price", () => {
    const r = breakDown(nights(2, 100), [], 2, { arrival: "2027-01-22", bookedOn: "2027-01-20" });
    expect(r).toMatchObject({ base: 200, adjustments: [], discount: null, beaten: [], total: 200 });
  });

  test("a discount the stay doesn't qualify for is not listed", () => {
    // Booked 2 days ahead: no early booking; 3 nights: no weekly.
    const r = breakDown(nights(3, 100), [weekly, earlyBooking], 2, { arrival: "2027-01-22", bookedOn: "2027-01-20" });
    expect(r.discount).toBeNull();
    expect(r.beaten).toEqual([]);
  });
});

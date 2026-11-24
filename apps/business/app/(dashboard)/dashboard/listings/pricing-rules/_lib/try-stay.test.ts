import { describe, expect, test } from "bun:test";
import type { Modifier, Night } from "@openbookings/pricing";
import { breakDown } from "./try-stay";

/** Consecutive nights from Fri 22 Jan 2027 at one price, in cents. */
const nights = (count: number, cents: number): Night[] =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2027, 0, 22 + i)).toISOString().slice(0, 10),
    base_price_cents: cents,
    has_override: false,
  }));

const weekend: Modifier = {
  type: "day_of_week",
  adjustment_type: "flat",
  adjustment_value: 3000,
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
    const r = breakDown(nights(7, 18500), [weekend, weekly, earlyBooking], 2, { arrival: "2027-01-22", bookedOn: "2026-11-20" });
    expect(r.baseCents).toBe(129500);
    expect(r.adjustments).toEqual([{ label: "Fri, Sat · per night +€30", amountCents: 6000 }]);
    expect(r.discount).toEqual({ label: "Early booking discount −15%", amountCents: -20325 });
    expect(r.beaten).toEqual([{ label: "Weekly discount −10%", amountCents: -13550 }]);
    expect(r.totalCents).toBe(115175);
  });

  test("no rules: the nights at their own price", () => {
    const r = breakDown(nights(2, 10000), [], 2, { arrival: "2027-01-22", bookedOn: "2027-01-20" });
    expect(r).toMatchObject({ baseCents: 20000, adjustments: [], discount: null, beaten: [], totalCents: 20000 });
  });

  test("a fixed surcharge with cents shows them", () => {
    const r = breakDown(nights(2, 10000), [{ ...weekend, adjustment_value: 1550 }], 2, { arrival: "2027-01-22", bookedOn: "2027-01-20" });
    expect(r.adjustments).toEqual([{ label: "Fri, Sat · per night +€15.50", amountCents: 3100 }]);
    expect(r.totalCents).toBe(23100);
  });

  test("a discount the stay doesn't qualify for is not listed", () => {
    // Booked 2 days ahead: no early booking; 3 nights: no weekly.
    const r = breakDown(nights(3, 10000), [weekly, earlyBooking], 2, { arrival: "2027-01-22", bookedOn: "2027-01-20" });
    expect(r.discount).toBeNull();
    expect(r.beaten).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  hasStayLengthDiscount,
  resolveNightlyRates,
  resolveRoom,
  type Modifier,
  type Night,
  type RoomRow,
} from "./calculator";

/**
 * The ARI grid claims its cells are the same computation guests are quoted.
 * These tests pin that claim down: a one-night probe through
 * resolveNightlyRates must agree with a one-night search through resolveRoom,
 * and the stay-length probe must behave the way the grid's `*` marker says.
 */

const nightsFrom = (dates: string[], price: number): Night[] =>
  dates.map((date) => ({ date, base_price: price, has_override: false }));

const weekendSurcharge: Modifier = {
  type: "day_of_week",
  adjustment_type: "flat",
  adjustment_value: 20,
  // 2026-07-04 is a Saturday, 2026-07-05 a Sunday.
  trigger_condition: { days_of_week: [0, 6] },
  sort_order: 10,
};

const threeNightDiscount: Modifier = {
  type: "length_of_stay",
  adjustment_type: "percent",
  adjustment_value: -10,
  trigger_condition: { min_nights: 3 },
  sort_order: 20,
};

describe("resolveNightlyRates", () => {
  test("a plain night is just the base price", () => {
    const [cell] = resolveNightlyRates(
      nightsFrom(["2026-07-01"], 100),
      [],
      { baseOccupancy: 2, today: "2026-06-01" },
    );
    expect(cell.price).toBe(100);
    expect(cell.stay_length).toBe(1);
  });

  test("date-intrinsic modifiers fire per column", () => {
    const cells = resolveNightlyRates(
      nightsFrom(["2026-07-03", "2026-07-04"], 100),
      [weekendSurcharge],
      { baseOccupancy: 2, today: "2026-06-01" },
    );
    expect(cells[0].price).toBe(100); // Friday
    expect(cells[1].price).toBe(120); // Saturday
    expect(cells[1].applied_modifiers).toContain("day_of_week");
  });

  test("stay-length discounts do not fire on a one-night probe", () => {
    const [cell] = resolveNightlyRates(
      nightsFrom(["2026-07-01"], 100),
      [threeNightDiscount],
      { baseOccupancy: 2, today: "2026-06-01" },
    );
    expect(cell.price).toBe(100);
    expect(cell.applied_modifiers).not.toContain("length_of_stay");
  });

  test("they do fire once the probe is long enough, as a per-night average", () => {
    const cells = resolveNightlyRates(
      nightsFrom(["2026-07-01", "2026-07-02", "2026-07-03"], 100),
      [threeNightDiscount],
      { baseOccupancy: 2, stayLength: 3, today: "2026-06-01" },
    );
    // 300 total, less 10%, spread back over 3 nights.
    expect(cells[0].total).toBe(270);
    expect(cells[0].price).toBe(90);
    expect(cells[0].applied_modifiers).toContain("length_of_stay");
  });

  test("the tail is priced on the nights it has, not dropped", () => {
    const cells = resolveNightlyRates(
      nightsFrom(["2026-07-01", "2026-07-02"], 100),
      [],
      { baseOccupancy: 2, stayLength: 3, today: "2026-06-01" },
    );
    expect(cells).toHaveLength(2);
    expect(cells[1].stay_length).toBe(1);
    expect(cells[1].price).toBe(100);
  });

  test("grid cell agrees with the guest-facing search for the same stay", () => {
    const nights = nightsFrom(["2026-07-03"], 100);
    const row = {
      base_occupancy: 2,
      nights,
      modifiers: [weekendSurcharge, threeNightDiscount],
    } as unknown as RoomRow;

    const search = resolveRoom(
      row,
      { adults: 2, children: 0, arrivalDate: "2026-07-03" },
      "2026-06-01",
    );
    const [cell] = resolveNightlyRates(nights, row.modifiers, {
      baseOccupancy: 2,
      today: "2026-06-01",
    });

    expect(cell.price).toBe(search.total_price);
  });
});

describe("hasStayLengthDiscount", () => {
  test("detects a length-of-stay modifier", () => {
    expect(hasStayLengthDiscount([threeNightDiscount])).toBe(true);
  });

  test("a date-intrinsic modifier is not one", () => {
    expect(hasStayLengthDiscount([weekendSurcharge])).toBe(false);
  });
});

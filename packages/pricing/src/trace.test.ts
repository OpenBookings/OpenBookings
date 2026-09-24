import { describe, expect, test } from "bun:test";
import {
  resolveNightlyRates,
  resolveRoom,
  type Modifier,
  type Night,
  type PriceStep,
  type RoomRow,
} from "./calculator";

/**
 * The price build-up.
 *
 * The ARI grid's detail panel prints these steps and claims they explain the
 * cell. That claim is only worth anything if the column adds up, so the
 * invariant every test here asserts is the same one: the deltas sum to the
 * last step's result, and that result is the resolved price. A trace that
 * merely *describes* the modifiers would pass a laxer test and still mislead
 * the host who checks the arithmetic.
 */

const nightsFrom = (dates: string[], price: number): Night[] =>
  dates.map((date) => ({ date, base_price: price, has_override: false }));

/** Sum of the printed deltas must land on the printed total. */
function expectAddsUp(trace: PriceStep[], total: number) {
  const summed = trace.reduce((sum, step) => sum + step.delta, 0);
  expect(Number(summed.toFixed(2))).toBe(total);
  expect(trace[trace.length - 1].result).toBe(total);
}

const weekendSurcharge: Modifier = {
  type: "day_of_week",
  adjustment_type: "flat",
  adjustment_value: 20,
  // 2026-07-04 is a Saturday.
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

const earlyBird: Modifier = {
  type: "early_bird",
  adjustment_type: "percent",
  adjustment_value: -5,
  trigger_condition: { days_before_arrival: 30 },
  sort_order: 30,
};

describe("base step", () => {
  test("an unmodified night is one step, and it is the price", () => {
    const [cell] = resolveNightlyRates(nightsFrom(["2026-07-01"], 100), [], {
      baseOccupancy: 2,
      today: "2026-06-01",
    });

    expect(cell.trace).toHaveLength(1);
    expect(cell.trace[0]).toMatchObject({
      label: "Base rate",
      op: "base",
      delta: 100,
      result: 100,
    });
    expectAddsUp(cell.trace, cell.total);
  });

  test("an overridden night says so rather than calling it the BAR", () => {
    const [cell] = resolveNightlyRates(
      [{ date: "2026-07-01", base_price: 180, has_override: true }],
      [],
      { baseOccupancy: 2, today: "2026-06-01" },
    );

    expect(cell.trace).toHaveLength(1);
    expect(cell.trace[0]).toMatchObject({
      label: "Rate override",
      op: "set",
      result: 180,
    });
  });

  test("a probe spanning an override splits the base into two steps", () => {
    const [cell] = resolveNightlyRates(
      [
        { date: "2026-07-01", base_price: 100, has_override: false },
        { date: "2026-07-02", base_price: 180, has_override: true },
      ],
      [],
      { baseOccupancy: 2, stayLength: 2, today: "2026-06-01" },
    );

    expect(cell.trace.map((s) => s.label)).toEqual([
      "Base rate",
      "Rate override",
    ]);
    expect(cell.trace[1].result).toBe(280);
    expectAddsUp(cell.trace, cell.total);
  });
});

describe("modifier steps", () => {
  test("a surcharge that fires is one step, named and signed", () => {
    const cells = resolveNightlyRates(
      nightsFrom(["2026-07-03", "2026-07-04"], 100),
      [weekendSurcharge],
      { baseOccupancy: 2, today: "2026-06-01" },
    );

    const [friday, saturday] = cells;

    // Friday: eligible rule, no matching night, so no line in the build-up.
    expect(friday.trace).toHaveLength(1);
    expect(friday.price).toBe(100);

    expect(saturday.trace).toHaveLength(2);
    expect(saturday.trace[1]).toMatchObject({
      label: "Day of week",
      op: "flat",
      value: 20,
      delta: 20,
      result: 120,
      modifier_type: "day_of_week",
    });
    expectAddsUp(saturday.trace, saturday.total);
  });

  test("steps appear in the order they were applied", () => {
    const [cell] = resolveNightlyRates(
      nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 100),
      [weekendSurcharge, threeNightDiscount],
      { baseOccupancy: 2, stayLength: 3, today: "2026-06-01" },
    );

    // Base 300, +40 for two weekend nights, then −10% of the 340 subtotal.
    expect(cell.trace.map((s) => s.label)).toEqual([
      "Base rate",
      "Day of week",
      "Length of stay",
    ]);
    expect(cell.trace[1].delta).toBe(40);
    expect(cell.trace[2].delta).toBe(-34);
    expectAddsUp(cell.trace, cell.total);
  });

  test("a modifier excluded by mutual exclusivity leaves no step", () => {
    const [cell] = resolveNightlyRates(
      nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 100),
      [threeNightDiscount, earlyBird],
      { baseOccupancy: 2, stayLength: 3, today: "2026-01-01" },
    );

    // Both discounts are eligible — booked well ahead, three nights long — but
    // only the lower sort_order may fire.
    expect(cell.applied_modifiers).toEqual(["length_of_stay"]);
    expect(cell.trace.map((s) => s.label)).toEqual([
      "Base rate",
      "Length of stay",
    ]);
    expectAddsUp(cell.trace, cell.total);
  });

  test("a modifier that never matches leaves no step at all", () => {
    const [cell] = resolveNightlyRates(
      nightsFrom(["2026-07-01"], 100),
      [threeNightDiscount],
      { baseOccupancy: 2, today: "2026-06-01" },
    );

    expect(cell.trace).toHaveLength(1);
    expect(cell.applied_modifiers).toEqual([]);
  });
});

describe("rounding", () => {
  test("the printed deltas sum to the printed total even when steps round", () => {
    // 3 × 33.33 = 99.99, less 7.5% = 92.49075 — every step lands off a cent.
    const [cell] = resolveNightlyRates(
      nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 33.33),
      [
        {
          type: "length_of_stay",
          adjustment_type: "percent",
          adjustment_value: -7.5,
          trigger_condition: { min_nights: 3 },
          sort_order: 10,
        },
      ],
      { baseOccupancy: 2, stayLength: 3, today: "2026-06-01" },
    );

    expectAddsUp(cell.trace, cell.total);
    for (const step of cell.trace) {
      expect(step.result).toBe(Number(step.result.toFixed(2)));
      expect(step.delta).toBe(Number(step.delta.toFixed(2)));
    }
  });
});

describe("search results carry the same build-up", () => {
  const row: RoomRow = {
    hotel_id: "h1",
    hotel_name: "Test",
    hotel_slug: "test",
    city: "Amsterdam",
    country: "NL",
    hero_image_url: null,
    room_id: "r1",
    room_name: "Double",
    room_description: "",
    base_occupancy: 2,
    max_adults: 2,
    max_children: 0,
    rate_plan_id: "rp1",
    rate_plan_name: "Flexible",
    currency: "EUR",
    is_refundable: true,
    cancellation_policy: "",
    min_stay: 1,
    max_stay: null,
    nights: nightsFrom(["2026-07-03", "2026-07-04"], 100),
    modifiers: [weekendSurcharge],
  };

  test("a search resolution traces to its own total", () => {
    const resolved = resolveRoom(
      row,
      { adults: 2, children: 0, arrivalDate: "2026-07-03" },
      "2026-06-01",
    );

    expectAddsUp(resolved.trace, resolved.total_price);
    expect(resolved.trace.map((s) => s.label)).toEqual([
      "Base rate",
      "Day of week",
    ]);
  });
});

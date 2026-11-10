import { describe, expect, setSystemTime, test } from "bun:test";
import {
  extraGuests,
  hasStayLengthDiscount,
  todayInZone,
  resolveNightlyRates,
  resolveRoom,
  resolveSearchResults,
  type Modifier,
  type Night,
  type RoomRow,
} from "./calculator";
import type { TouristTaxRule } from "./tourist-tax";

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

    // The grid shows the host's own rate, which is the room price before
    // tourist tax.
    expect(cell.price).toBe(search.room_price);
  });
});

describe("resolveRoom with tourist tax", () => {
  const perPersonPerNight: TouristTaxRule = {
    effectiveFrom: "2026-01-01",
    charges: [{ kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false }],
    childrenExempt: true,
    maxNights: null,
  };
  const tenPercent: TouristTaxRule = {
    ...perPersonPerNight,
    charges: [{ kind: "percent", amount: 10, perPerson: false, perNight: false, perRoom: false }],
  };
  const row = (extra: Partial<RoomRow> = {}) =>
    ({
      base_occupancy: 2,
      nights: nightsFrom(["2026-07-01", "2026-07-02", "2026-07-03"], 100),
      modifiers: [],
      ...extra,
    }) as unknown as RoomRow;
  const params = { adults: 2, children: 1, arrivalDate: "2026-07-01" };

  test("without rules the all-in price is the room price", () => {
    const r = resolveRoom(row(), params, "2026-06-01");
    expect(r.room_price).toBe(300);
    expect(r.tourist_tax).toEqual({ total: 0, lines: [] });
    expect(r.total_price).toBe(300);
  });

  test("tourist tax is added on top of the room price", () => {
    const r = resolveRoom(row({ tourist_tax_rules: [perPersonPerNight] }), params, "2026-06-01");
    // Two adults pay, the child is exempt: €2.50 × 2 × 3
    expect(r.tourist_tax.total).toBe(15);
    expect(r.room_price).toBe(300);
    expect(r.total_price).toBe(315);
  });

  test("a percentage is taken of the price after discounts", () => {
    const r = resolveRoom(
      row({ tourist_tax_rules: [tenPercent], modifiers: [threeNightDiscount] }),
      params,
      "2026-06-01",
    );
    expect(r.room_price).toBe(270);
    expect(r.tourist_tax.total).toBe(27);
    expect(r.total_price).toBe(297);
  });

  test("search results are ranked by the all-in price", () => {
    const cheapRoomHighTax = row({
      hotel_id: "a",
      nights: nightsFrom(["2026-07-01"], 100),
      tourist_tax_rules: [{ ...perPersonPerNight, charges: [{ ...perPersonPerNight.charges[0], amount: 10 }] }],
    });
    const dearerRoomNoTax = row({ hotel_id: "b", nights: nightsFrom(["2026-07-01"], 110) });
    const ranked = resolveSearchResults([cheapRoomHighTax, dearerRoomNoTax], params, "2026-06-01");
    expect(ranked.map((r) => r.hotel_id)).toEqual(["b", "a"]);
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

describe("resolveRoom priced_nights", () => {
  test("a weekend-modified stay's nights sum to room_price to the cent", () => {
    const r = resolveRoom(
      {
        base_occupancy: 2,
        nights: nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 99.99),
        modifiers: [weekendSurcharge, threeNightDiscount],
      } as unknown as RoomRow,
      { adults: 2, children: 0, arrivalDate: "2026-07-03" },
      "2026-06-01",
    );
    expect(r.priced_nights.map((n) => n.date)).toEqual(["2026-07-03", "2026-07-04", "2026-07-05"]);
    const sumCents = r.priced_nights.reduce((s, n) => s + Math.round(n.price * 100), 0);
    expect(sumCents).toBe(Math.round(r.room_price * 100));
    for (const n of r.priced_nights) expect(n.price).toBe(Math.round(n.price * 100) / 100);
  });
});

describe("occupancy & extras", () => {
  const room = (extra: Partial<RoomRow> = {}, nights = ["2026-07-01"]) =>
    ({
      base_occupancy: 2,
      extra_adult_fee: 20,
      extra_child_fee: 10,
      cot_fee: 0,
      extra_bed_fee: 25,
      nights: nightsFrom(nights, 100),
      modifiers: [],
      ...extra,
    }) as unknown as RoomRow;
  const stay = (adults: number, children = 0, extra: { cots?: number; extraBeds?: number } = {}) => ({
    adults,
    children,
    arrivalDate: "2026-07-01",
    ...extra,
  });

  test("adults fill the included places first", () => {
    expect(extraGuests(2, 2, 1)).toEqual({ adults: 0, children: 1 });
    expect(extraGuests(2, 3, 0)).toEqual({ adults: 1, children: 0 });
    expect(extraGuests(2, 1, 2)).toEqual({ adults: 0, children: 1 });
    expect(extraGuests(1, 3, 2)).toEqual({ adults: 2, children: 2 });
  });

  test("guests above base occupancy pay the adult or child fee per night", () => {
    expect(resolveRoom(room(), stay(2), "2026-06-01").room_price).toBe(100);
    expect(resolveRoom(room(), stay(3), "2026-06-01").room_price).toBe(120);
    expect(resolveRoom(room(), stay(2, 1), "2026-06-01").room_price).toBe(110);
    expect(resolveRoom(room(), stay(3, 1), "2026-06-01").room_price).toBe(130);
  });

  test("no fee set means extra guests are not charged", () => {
    expect(resolveRoom(room({ extra_adult_fee: null }), stay(3), "2026-06-01").room_price).toBe(100);
  });

  test("cots and extra beds are charged per night, a free cot leaves no trace line", () => {
    const r = resolveRoom(room(), stay(2, 0, { cots: 1, extraBeds: 1 }), "2026-06-01");
    expect(r.room_price).toBe(125);
    expect(r.trace.map((s) => s.label)).toEqual(["Base rate", "Extra beds"]);
    expect(r.trace.at(-1)).toMatchObject({ op: "extra", value: 25, delta: 25, result: 125 });
  });

  test("discounts never touch the extras", () => {
    const r = resolveRoom(
      room({ modifiers: [threeNightDiscount] }, ["2026-07-01", "2026-07-02", "2026-07-03"]),
      stay(3),
      "2026-06-01",
    );
    expect(r.room_price).toBe(300 * 0.9 + 3 * 20);
    expect(r.priced_nights.map((n) => n.price)).toEqual([110, 110, 110]);
  });

  test("a percentage tourist tax includes the extras", () => {
    const tenPercent: TouristTaxRule = {
      effectiveFrom: "2026-01-01",
      charges: [{ kind: "percent", amount: 10, perPerson: false, perNight: false, perRoom: false }],
      childrenExempt: true,
      maxNights: null,
    };
    const r = resolveRoom(room({ tourist_tax_rules: [tenPercent] }), stay(3), "2026-06-01");
    expect(r.tourist_tax.total).toBe(12);
  });
});

describe("modifier fixes", () => {
  // Fri 3, Sat 4, Sun 5 July 2026.
  const stay = (modifiers: Modifier[], extra: Partial<RoomRow> = {}) =>
    resolveRoom(
      {
        base_occupancy: 2,
        nights: nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 100),
        modifiers,
        ...extra,
      } as unknown as RoomRow,
      { adults: 2, children: 0, arrivalDate: "2026-07-03" },
      "2026-06-01",
    );
  const discount = (type: "length_of_stay" | "early_bird", value: number, sort: number, flat = false): Modifier => ({
    type,
    adjustment_type: flat ? "flat" : "percent",
    adjustment_value: value,
    trigger_condition: type === "length_of_stay" ? { min_nights: 3 } : { days_before_arrival: 30 },
    sort_order: sort,
  });

  test("a discount entered as a positive number still lowers the price", () => {
    expect(stay([discount("length_of_stay", 10, 1)]).room_price).toBe(270);
  });

  test("a percentage discount is taken from the price with date surcharges, whatever the order", () => {
    // Weekend +20 on Sat and Sun: 340, then −10%.
    expect(stay([discount("length_of_stay", -10, 1), { ...weekendSurcharge, sort_order: 30 }]).room_price).toBe(306);
    expect(stay([{ ...weekendSurcharge, sort_order: 1 }, discount("length_of_stay", -10, 30)]).room_price).toBe(306);
  });

  test("a flat discount comes off the stay once", () => {
    expect(stay([discount("length_of_stay", -10, 1, true)]).room_price).toBe(290);
  });

  test("the largest discount for the guest wins, not the first", () => {
    const r = stay([discount("length_of_stay", -5, 1), discount("early_bird", -15, 2)]);
    expect(r.room_price).toBe(255);
    expect(r.applied_modifiers).toEqual(["early_bird"]);
  });

  test("weekdays are read from the date itself, not the server's time zone", () => {
    const saved = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const saturdayOnly: Modifier = { ...weekendSurcharge, trigger_condition: { days_of_week: [6] } };
      const friSat = resolveRoom(
        { base_occupancy: 2, nights: nightsFrom(["2026-07-03", "2026-07-04"], 100), modifiers: [saturdayOnly] } as unknown as RoomRow,
        { adults: 2, children: 0, arrivalDate: "2026-07-03" },
        "2026-06-01",
      );
      expect(friSat.room_price).toBe(220);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  test("without a date passed in, lead time counts from the property's today", () => {
    setSystemTime(new Date("2026-07-01T12:00:00Z")); // already 2 July in Kiritimati (UTC+14)
    try {
      const lastMinute: Modifier = {
        type: "last_minute",
        adjustment_type: "flat",
        adjustment_value: 30,
        trigger_condition: { days_till_arrival: 0 },
        sort_order: 1,
      };
      const row = {
        base_occupancy: 2,
        timezone: "Pacific/Kiritimati",
        nights: nightsFrom(["2026-07-02"], 100),
        modifiers: [lastMinute],
      } as unknown as RoomRow;
      expect(resolveRoom(row, { adults: 2, children: 0, arrivalDate: "2026-07-02" }).room_price).toBe(130);
    } finally {
      setSystemTime();
    }
  });

  test("today is the property's date, not UTC's", () => {
    const lateUtc = new Date("2026-07-01T12:00:00Z");
    expect(todayInZone("Pacific/Kiritimati", lateUtc)).toBe("2026-07-02");
    expect(todayInZone("Europe/Amsterdam", lateUtc)).toBe("2026-07-01");
  });
});

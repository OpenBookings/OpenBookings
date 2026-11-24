import { describe, expect, setSystemTime, test } from "bun:test";
import {
  extraGuests,
  hasStayLengthDiscount,
  isStayDiscount,
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

const nightsFrom = (dates: string[], priceCents: number): Night[] =>
  dates.map((date) => ({ date, base_price_cents: priceCents, has_override: false }));

const weekendSurcharge: Modifier = {
  type: "day_of_week",
  adjustment_type: "flat",
  adjustment_value: 2000,
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
      nightsFrom(["2026-07-01"], 10000),
      [],
      { baseOccupancy: 2, today: "2026-06-01" },
    );
    expect(cell.price_cents).toBe(10000);
    expect(cell.stay_length).toBe(1);
  });

  test("date-intrinsic modifiers fire per column", () => {
    const cells = resolveNightlyRates(
      nightsFrom(["2026-07-03", "2026-07-04"], 10000),
      [weekendSurcharge],
      { baseOccupancy: 2, today: "2026-06-01" },
    );
    expect(cells[0].price_cents).toBe(10000); // Friday
    expect(cells[1].price_cents).toBe(12000); // Saturday
    expect(cells[1].applied_modifiers).toContain("day_of_week");
  });

  test("stay-length discounts do not fire on a one-night probe", () => {
    const [cell] = resolveNightlyRates(
      nightsFrom(["2026-07-01"], 10000),
      [threeNightDiscount],
      { baseOccupancy: 2, today: "2026-06-01" },
    );
    expect(cell.price_cents).toBe(10000);
    expect(cell.applied_modifiers).not.toContain("length_of_stay");
  });

  test("they do fire once the probe is long enough, as a per-night average", () => {
    const cells = resolveNightlyRates(
      nightsFrom(["2026-07-01", "2026-07-02", "2026-07-03"], 10000),
      [threeNightDiscount],
      { baseOccupancy: 2, stayLength: 3, today: "2026-06-01" },
    );
    // 300 total, less 10%, spread back over 3 nights.
    expect(cells[0].total_cents).toBe(27000);
    expect(cells[0].price_cents).toBe(9000);
    expect(cells[0].applied_modifiers).toContain("length_of_stay");
  });

  test("the tail is priced on the nights it has, not dropped", () => {
    const cells = resolveNightlyRates(
      nightsFrom(["2026-07-01", "2026-07-02"], 10000),
      [],
      { baseOccupancy: 2, stayLength: 3, today: "2026-06-01" },
    );
    expect(cells).toHaveLength(2);
    expect(cells[1].stay_length).toBe(1);
    expect(cells[1].price_cents).toBe(10000);
  });

  test("grid cell agrees with the guest-facing search for the same stay", () => {
    const nights = nightsFrom(["2026-07-03"], 10000);
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
    expect(cell.price_cents).toBe(search.room_price_cents);
  });
});

describe("resolveRoom with tourist tax", () => {
  const perPersonPerNight: TouristTaxRule = {
    effectiveFrom: "2026-01-01",
    charges: [{ kind: "fixed", amountCents: 250, perPerson: true, perNight: true, perRoom: false }],
    childrenExempt: true,
    maxNights: null,
  };
  const tenPercent: TouristTaxRule = {
    ...perPersonPerNight,
    charges: [{ kind: "percent", percent: 10, perPerson: false, perNight: false, perRoom: false }],
  };
  const row = (extra: Partial<RoomRow> = {}) =>
    ({
      base_occupancy: 2,
      nights: nightsFrom(["2026-07-01", "2026-07-02", "2026-07-03"], 10000),
      modifiers: [],
      ...extra,
    }) as unknown as RoomRow;
  const params = { adults: 2, children: 1, arrivalDate: "2026-07-01" };

  test("without rules the all-in price is the room price", () => {
    const r = resolveRoom(row(), params, "2026-06-01");
    expect(r.room_price_cents).toBe(30000);
    expect(r.tourist_tax).toEqual({ totalCents: 0, lines: [] });
    expect(r.total_price_cents).toBe(30000);
  });

  test("tourist tax is added on top of the room price", () => {
    const r = resolveRoom(row({ tourist_tax_rules: [perPersonPerNight] }), params, "2026-06-01");
    // Two adults pay, the child is exempt: €2.50 × 2 × 3
    expect(r.tourist_tax.totalCents).toBe(1500);
    expect(r.room_price_cents).toBe(30000);
    expect(r.total_price_cents).toBe(31500);
  });

  test("a percentage is taken of the price after discounts", () => {
    const r = resolveRoom(
      row({ tourist_tax_rules: [tenPercent], modifiers: [threeNightDiscount] }),
      params,
      "2026-06-01",
    );
    expect(r.room_price_cents).toBe(27000);
    expect(r.tourist_tax.totalCents).toBe(2700);
    expect(r.total_price_cents).toBe(29700);
  });

  test("search results are ranked by the all-in price", () => {
    const cheapRoomHighTax = row({
      hotel_id: "a",
      nights: nightsFrom(["2026-07-01"], 10000),
      tourist_tax_rules: [{ ...perPersonPerNight, charges: [{ kind: "fixed", amountCents: 1000, perPerson: true, perNight: true, perRoom: false }] }],
    });
    const dearerRoomNoTax = row({ hotel_id: "b", nights: nightsFrom(["2026-07-01"], 11000) });
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
        nights: nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 9999),
        modifiers: [weekendSurcharge, threeNightDiscount],
      } as unknown as RoomRow,
      { adults: 2, children: 0, arrivalDate: "2026-07-03" },
      "2026-06-01",
    );
    // Fri 9999 − 1000 (999.9 rounded); Sat and Sun 11999 − 1200 (1199.9 rounded).
    expect(r.priced_nights).toEqual([
      { date: "2026-07-03", priceCents: 8999 },
      { date: "2026-07-04", priceCents: 10799 },
      { date: "2026-07-05", priceCents: 10799 },
    ]);
    expect(r.room_price_cents).toBe(30597);
    expect(r.priced_nights.reduce((s, n) => s + n.priceCents, 0)).toBe(r.room_price_cents);
  });
});

describe("money in whole cents", () => {
  test("10% off €99.99 × 3 nights: each night rounds half up to 8999, total 26997", () => {
    const r = resolveRoom(
      {
        base_occupancy: 2,
        nights: nightsFrom(["2026-07-01", "2026-07-02", "2026-07-03"], 9999),
        modifiers: [threeNightDiscount],
      } as unknown as RoomRow,
      { adults: 2, children: 0, arrivalDate: "2026-07-01" },
      "2026-06-01",
    );
    expect(r.priced_nights.map((n) => n.priceCents)).toEqual([8999, 8999, 8999]);
    expect(r.room_price_cents).toBe(26997);
    expect(r.total_price_cents).toBe(26997);
    expect(r.discount).toEqual({ label: "3+ night discount", percent: 10, amountCents: 3000 });
    expect(r.rate_nights.map((n) => n.priceCents)).toEqual([9999, 9999, 9999]);

    const [cell] = resolveNightlyRates(r.nights, [threeNightDiscount], {
      baseOccupancy: 2,
      stayLength: 3,
      today: "2026-06-01",
    });
    expect(cell.total_cents).toBe(26997);
    expect(cell.price_cents).toBe(8999);
  });

  test("a flat €15.50 weekend surcharge adds exactly 1550", () => {
    const surcharge: Modifier = { ...weekendSurcharge, adjustment_value: 1550 };
    const r = resolveRoom(
      {
        base_occupancy: 2,
        nights: nightsFrom(["2026-07-03", "2026-07-04"], 10000),
        modifiers: [surcharge],
      } as unknown as RoomRow,
      { adults: 2, children: 0, arrivalDate: "2026-07-03" },
      "2026-06-01",
    );
    expect(r.room_price_cents).toBe(21550);
    expect(r.priced_nights.map((n) => n.priceCents)).toEqual([10000, 11550]);
    expect(r.trace[1]).toMatchObject({ label: "Day of week", op: "flat", value: 1550, delta_cents: 1550, result_cents: 21550 });
  });

  test("every amount is an integer", () => {
    const r = resolveRoom(
      {
        base_occupancy: 2,
        extra_child_fee_cents: 1333,
        nights: nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 3333),
        modifiers: [{ ...weekendSurcharge, adjustment_type: "percent", adjustment_value: 12.5 }, threeNightDiscount],
        tourist_tax_rules: [
          {
            effectiveFrom: "2026-01-01",
            charges: [{ kind: "percent", percent: 6.5, vatIncludedPercent: 9, perPerson: false, perNight: false, perRoom: false }],
            childrenExempt: false,
            maxNights: null,
          },
        ],
      } as unknown as RoomRow,
      { adults: 2, children: 1, arrivalDate: "2026-07-03" },
      "2026-06-01",
    );
    const amounts = [
      r.subtotal_cents,
      r.room_price_cents,
      r.total_price_cents,
      r.tourist_tax.totalCents,
      r.discount?.amountCents ?? 0,
      ...r.priced_nights.map((n) => n.priceCents),
      ...r.rate_nights.map((n) => n.priceCents),
      ...r.extra_guests.flatMap((l) => [l.perNightCents, l.amountCents]),
      ...r.trace.flatMap((s) => [s.delta_cents, s.result_cents]),
    ];
    for (const amount of amounts) expect(Number.isInteger(amount)).toBe(true);
    expect(r.priced_nights.reduce((s, n) => s + n.priceCents, 0)).toBe(r.room_price_cents);
    expect(r.total_price_cents).toBe(r.room_price_cents + r.tourist_tax.totalCents);
  });
});

describe("occupancy & extras", () => {
  const room = (extra: Partial<RoomRow> = {}, nights = ["2026-07-01"]) =>
    ({
      base_occupancy: 2,
      extra_adult_fee_cents: 2000,
      extra_child_fee_cents: 1000,
      cot_fee_cents: 0,
      extra_bed_fee_cents: 2500,
      nights: nightsFrom(nights, 10000),
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
    expect(resolveRoom(room(), stay(2), "2026-06-01").room_price_cents).toBe(10000);
    expect(resolveRoom(room(), stay(3), "2026-06-01").room_price_cents).toBe(12000);
    expect(resolveRoom(room(), stay(2, 1), "2026-06-01").room_price_cents).toBe(11000);
    expect(resolveRoom(room(), stay(3, 1), "2026-06-01").room_price_cents).toBe(13000);
  });

  test("no fee set means extra guests are not charged", () => {
    expect(resolveRoom(room({ extra_adult_fee_cents: null }), stay(3), "2026-06-01").room_price_cents).toBe(10000);
  });

  test("cots and extra beds are paid at the property, outside the room price", () => {
    const r = resolveRoom(room({ cot_fee_cents: 1000 }, ["2026-07-01", "2026-07-02"]), stay(2, 0, { cots: 1, extraBeds: 1 }), "2026-06-01");
    expect(r.room_price_cents).toBe(20000);
    expect(r.total_price_cents).toBe(20000);
    expect(r.trace.map((s) => s.label)).toEqual(["Base rate"]);
    expect(r.pay_at_property).toEqual([
      { label: "Cots", count: 1, feePerNightCents: 1000, nights: 2, amountCents: 2000 },
      { label: "Extra beds", count: 1, feePerNightCents: 2500, nights: 2, amountCents: 5000 },
    ]);
    expect(r.pay_at_property_total_cents).toBe(7000);
  });

  test("rate_nights + extra_guests - discount add up to room_price", () => {
    const r = resolveRoom(
      room(
        {
          extra_child_fee_cents: 1500,
          nights: [
            { date: "2026-07-01", base_price_cents: 19500 },
            { date: "2026-07-02", base_price_cents: 19500 },
            { date: "2026-07-03", base_price_cents: 16500 },
          ] as unknown as Night[],
          modifiers: [
            { type: "early_bird", adjustment_type: "percent", adjustment_value: -10, trigger_condition: { days_before_arrival: 30 }, sort_order: 1 },
          ] as unknown as Modifier[],
        },
      ),
      stay(2, 1),
      "2026-05-01",
    );
    expect(r.rate_nights.map((n) => n.priceCents)).toEqual([19500, 19500, 16500]);
    expect(r.extra_guests).toEqual([{ kind: "child", count: 1, perNightCents: 1500, nights: 3, amountCents: 4500 }]);
    expect(r.discount?.amountCents).toBe(5550);
    const sum = r.rate_nights.reduce((s, n) => s + n.priceCents, 0) + 4500 - 5550;
    expect(sum).toBe(r.room_price_cents);
  });

  test("no extra guests: extra_guests is []", () => {
    expect(resolveRoom(room(), stay(2), "2026-06-01").extra_guests).toEqual([]);
  });

  test("a free cot is listed at 0, so the hotel still prepares it", () => {
    const r = resolveRoom(room(), stay(2, 0, { cots: 1 }), "2026-06-01");
    expect(r.pay_at_property).toEqual([{ label: "Cots", count: 1, feePerNightCents: 0, nights: 1, amountCents: 0 }]);
    expect(r.pay_at_property_total_cents).toBe(0);
  });

  test("infants take no place and pay no fee", () => {
    expect(resolveRoom(room(), { ...stay(2), infants: 2 }, "2026-06-01").room_price_cents).toBe(10000);
  });

  test("tourist tax counts infants only where the host's rule says they pay", () => {
    const perPerson = (childrenExempt: boolean, infantsTaxed?: boolean): TouristTaxRule => ({
      effectiveFrom: "2026-01-01",
      charges: [{ kind: "fixed", amountCents: 200, perPerson: true, perNight: true, perRoom: false }],
      childrenExempt,
      infantsTaxed,
      maxNights: null,
    });
    const tax = (rule: TouristTaxRule) =>
      resolveRoom(room({ tourist_tax_rules: [rule] }), { ...stay(2), infants: 1 }, "2026-06-01").tourist_tax.totalCents;
    // By default infants don't pay.
    expect(tax(perPerson(false))).toBe(400);
    expect(tax(perPerson(false, false))).toBe(400);
    // The host says infants pay.
    expect(tax(perPerson(false, true))).toBe(600);
    // Children exempt means infants are exempt too.
    expect(tax(perPerson(true, true))).toBe(400);
  });

  test("an infant never counts as a child for tourist tax", () => {
    const rule: TouristTaxRule = {
      effectiveFrom: "2026-01-01",
      charges: [{ kind: "fixed", amountCents: 200, perPerson: true, perNight: true, perRoom: false }],
      childrenExempt: false,
      maxNights: null,
    };
    const r = resolveRoom(room({ tourist_tax_rules: [rule] }), { ...stay(2, 1), infants: 2 }, "2026-06-01");
    expect(r.tourist_tax.totalCents).toBe(600);
  });

  test("discounts never touch the extras", () => {
    const r = resolveRoom(
      room({ modifiers: [threeNightDiscount] }, ["2026-07-01", "2026-07-02", "2026-07-03"]),
      stay(3),
      "2026-06-01",
    );
    expect(r.room_price_cents).toBe(27000 + 3 * 2000);
    expect(r.priced_nights.map((n) => n.priceCents)).toEqual([11000, 11000, 11000]);
  });

  describe("a rate plan a connected app manages", () => {
    const twoNightDiscount: Modifier = { ...threeNightDiscount, trigger_condition: { min_nights: 2 } };
    const appNights = [
      { date: "2026-07-01", base_price_cents: 18650, has_override: false, extra_adult_fee_cents: 2500, extra_child_fee_cents: null },
      { date: "2026-07-02", base_price_cents: 20000, has_override: false, extra_adult_fee_cents: 3000, extra_child_fee_cents: null },
    ];
    const managed = (extra: Partial<RoomRow> = {}) =>
      room({ managed: true, nights: appNights, modifiers: [twoNightDiscount], ...extra });

    test("takes the app's prices and extra fees per night, and no discount rule", () => {
      const r = resolveRoom(managed(), stay(3), "2026-06-01");
      expect(r.room_price_cents).toBe(44150);
      expect(r.discount).toBeNull();
      expect(r.applied_modifiers).toEqual([]);
      expect(r.trace.some((s) => s.modifier_type !== undefined)).toBe(false);
      expect(r.priced_nights).toEqual([
        { date: "2026-07-01", priceCents: 21150 },
        { date: "2026-07-02", priceCents: 23000 },
      ]);
      expect(r.rate_nights.map((n) => n.priceCents)).toEqual([18650, 20000]);
    });

    test("the same row unmanaged takes the discount and the room's own fee", () => {
      const r = resolveRoom(managed({ managed: false }), stay(3), "2026-06-01");
      expect(r.discount?.amountCents).toBe(3865);
      expect(r.room_price_cents).toBe(38650 - 3865 + 2 * 2000);
    });

    test("an extra-guest line per fee, so each still reads fee × nights", () => {
      const r = resolveRoom(managed(), stay(3), "2026-06-01");
      expect(r.extra_guests).toEqual([
        { kind: "adult", count: 1, perNightCents: 2500, nights: 1, amountCents: 2500 },
        { kind: "adult", count: 1, perNightCents: 3000, nights: 1, amountCents: 3000 },
      ]);
      const sum = r.rate_nights.reduce((s, n) => s + n.priceCents, 0) + r.extra_guests.reduce((s, l) => s + l.amountCents, 0);
      expect(sum).toBe(r.room_price_cents);
    });

    test("one line when the app's fee is the same every night", () => {
      const nights = appNights.map((n) => ({ ...n, extra_adult_fee_cents: 2500 }));
      const r = resolveRoom(managed({ nights }), stay(3), "2026-06-01");
      expect(r.extra_guests).toEqual([{ kind: "adult", count: 1, perNightCents: 2500, nights: 2, amountCents: 5000 }]);
      expect(r.trace.filter((s) => s.op === "extra")).toEqual([
        { label: "Extra adults", op: "extra", value: 2500, delta_cents: 5000, result_cents: 43650 },
      ]);
    });

    test("no fee from the app means no extra-guest charge, whatever the room says", () => {
      const r = resolveRoom(managed(), stay(2, 1), "2026-06-01");
      expect(r.room_price_cents).toBe(38650);
      expect(r.extra_guests).toEqual([]);
    });

    test("a night without the app's fee charges nothing for it", () => {
      const nights = [appNights[0], { ...appNights[1], extra_adult_fee_cents: null }];
      const r = resolveRoom(managed({ nights }), stay(3), "2026-06-01");
      expect(r.room_price_cents).toBe(38650 + 2500);
      expect(r.extra_guests).toEqual([{ kind: "adult", count: 1, perNightCents: 2500, nights: 1, amountCents: 2500 }]);
    });
  });

  test("a percentage tourist tax includes the extras", () => {
    const tenPercent: TouristTaxRule = {
      effectiveFrom: "2026-01-01",
      charges: [{ kind: "percent", percent: 10, perPerson: false, perNight: false, perRoom: false }],
      childrenExempt: true,
      maxNights: null,
    };
    const r = resolveRoom(room({ tourist_tax_rules: [tenPercent] }), stay(3), "2026-06-01");
    expect(r.tourist_tax.totalCents).toBe(1200);
  });
});

describe("modifier fixes", () => {
  // Fri 3, Sat 4, Sun 5 July 2026.
  const stay = (modifiers: Modifier[], extra: Partial<RoomRow> = {}) =>
    resolveRoom(
      {
        base_occupancy: 2,
        nights: nightsFrom(["2026-07-03", "2026-07-04", "2026-07-05"], 10000),
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
    expect(stay([discount("length_of_stay", 10, 1)]).room_price_cents).toBe(27000);
  });

  test("a percentage discount is taken from the price with date surcharges, whatever the order", () => {
    // Weekend +20 on Sat and Sun: 340, then −10%.
    expect(stay([discount("length_of_stay", -10, 1), { ...weekendSurcharge, sort_order: 30 }]).room_price_cents).toBe(30600);
    expect(stay([{ ...weekendSurcharge, sort_order: 1 }, discount("length_of_stay", -10, 30)]).room_price_cents).toBe(30600);
  });

  test("a flat discount is not a discount: it is ignored", () => {
    expect(stay([discount("length_of_stay", -1000, 1, true)]).room_price_cents).toBe(30000);
    expect(stay([discount("early_bird", -1000, 1, true)]).discount).toBeNull();
  });

  test("the discount is reported for checkout, named for the guest", () => {
    const week = nightsFrom(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07"], 6000);
    const los = (minNights: number): Modifier => ({ ...discount("length_of_stay", -10, 1), trigger_condition: { min_nights: minNights } });
    const named = (minNights: number) =>
      resolveRoom(
        { base_occupancy: 2, nights: week, modifiers: [los(minNights)] } as unknown as RoomRow,
        { adults: 2, children: 0, arrivalDate: "2026-07-01" },
        "2026-06-01",
      ).discount;
    expect(named(7)).toEqual({ label: "Weekly discount", percent: 10, amountCents: 4200 });
    expect(named(3)).toEqual({ label: "3+ night discount", percent: 10, amountCents: 4200 });
    expect(stay([discount("early_bird", -15, 1)]).discount).toEqual({ label: "Early booking discount", percent: 15, amountCents: 4500 });
    expect(stay([]).discount).toBeNull();
  });

  const lastMinute = (value: number, flat = false): Modifier => ({
    type: "last_minute",
    adjustment_type: flat ? "flat" : "percent",
    adjustment_value: value,
    trigger_condition: { days_till_arrival: 40 },
    sort_order: 5,
  });

  test("a lower last-minute price is a discount: it competes, it does not stack", () => {
    // Audit C15: 3 nights × 100, last minute −20% and 3+ nights −10% used to
    // stack to 216. Only the biggest applies now.
    const r = stay([discount("length_of_stay", -10, 1), lastMinute(-20)]);
    expect(r.room_price_cents).toBe(24000);
    expect(r.applied_modifiers).toEqual(["last_minute"]);
    expect(r.discount).toEqual({ label: "Last-minute discount", percent: 20, amountCents: 6000 });
  });

  test("a bigger stay discount beats a lower last-minute price", () => {
    const r = stay([discount("early_bird", -25, 1), lastMinute(-20)]);
    expect(r.room_price_cents).toBe(22500);
    expect(r.discount?.label).toBe("Early booking discount");
  });

  test("a raised last-minute price is an adjustment: it applies on top of the discount", () => {
    // 300 + 10% = 330, then −10% = 297.
    const r = stay([discount("length_of_stay", -10, 1), lastMinute(10)]);
    expect(r.room_price_cents).toBe(29700);
    expect(r.discount?.label).toBe("3+ night discount");
  });

  test("a lower last-minute fixed amount is not a discount: it is ignored", () => {
    expect(stay([lastMinute(-3000, true)]).room_price_cents).toBe(30000);
  });

  test("isStayDiscount sorts rules into discounts and price adjustments", () => {
    expect(isStayDiscount({ type: "length_of_stay", adjustment_value: -10 })).toBe(true);
    expect(isStayDiscount({ type: "early_bird", adjustment_value: -10 })).toBe(true);
    expect(isStayDiscount({ type: "last_minute", adjustment_value: -10 })).toBe(true);
    expect(isStayDiscount({ type: "last_minute", adjustment_value: 10 })).toBe(false);
    expect(isStayDiscount({ type: "day_of_week", adjustment_value: -10 })).toBe(false);
  });

  test("the largest discount for the guest wins, not the first", () => {
    const r = stay([discount("length_of_stay", -5, 1), discount("early_bird", -15, 2)]);
    expect(r.room_price_cents).toBe(25500);
    expect(r.applied_modifiers).toEqual(["early_bird"]);
  });

  test("weekdays are read from the date itself, not the server's time zone", () => {
    const saved = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const saturdayOnly: Modifier = { ...weekendSurcharge, trigger_condition: { days_of_week: [6] } };
      const friSat = resolveRoom(
        { base_occupancy: 2, nights: nightsFrom(["2026-07-03", "2026-07-04"], 10000), modifiers: [saturdayOnly] } as unknown as RoomRow,
        { adults: 2, children: 0, arrivalDate: "2026-07-03" },
        "2026-06-01",
      );
      expect(friSat.room_price_cents).toBe(22000);
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
        adjustment_value: 3000,
        trigger_condition: { days_till_arrival: 0 },
        sort_order: 1,
      };
      const row = {
        base_occupancy: 2,
        timezone: "Pacific/Kiritimati",
        nights: nightsFrom(["2026-07-02"], 10000),
        modifiers: [lastMinute],
      } as unknown as RoomRow;
      expect(resolveRoom(row, { adults: 2, children: 0, arrivalDate: "2026-07-02" }).room_price_cents).toBe(13000);
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

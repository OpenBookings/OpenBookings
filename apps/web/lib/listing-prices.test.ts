import { describe, expect, test } from "bun:test";
import type { TouristTaxRule } from "@openbookings/pricing";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
import { withAllInPrices, withCancellationTerms } from "./listing-prices";

const room = (extra: Partial<DbRoom> = {}): DbRoom => ({
  id: "r1",
  name: "Garden",
  description: null,
  room_type: null,
  bed_type: null,
  size_sqm: null,
  max_occupancy: 3,
  base_occupancy: 2,
  images: [],
  tags: [],
  rate_plans: [
    { id: "p1", name: "Room only", bar_cents: 10000, currency: "EUR", is_refundable: true, meal_plan: null },
  ],
  ...extra,
});

const perPersonPerNight: TouristTaxRule = {
  effectiveFrom: "2026-01-01",
  charges: [{ kind: "fixed", amountCents: 250, perPerson: true, perNight: true, perRoom: false }],
  childrenExempt: false,
  maxNights: null,
};

describe("withAllInPrices", () => {
  test("a night's price includes tourist tax for the room's standard number of guests", () => {
    const [r] = withAllInPrices([room()], [perPersonPerNight], "2026-10-30");
    expect(r.rate_plans[0].price_per_night_cents).toBe(10500);
  });

  test("without rules it is the host's rate", () => {
    const [r] = withAllInPrices([room()], [], "2026-10-30");
    expect(r.rate_plans[0].price_per_night_cents).toBe(10000);
  });

  test("a rule that has not started yet is not applied", () => {
    const [r] = withAllInPrices([room()], [{ ...perPersonPerNight, effectiveFrom: "2027-01-01" }], "2026-10-30");
    expect(r.rate_plans[0].price_per_night_cents).toBe(10000);
  });

  test("tonight's price, where tonight can be booked, replaces the base rate", () => {
    const [r] = withAllInPrices([room()], [perPersonPerNight], "2026-10-30", { p1: { priceCents: 14750, sellable: true } });
    expect(r.rate_plans[0].price_per_night_cents).toBe(14750);
    expect(r.rate_plans[0].price_from).toBeUndefined();
  });

  test("a rate that can't be booked tonight shows its base rate, as \"from\"", () => {
    const [r] = withAllInPrices([room()], [perPersonPerNight], "2026-10-30", { p1: { priceCents: 14750, sellable: false } });
    expect(r.rate_plans[0]).toMatchObject({ price_per_night_cents: 10500, price_from: true });
    const [unpriced] = withAllInPrices([room()], [perPersonPerNight], "2026-10-30");
    expect(unpriced.rate_plans[0]).toMatchObject({ price_per_night_cents: 10500, price_from: true });
  });

  test("a room without a standard occupancy is priced for one guest", () => {
    const [r] = withAllInPrices([room({ base_occupancy: undefined })], [perPersonPerNight], "2026-10-30");
    expect(r.rate_plans[0].price_per_night_cents).toBe(10250);
  });
});

describe("withCancellationTerms", () => {
  const plan = (id: string, barCents: number, is_refundable: boolean) => ({
    id,
    name: id,
    bar_cents: barCents,
    currency: "EUR",
    is_refundable,
    meal_plan: null,
    price_per_night_cents: barCents,
  });

  test("a refundable rate carries the property's tier", () => {
    const [r] = withCancellationTerms([room({ rate_plans: [plan("flex", 10000, true)] })], "flex");
    expect(r.rate_plans[0].cancellation_tier).toBe("flex");
  });

  test("a non-refundable rate at least 10% cheaper is shown, with what it saves", () => {
    const [r] = withCancellationTerms(
      [room({ rate_plans: [plan("refundable", 10000, true), plan("saver", 9000, false)] })],
      "standard",
    );
    const saver = r.rate_plans.find((p) => p.id === "saver");
    expect(saver?.cancellation_tier).toBe("non_refundable");
    expect(saver?.saving_vs_refundable_cents).toBe(1000);
  });

  test("a non-refundable rate less than 10% cheaper is hidden", () => {
    const [r] = withCancellationTerms(
      [room({ rate_plans: [plan("refundable", 10000, true), plan("saver", 9500, false)] })],
      "standard",
    );
    expect(r.rate_plans.map((p) => p.id)).toEqual(["refundable"]);
  });

  test("a non-refundable rate with no refundable rate beside it is hidden", () => {
    const [r] = withCancellationTerms([room({ rate_plans: [plan("saver", 9000, false)] })], "flex");
    expect(r.rate_plans).toEqual([]);
  });
});

describe("a rate a connected app prices", () => {
  const managedRoom = (plans: Partial<DbRoom["rate_plans"][number]>[]) =>
    room({
      rate_plans: plans.map((p, i) => ({
        id: `p${i + 1}`,
        name: `Rate ${i + 1}`,
        bar_cents: 10000,
        currency: "EUR",
        is_refundable: true,
        meal_plan: null,
        ...p,
      })),
    });

  test("bookable tonight: the app's price", () => {
    const [r] = withAllInPrices([managedRoom([{}])], [perPersonPerNight], "2026-10-30", {
      p1: { priceCents: 18650, sellable: true, managed: true },
    });
    expect(r.rate_plans[0]).toEqual({
      id: "p1",
      name: "Rate 1",
      currency: "EUR",
      is_refundable: true,
      meal_plan: null,
      managed: true,
      price_per_night_cents: 18650,
    });
  });

  test("not bookable tonight: the app's price as \"from\", never the base rate", () => {
    const [r] = withAllInPrices([managedRoom([{}])], [perPersonPerNight], "2026-10-30", {
      p1: { priceCents: 18650, sellable: false, managed: true },
    });
    expect(r.rate_plans[0]).toMatchObject({ price_per_night_cents: 18650, price_from: true });
    expect(r.rate_plans[0].bar_cents).toBeUndefined();
  });

  test("no app price tonight: no price", () => {
    const [r] = withAllInPrices([managedRoom([{}])], [perPersonPerNight], "2026-10-30", {
      p1: { priceCents: null, sellable: false, managed: true },
    });
    expect(r.rate_plans[0].price_per_night_cents).toBeNull();
    expect(r.rate_plans[0].price_from).toBeUndefined();
    expect(r.rate_plans[0].bar_cents).toBeUndefined();
  });

  test("tonight's prices failed: the page data's flag still keeps the base rate off", () => {
    const [r] = withAllInPrices([managedRoom([{ managed: true }])], [perPersonPerNight], "2026-10-30", {});
    expect(r.rate_plans[0].price_per_night_cents).toBeNull();
    expect(r.rate_plans[0].bar_cents).toBeUndefined();
  });

  test("tonight's prices are live: a plan no longer managed gets its base rate back", () => {
    const [r] = withAllInPrices([managedRoom([{ managed: true }])], [perPersonPerNight], "2026-10-30", {
      p1: { priceCents: 14750, sellable: false },
    });
    expect(r.rate_plans[0]).toMatchObject({ price_per_night_cents: 10500, price_from: true, bar_cents: 10000 });
  });

  test("a Non-refundable rate is kept beside a refundable one whatever the base rates; the saving is on tonight's prices", () => {
    const rooms = withAllInPrices(
      [managedRoom([{ bar_cents: 10000 }, { is_refundable: false, bar_cents: 9900 }])],
      [],
      "2026-10-30",
      {
        p1: { priceCents: 20000, sellable: true, managed: true },
        p2: { priceCents: 17000, sellable: true, managed: true },
      },
    );
    const [r] = withCancellationTerms(rooms, "standard");
    expect(r.rate_plans.map((p) => [p.id, p.cancellation_tier, p.saving_vs_refundable_cents])).toEqual([
      ["p1", "standard", undefined],
      ["p2", "non_refundable", 3000],
    ]);
  });

  test("no saving where either rate has no price tonight", () => {
    const rooms = withAllInPrices(
      [managedRoom([{}, { is_refundable: false }])],
      [],
      "2026-10-30",
      {
        p1: { priceCents: null, sellable: false, managed: true },
        p2: { priceCents: 17000, sellable: true, managed: true },
      },
    );
    const [r] = withCancellationTerms(rooms, "standard");
    expect(r.rate_plans.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(r.rate_plans[1].saving_vs_refundable_cents).toBeUndefined();
  });

  test("a Non-refundable rate with no refundable rate beside it is still hidden", () => {
    const rooms = withAllInPrices([managedRoom([{ is_refundable: false }])], [], "2026-10-30", {
      p1: { priceCents: 17000, sellable: true, managed: true },
    });
    expect(withCancellationTerms(rooms, "standard")[0].rate_plans).toEqual([]);
  });
});

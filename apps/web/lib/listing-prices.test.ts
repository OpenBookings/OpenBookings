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
    { id: "p1", name: "Room only", bar: 100, currency: "EUR", is_refundable: true, meal_plan: null },
  ],
  ...extra,
});

const perPersonPerNight: TouristTaxRule = {
  effectiveFrom: "2026-01-01",
  charges: [{ kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false }],
  childrenExempt: false,
  maxNights: null,
};

describe("withAllInPrices", () => {
  test("a night's price includes tourist tax for the room's standard number of guests", () => {
    const [r] = withAllInPrices([room()], [perPersonPerNight], "2026-10-30");
    expect(r.rate_plans[0].price_per_night).toBe(105);
  });

  test("without rules it is the host's rate", () => {
    const [r] = withAllInPrices([room()], [], "2026-10-30");
    expect(r.rate_plans[0].price_per_night).toBe(100);
  });

  test("a rule that has not started yet is not applied", () => {
    const [r] = withAllInPrices([room()], [{ ...perPersonPerNight, effectiveFrom: "2027-01-01" }], "2026-10-30");
    expect(r.rate_plans[0].price_per_night).toBe(100);
  });

  test("a room without a standard occupancy is priced for one guest", () => {
    const [r] = withAllInPrices([room({ base_occupancy: undefined })], [perPersonPerNight], "2026-10-30");
    expect(r.rate_plans[0].price_per_night).toBe(102.5);
  });
});

describe("withCancellationTerms", () => {
  const plan = (id: string, bar: number, is_refundable: boolean) => ({
    id,
    name: id,
    bar,
    currency: "EUR",
    is_refundable,
    meal_plan: null,
    price_per_night: bar,
  });

  test("a refundable rate carries the property's tier", () => {
    const [r] = withCancellationTerms([room({ rate_plans: [plan("flex", 100, true)] })], "flex");
    expect(r.rate_plans[0].cancellation_tier).toBe("flex");
  });

  test("a non-refundable rate at least 10% cheaper is shown, with what it saves", () => {
    const [r] = withCancellationTerms(
      [room({ rate_plans: [plan("refundable", 100, true), plan("saver", 90, false)] })],
      "standard",
    );
    const saver = r.rate_plans.find((p) => p.id === "saver");
    expect(saver?.cancellation_tier).toBe("non_refundable");
    expect(saver?.saving_vs_refundable).toBe(10);
  });

  test("a non-refundable rate less than 10% cheaper is hidden", () => {
    const [r] = withCancellationTerms(
      [room({ rate_plans: [plan("refundable", 100, true), plan("saver", 95, false)] })],
      "standard",
    );
    expect(r.rate_plans.map((p) => p.id)).toEqual(["refundable"]);
  });

  test("a non-refundable rate with no refundable rate beside it is hidden", () => {
    const [r] = withCancellationTerms([room({ rate_plans: [plan("saver", 90, false)] })], "flex");
    expect(r.rate_plans).toEqual([]);
  });
});

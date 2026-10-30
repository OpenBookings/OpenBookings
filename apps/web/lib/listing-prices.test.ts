import { describe, expect, test } from "bun:test";
import type { TouristTaxRule } from "@openbookings/pricing";
import type { DbRoom } from "@/app/p/[hotel_slug]/_components/constants";
import { withAllInPrices } from "./listing-prices";

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
    { id: "p1", name: "Room only", bar: 100, currency: "EUR", is_refundable: true, cancellation_policy: null, meal_plan: null },
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

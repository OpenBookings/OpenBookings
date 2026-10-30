import { describe, expect, test } from "bun:test";
import type { TouristTaxRule } from "@openbookings/pricing";
import { addDays, exampleStay, groupRules } from "./tourist-tax-view";

const rule = (effectiveFrom: string, charges: TouristTaxRule["charges"] = []): TouristTaxRule & { id: string } => ({
  id: effectiveFrom,
  effectiveFrom,
  charges,
  childrenExempt: false,
  maxNights: null,
});

describe("addDays", () => {
  test("crosses month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("groupRules", () => {
  const rules = [rule("2025-01-01"), rule("2026-01-01"), rule("2026-10-30"), rule("2027-01-01")];

  test("the latest rule that has started is current, later ones upcoming, earlier ones previous", () => {
    const groups = groupRules(rules, "2026-10-30");
    expect(groups.current?.effectiveFrom).toBe("2026-10-30");
    expect(groups.upcoming.map((r) => r.effectiveFrom)).toEqual(["2027-01-01"]);
    // Newest first: the one that just ended is the one a host looks for.
    expect(groups.previous.map((r) => r.effectiveFrom)).toEqual(["2026-01-01", "2025-01-01"]);
  });

  test("with only future rules nothing is current yet", () => {
    const groups = groupRules([rule("2027-01-01")], "2026-10-30");
    expect(groups.current).toBeNull();
    expect(groups.upcoming).toHaveLength(1);
  });
});

describe("exampleStay", () => {
  const perPersonPerNight = rule("2026-01-01", [
    { kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false },
  ]);

  test("adds tourist tax on top and takes commission on the room price only", () => {
    const result = exampleStay({
      rules: [perPersonPerNight],
      commissionRate: 0.045,
      arrival: "2026-11-01",
      nights: 2,
      pricePerNight: 100,
      adults: 2,
      children: 0,
      rooms: 1,
    });
    expect(result).toMatchObject({
      stay: 200,
      touristTax: { total: 10 },
      guestTotal: 210,
      commission: 9,
      hostReceives: 201,
    });
  });

  test("the room price is per room, so more rooms raise the stay", () => {
    const result = exampleStay({
      rules: [],
      commissionRate: 0.045,
      arrival: "2026-11-01",
      nights: 1,
      pricePerNight: 100,
      adults: 4,
      children: 0,
      rooms: 2,
    });
    expect(result.stay).toBe(200);
  });

  test("an empty or impossible stay comes back as zeros rather than throwing", () => {
    const result = exampleStay({
      rules: [perPersonPerNight],
      commissionRate: 0.045,
      arrival: "",
      nights: 0,
      pricePerNight: Number.NaN,
      adults: 2,
      children: 0,
      rooms: 1,
    });
    expect(result).toMatchObject({ stay: 0, guestTotal: 0, commission: 0, hostReceives: 0 });
  });
});

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
    { kind: "fixed", amountCents: 250, perPerson: true, perNight: true, perRoom: false },
  ]);

  test("adds tourist tax on top and takes commission on the room price only", () => {
    const result = exampleStay({
      rules: [perPersonPerNight],
      commissionRate: 0.045,
      arrival: "2026-11-01",
      nights: 2,
      pricePerNightCents: 10000,
      adults: 2,
      children: 0,
      rooms: 1,
    });
    expect(result).toMatchObject({
      stayCents: 20000,
      touristTax: { totalCents: 1000 },
      guestTotalCents: 21000,
      commissionCents: 900,
      hostReceivesCents: 20100,
    });
  });

  test("infants pay tourist tax only where the rule says so", () => {
    const stay = (r: TouristTaxRule) =>
      exampleStay({
        rules: [r],
        commissionRate: 0.045,
        arrival: "2026-11-01",
        nights: 2,
        pricePerNightCents: 10000,
        adults: 2,
        children: 0,
        infants: 1,
        rooms: 1,
      }).touristTax.totalCents;
    expect(stay(perPersonPerNight)).toBe(1000);
    expect(stay({ ...perPersonPerNight, infantsTaxed: true })).toBe(1500);
  });

  test("the room price is per room, so more rooms raise the stay", () => {
    const result = exampleStay({
      rules: [],
      commissionRate: 0.045,
      arrival: "2026-11-01",
      nights: 1,
      pricePerNightCents: 10000,
      adults: 4,
      children: 0,
      rooms: 2,
    });
    expect(result.stayCents).toBe(20000);
  });

  test("a price with cents is priced to the cent: 6.5% on €93.25 a night", () => {
    const percent = rule("2026-01-01", [
      { kind: "percent", percent: 6.5, perPerson: false, perNight: false, perRoom: false, vatIncludedPercent: null },
    ]);
    const result = exampleStay({
      rules: [percent],
      commissionRate: 0.045,
      arrival: "2026-11-01",
      nights: 2,
      pricePerNightCents: 9325,
      adults: 2,
      children: 0,
      rooms: 1,
    });
    // 6.5% of 9325 is 606.125 → 606 a night.
    expect(result).toMatchObject({ stayCents: 18650, touristTax: { totalCents: 1212 }, guestTotalCents: 19862 });
  });

  test("an empty or impossible stay comes back as zeros rather than throwing", () => {
    const result = exampleStay({
      rules: [perPersonPerNight],
      commissionRate: 0.045,
      arrival: "",
      nights: 0,
      pricePerNightCents: Number.NaN,
      adults: 2,
      children: 0,
      rooms: 1,
    });
    expect(result).toMatchObject({ stayCents: 0, guestTotalCents: 0, commissionCents: 0, hostReceivesCents: 0 });
  });
});

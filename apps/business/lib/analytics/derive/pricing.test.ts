import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, inventory, ok } from "../test-fixtures";
import { derivePricing } from "./pricing";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };

describe("derivePricing", () => {
  test("discounts: euros given, share of bookings, and depth among discounted bookings", () => {
    const f = facts([
      booking({ nights: 1, nightlyNetCents: [9_000], discountCents: 1_000 }),
      booking({ nights: 1, nightlyNetCents: [10_000] }),
      booking({ nights: 1, nightlyNetCents: [16_000], discountCents: 4_000 }),
      booking({ nights: 1, nightlyNetCents: [10_000], discountCents: 9_999, status: "cancelled", cancelledAt: "2026-09-02T10:00:00.000Z" }),
    ]);
    const view = derivePricing(ctx(f, SEPT));
    expect(ok(view.discounts).value).toBe(5_000);
    expect(ok(view.discounts).shareOfBookingsPct).toBeCloseTo(66.67, 1);
    // 5,000 given on 30,000 of rack rate.
    expect(ok(view.discountDepth).value).toBeCloseTo(16.67, 1);
  });

  test("no discounted bookings: zero given and no depth to report", () => {
    const view = derivePricing(ctx(facts([booking()]), SEPT));
    expect(ok(view.discounts).value).toBe(0);
    expect(ok(view.discounts).shareOfBookingsPct).toBe(0);
    expect(ok(view.discountDepth).value).toBeNull();
  });

  test("ADR and its trend are by stay date, and an empty bucket is a gap", () => {
    const f = facts([
      booking({ createdAt: "2026-08-01T10:00:00.000Z", checkIn: "2026-09-02", nights: 2, nightlyNetCents: [10_000, 14_000] }),
    ]);
    const view = derivePricing(ctx(f, { from: "2026-09-01", to: "2026-09-04" }));
    expect(ok(view.adr).value).toBe(12_000);
    expect(view.adr).toMatchObject({ basis: "stay", sample: 2 });
    expect(ok(view.adrOverTime).map((p) => p.value)).toEqual([null, 10_000, 14_000, null]);
  });

  test("the rate plan table is by booking date and sums to the revenue", () => {
    const f = facts([
      booking({ ratePlanId: "flex", nights: 2 }),
      booking({ ratePlanId: "flex", nights: 1, nightlyNetCents: [13_000] }),
      booking({ ratePlanId: "saver", nights: 4, nightlyNetCents: [8_000, 8_000, 8_000, 8_000] }),
      booking({ ratePlanId: "saver", status: "cancelled", cancelledAt: "2026-09-02T10:00:00.000Z" }),
    ]);
    expect(ok(derivePricing(ctx(f, SEPT)).byRatePlan)).toEqual([
      { key: "flex", label: "Flexible", bookings: 2, nights: 3, adrCents: 11_000, revenueCents: 33_000 },
      { key: "saver", label: "Saver", bookings: 1, nights: 4, adrCents: 8_000, revenueCents: 32_000 },
    ]);
  });

  test("a weekday that sells out below the average rate gets the hint", () => {
    const night = (checkIn: string, cents: number) => booking({ checkIn, nights: 1, nightlyNetCents: [cents] });
    const f = facts(
      [
        // Every Friday in September 2026, cheaply.
        night("2026-09-04", 8_000), night("2026-09-11", 8_000), night("2026-09-18", 8_000), night("2026-09-25", 8_000),
        // Two of four Mondays, at a high rate.
        night("2026-09-07", 15_000), night("2026-09-14", 15_000),
      ],
      inventory("2026-09-01", "2026-09-30", { standard: 1 }),
    );
    const rows = ok(derivePricing(ctx(f, SEPT)).byWeekday);
    expect(rows.find((r) => r.label === "Friday")).toEqual({
      weekday: 5, label: "Friday", occupancyPct: 100, adrCents: 8_000, hint: true,
    });
    expect(rows.find((r) => r.label === "Monday")).toMatchObject({ occupancyPct: 50, adrCents: 15_000, hint: false });
    expect(rows.find((r) => r.label === "Tuesday")).toMatchObject({ occupancyPct: 0, adrCents: null, hint: false });
  });

  test("the weekday table needs five nights sold", () => {
    const view = derivePricing(ctx(facts([booking({ nights: 2 })]), SEPT));
    expect(view.byWeekday).toEqual({ ok: false, reason: "below-minimum", basis: "stay", needed: 5, have: 2 });
  });
});

import { describe, expect, test } from "bun:test";
import { booking, ctx, facts, ok } from "../test-fixtures";
import { deriveBookingPatterns } from "./booking-patterns";

const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const made = (day: string) => `2026-09-${day}T10:00:00.000Z`;

/** Six September bookings: leads 0, 2, 9, 9, 40, 70 days; one of them cancelled. */
const six = () => [
  booking({ createdAt: made("10"), checkIn: "2026-09-10", nights: 1 }),
  booking({ createdAt: made("08"), checkIn: "2026-09-10", nights: 2 }),
  booking({ createdAt: made("01"), checkIn: "2026-09-10", nights: 2 }),
  booking({ createdAt: made("01"), checkIn: "2026-09-10", nights: 3, ratePlanId: "saver" }),
  booking({ createdAt: made("01"), checkIn: "2026-10-11", nights: 5, ratePlanId: "saver" }),
  booking({
    createdAt: made("01"), checkIn: "2026-11-10", nights: 8, ratePlanId: "saver",
    status: "cancelled", cancelledAt: "2026-09-20T12:00:00.000Z", cancellationFeeCents: 12_345,
  }),
];

describe("deriveBookingPatterns", () => {
  test("stats: count, medians and cancellation rate", () => {
    const view = deriveBookingPatterns(ctx(facts(six()), SEPT));
    expect(ok(view.bookings).value).toBe(6);
    expect(ok(view.medianLeadDays).value).toBe(9);
    // Cancelled stays never happened, so they do not lengthen the median: 1, 2, 2, 3, 5.
    expect(ok(view.medianStayNights).value).toBe(2);
    expect(ok(view.cancellationRate).value).toBeCloseTo(16.67, 1);
  });

  test("a rising cancellation rate is neutral, not green", () => {
    const f = facts([
      ...six(),
      booking({ createdAt: "2026-08-10T10:00:00.000Z" }),
      booking({ createdAt: "2026-08-11T10:00:00.000Z" }),
      booking({ createdAt: "2026-08-12T10:00:00.000Z", status: "cancelled", cancelledAt: "2026-08-13T10:00:00.000Z" }),
      ...Array.from({ length: 9 }, () => booking({ createdAt: "2026-08-14T10:00:00.000Z" })),
    ]);
    expect(ok(deriveBookingPatterns(ctx(f, SEPT)).cancellationRate).delta).toMatchObject({
      direction: "up", tone: "neutral",
    });
  });

  test("lead time uses the spec's seven buckets and counts every booking", () => {
    const bars = ok(deriveBookingPatterns(ctx(facts(six()), SEPT)).leadTime);
    expect(bars.map((b) => b.label)).toEqual([
      "Same day", "1–3 days", "4–7 days", "8–14 days", "15–30 days", "31–60 days", "61+ days",
    ]);
    expect(bars.map((b) => b.value)).toEqual([1, 1, 0, 2, 0, 1, 1]);
  });

  test("stay length uses five buckets and counts kept bookings", () => {
    const bars = ok(deriveBookingPatterns(ctx(facts(six()), SEPT)).stayLength);
    expect(bars.map((b) => b.label)).toEqual(["1 night", "2 nights", "3 nights", "4–6 nights", "7+ nights"]);
    expect(bars.map((b) => b.value)).toEqual([1, 2, 1, 1, 0]);
  });

  test("distributions decline below five bookings", () => {
    const view = deriveBookingPatterns(ctx(facts(six().slice(0, 3)), SEPT));
    expect(view.leadTime).toEqual({ ok: false, reason: "below-minimum", basis: "booking", needed: 5, have: 3 });
    expect(view.byRatePlan).toMatchObject({ ok: false, reason: "below-minimum" });
    expect(ok(view.bookings).value).toBe(3);
  });

  test("cancellations are bucketed by days before check-in, on the lead-time buckets", () => {
    const cancelledOn = (date: string, checkIn: string) =>
      booking({ createdAt: made("01"), checkIn, status: "cancelled", cancelledAt: `${date}T12:00:00.000Z` });
    const f = facts([
      cancelledOn("2026-09-10", "2026-09-10"),
      cancelledOn("2026-09-08", "2026-09-10"),
      cancelledOn("2026-09-05", "2026-09-25"),
      cancelledOn("2026-09-05", "2026-09-25"),
      cancelledOn("2026-09-02", "2026-12-01"),
    ]);
    const bars = ok(deriveBookingPatterns(ctx(f, SEPT)).cancellationsByDaysBefore);
    expect(bars.map((b) => b.value)).toEqual([1, 1, 0, 0, 2, 0, 1]);
  });

  test("the rate plan table carries the rate and the fees retained", () => {
    const rows = ok(deriveBookingPatterns(ctx(facts(six()), SEPT)).byRatePlan);
    expect(rows).toEqual([
      { key: "flex", label: "Flexible", bookings: 3, cancelled: 0, ratePct: 0, feesRetainedCents: 0 },
      { key: "saver", label: "Saver", bookings: 3, cancelled: 1, ratePct: (1 / 3) * 100, feesRetainedCents: 12_345 },
    ]);
  });
});

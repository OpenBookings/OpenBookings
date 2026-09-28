import { describe, expect, test } from "bun:test";
import type { BookingFact, Category, Facts, NightFact, UpcomingWindow } from "../types";
import { deriveBookings } from "./bookings";

const booking = (over: Partial<BookingFact>): BookingFact => ({
  id: "b1", propertyId: "p1", createdAt: "2026-09-10T12:00:00.000Z",
  checkIn: "2026-09-20", checkOut: "2026-09-22", nights: 2,
  status: "confirmed", cancelledAt: null, adults: 2, children: 0,
  guestKey: "g1", guestCountry: "NL", netRevenueCents: 30_000,
  roomId: "standard", ratePlanId: "flex", ...over,
});

const night = (over: Partial<NightFact>): NightFact => ({
  date: "2026-09-10", propertyId: "p1", roomId: "standard", ratePlanId: "flex",
  unitsAvailable: 10, unitsSold: 5, netRevenueCents: 50_000,
  basePriceCents: 55_000, modifiers: [], ...over,
});

const facts = (bookings: BookingFact[], nights: NightFact[] = []): Facts => ({
  nights, bookings, roomTypeNames: {}, ratePlanNames: {},
});

const SEPT = { preset: "custom", from: "2026-09-01", to: "2026-09-30" } as const;
const TODAY = "2026-09-15";

const value = <T,>(w: { ok: boolean } & Record<string, unknown>): T => {
  expect(w.ok).toBe(true);
  return (w as unknown as { value: T }).value;
};

describe("deriveBookings", () => {
  test("counts bookings created in the period, cancelled ones included", () => {
    const section = deriveBookings(
      facts([
        booking({ id: "a", createdAt: "2026-08-31T23:00:00.000Z" }),
        booking({ id: "b", createdAt: "2026-09-01T00:00:00.000Z" }),
        booking({ id: "c", createdAt: "2026-09-30T23:59:00.000Z", status: "cancelled", cancelledAt: "2026-09-30T23:59:00.000Z" }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number }>(section.count).value).toBe(2);
  });

  /**
   * The Bookings section deliberately counts a population Revenue does not. A
   * cancelled booking is a booking that happened and then unhappened; it belongs
   * in the count and in the cancellation rate, and nowhere else.
   */
  test("a cancelled booking contributes to the count and to cancellations, and to nothing else", () => {
    const section = deriveBookings(
      facts([
        booking({ id: "a", nights: 2, adults: 2 }),
        booking({ id: "b", nights: 10, adults: 2, status: "cancelled", cancelledAt: "2026-09-11T00:00:00.000Z" }),
      ]),
      SEPT,
      TODAY,
    );
    expect(value<{ value: number }>(section.count).value).toBe(2);
    expect(value<{ count: number; value: number }>(section.cancellations)).toMatchObject({
      count: 1,
      value: 50,
    });
    // Length of stay averages the two nights that actually happened, not six.
    expect(value<number>(section.averageLengthOfStay)).toBe(2);
  });

  test("average length of stay is null when nothing stayed", () => {
    const section = deriveBookings(facts([]), SEPT, TODAY);
    expect(value<number | null>(section.averageLengthOfStay)).toBeNull();
  });

  test("the cancellation delta inverts, so rising is bad", () => {
    const section = deriveBookings(facts([booking({})]), SEPT, TODAY);
    expect(value<{ delta: { goodDirection: string } }>(section.cancellations).delta.goodDirection).toBe("down");
  });

  test("lead time buckets on the boundaries the spec names", () => {
    const at = (days: number, id: string) =>
      booking({ id, checkIn: "2026-09-20", createdAt: `${addDaysLocal("2026-09-20", -days)}T12:00:00.000Z` });
    const section = deriveBookings(
      facts([at(0, "a"), at(1, "b"), at(2, "c"), at(7, "d"), at(8, "e"), at(30, "f"), at(31, "g"), at(90, "h"), at(91, "i")]),
      { preset: "custom", from: "2026-06-01", to: "2026-09-30" },
      TODAY,
    );
    const rows = value<Category[]>(section.leadTime);
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ["0-1", 2], ["2-7", 2], ["8-30", 2], ["31-90", 2], ["90+", 1],
    ]);
  });

  test("lead time never goes negative when a booking is made after check-in", () => {
    const section = deriveBookings(
      facts([booking({ checkIn: "2026-09-05", createdAt: "2026-09-10T12:00:00.000Z" })]),
      SEPT,
      TODAY,
    );
    const rows = value<Category[]>(section.leadTime);
    expect(rows.find((r) => r.key === "0-1")!.value).toBe(1);
  });

  test("upcoming windows run from today and ignore the period selector", () => {
    const nights = [
      night({ date: "2026-09-20", unitsSold: 4, unitsAvailable: 10 }),
      night({ date: "2026-10-20", unitsSold: 2, unitsAvailable: 10 }),
      night({ date: "2026-12-20", unitsSold: 9, unitsAvailable: 10 }),
    ];
    const section = deriveBookings(facts([], nights), SEPT, TODAY);
    const windows = value<UpcomingWindow[]>(section.upcoming);
    expect(windows.map((w) => w.window)).toEqual([30, 60, 90]);
    // 20 Sept is within 30 days of 15 Sept; 20 Oct is within 60; 20 Dec is beyond 90.
    expect(windows[0]).toMatchObject({ nightsSold: 4, nightsAvailable: 6 });
    expect(windows[1].nightsSold).toBe(6);
    expect(windows[2].nightsSold).toBe(6);
  });

  test("upcoming reports rooms still available, not total inventory", () => {
    const section = deriveBookings(
      facts([], [night({ date: "2026-09-20", unitsSold: 4, unitsAvailable: 10 })]),
      SEPT,
      TODAY,
    );
    const first = value<UpcomingWindow[]>(section.upcoming)[0];
    expect(first.nightsSold + first.nightsAvailable).toBe(10);
  });
});

function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

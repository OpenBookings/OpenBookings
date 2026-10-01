import { describe, expect, test } from "bun:test";
import { bookingDate, earliestFactDate } from "../metrics";
import { addDays } from "../period";
import { buildDemoFacts } from "./generate";

const TODAY = "2026-10-01";
const facts = buildDemoFacts(TODAY);

describe("demo facts", () => {
  test("the same day always produces the same facts", () => {
    expect(buildDemoFacts(TODAY)).toEqual(facts);
  });

  test("history does not change when today moves: only newer bookings appear", () => {
    const earlier = buildDemoFacts("2026-07-01");
    const later = new Map(facts.bookings.map((b) => [b.id, b]));
    for (const b of earlier.bookings) {
      const same = later.get(b.id);
      expect(same).toBeDefined();
      expect(same!.createdAt).toBe(b.createdAt);
      expect(same!.checkIn).toBe(b.checkIn);
      expect(same!.netRevenueCents).toBe(b.netRevenueCents);
    }
    const expected = facts.bookings.filter((b) => bookingDate(b) <= "2026-07-01").length;
    expect(earlier.bookings).toHaveLength(expected);
  });

  test("no booking is made in the future, and some stays are still to come", () => {
    expect(facts.bookings.every((b) => bookingDate(b) <= TODAY)).toBe(true);
    expect(facts.bookings.some((b) => b.checkIn > TODAY)).toBe(true);
  });

  test("every booking's money adds up", () => {
    for (const b of facts.bookings) {
      expect(b.nightlyNetCents).toHaveLength(b.nights);
      expect(b.nightlyNetCents.reduce((t, c) => t + c, 0)).toBe(b.netRevenueCents);
      expect(b.basePriceCents - b.discountCents).toBe(b.netRevenueCents);
      expect(b.discountCents).toBeGreaterThanOrEqual(0);
      expect(b.checkOut).toBe(addDays(b.checkIn, b.nights));
    }
  });

  test("a room type is never sold beyond the units in service", () => {
    const capacity = new Map(
      facts.inventory.map((i) => [`${i.roomId}:${i.date}`, i.unitsTotal - i.unitsOutOfOrder]),
    );
    const sold = new Map<string, number>();
    for (const n of facts.nights) {
      const key = `${n.roomId}:${n.date}`;
      sold.set(key, (sold.get(key) ?? 0) + 1);
    }
    for (const [key, count] of sold) {
      expect(capacity.has(key)).toBe(true);
      expect(count).toBeLessThanOrEqual(capacity.get(key)!);
    }
  });

  test("there is enough of everything to fill the pages", () => {
    const cancelled = facts.bookings.filter((b) => b.status === "cancelled");
    expect(facts.bookings.length).toBeGreaterThan(1500);
    expect(cancelled.length / facts.bookings.length).toBeGreaterThan(0.03);
    expect(cancelled.length / facts.bookings.length).toBeLessThan(0.2);
    expect(cancelled.every((b) => b.cancelledAt !== null && b.cancelledAt.slice(0, 10) <= TODAY)).toBe(true);
    expect(facts.bookings.some((b) => b.discountCents > 0)).toBe(true);
    expect(cancelled.some((b) => b.cancellationFeeCents > 0)).toBe(true);
    expect(new Set(facts.bookings.map((b) => b.guestCountry)).size).toBeGreaterThan(8);
  });

  test("history reaches back far enough for a year-over-year comparison", () => {
    expect(earliestFactDate(facts)! <= "2024-10-01").toBe(true);
  });

  test("a guest always books from the same country", () => {
    const country = new Map<string, string>();
    for (const b of facts.bookings) {
      expect(country.get(b.guestKey) ?? b.guestCountry).toBe(b.guestCountry);
      country.set(b.guestKey, b.guestCountry);
    }
  });
});

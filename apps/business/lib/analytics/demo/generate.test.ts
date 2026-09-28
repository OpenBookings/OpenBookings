import { describe, expect, test } from "bun:test";
import { weekdayOf } from "../period";
import { DEMO_PROPERTIES, findDemoProperty } from "./properties";
import { generateFacts } from "./generate";

const TODAY = "2026-09-25";
const ZEEBURG = findDemoProperty("demo-zeeburg");
const VLIERHOF = findDemoProperty("demo-vlierhof");
const NIEUWEHAVEN = findDemoProperty("demo-nieuwehaven");

const YEAR = { from: "2025-09-26", to: "2026-09-25" };

describe("generateFacts", () => {
  test("is deterministic across calls", () => {
    const a = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const b = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    expect(a).toEqual(b);
  });

  test("covers every date in the range, for every rate plan", () => {
    const facts = generateFacts(ZEEBURG, "2026-09-01", "2026-09-30", TODAY);
    expect(facts.nights).toHaveLength(30 * ZEEBURG.ratePlans.length);
    expect(new Set(facts.nights.map((n) => n.date)).size).toBe(30);
  });

  test("every cents field is a whole number", () => {
    const facts = generateFacts(ZEEBURG, "2026-07-01", "2026-07-31", TODAY);
    for (const night of facts.nights) {
      expect(Number.isInteger(night.netRevenueCents)).toBe(true);
      expect(Number.isInteger(night.basePriceCents)).toBe(true);
      for (const m of night.modifiers) expect(Number.isInteger(m.impactCents)).toBe(true);
    }
    for (const booking of facts.bookings) {
      expect(Number.isInteger(booking.netRevenueCents)).toBe(true);
    }
  });

  test("never sells more units than are available", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    for (const night of facts.nights) {
      expect(night.unitsSold).toBeLessThanOrEqual(night.unitsAvailable);
      expect(night.unitsSold).toBeGreaterThanOrEqual(0);
    }
  });

  test("a night with no units sold earns nothing", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    for (const night of facts.nights.filter((n) => n.unitsSold === 0)) {
      expect(night.netRevenueCents).toBe(0);
      expect(night.basePriceCents).toBe(0);
    }
  });

  test("weekends outsell midweek", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const rate = (days: number[]) => {
      const nights = facts.nights.filter((n) => days.includes(weekdayOf(n.date)));
      const sold = nights.reduce((sum, n) => sum + n.unitsSold, 0);
      const available = nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
      return sold / available;
    };
    expect(rate([5, 6])).toBeGreaterThan(rate([1, 2, 3]));
  });

  test("summer outsells winter", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const rate = (months: string[]) => {
      const nights = facts.nights.filter((n) => months.includes(n.date.slice(5, 7)));
      const sold = nights.reduce((sum, n) => sum + n.unitsSold, 0);
      const available = nights.reduce((sum, n) => sum + n.unitsAvailable, 0);
      return sold / available;
    };
    expect(rate(["07", "08"])).toBeGreaterThan(rate(["01", "02"]));
  });

  test("a brand new property has no nights sold and no bookings, ever", () => {
    const facts = generateFacts(NIEUWEHAVEN, YEAR.from, YEAR.to, TODAY);
    expect(facts.bookings).toEqual([]);
    expect(facts.nights.every((n) => n.unitsSold === 0)).toBe(true);
    // Inventory still exists — it is a property with rooms, not a void.
    expect(facts.nights.some((n) => n.unitsAvailable > 0)).toBe(true);
  });

  test("the B&B trades thinly enough to fall under the five-booking threshold", () => {
    const facts = generateFacts(VLIERHOF, "2026-02-01", "2026-02-14", TODAY);
    expect(facts.bookings.length).toBeLessThan(5);
  });

  test("no booking predates the property opening", () => {
    for (const property of DEMO_PROPERTIES.filter((p) => p.openedOn)) {
      const facts = generateFacts(property, "2024-01-01", TODAY, TODAY);
      for (const booking of facts.bookings) {
        expect(booking.checkIn >= property.openedOn!).toBe(true);
      }
    }
  });

  test("bookings are created before they check in", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    for (const booking of facts.bookings) {
      expect(booking.createdAt.slice(0, 10) <= booking.checkIn).toBe(true);
    }
  });

  test("some bookings are cancelled, and a cancelled booking carries a cancelledAt", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const cancelled = facts.bookings.filter((b) => b.status === "cancelled");
    expect(cancelled.length).toBeGreaterThan(0);
    for (const booking of cancelled) expect(booking.cancelledAt).not.toBeNull();
    for (const booking of facts.bookings.filter((b) => b.status !== "cancelled")) {
      expect(booking.cancelledAt).toBeNull();
    }
  });

  test("guests are mostly NL/BE/DE with a long tail, so the Other rule can fire", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const counts = new Map<string, number>();
    for (const b of facts.bookings) counts.set(b.guestCountry, (counts.get(b.guestCountry) ?? 0) + 1);
    const core = ["NL", "BE", "DE"].reduce((sum, c) => sum + (counts.get(c) ?? 0), 0);
    expect(core / facts.bookings.length).toBeGreaterThan(0.5);
    expect([...counts.values()].filter((n) => n < 5).length).toBeGreaterThan(0);
  });

  test("some guests stay more than once, so repeat share is not always zero", () => {
    const facts = generateFacts(ZEEBURG, YEAR.from, YEAR.to, TODAY);
    const seen = new Map<string, number>();
    for (const b of facts.bookings) seen.set(b.guestKey, (seen.get(b.guestKey) ?? 0) + 1);
    expect([...seen.values()].some((n) => n > 1)).toBe(true);
  });

  test("names are exposed for room types and rate plans", () => {
    const facts = generateFacts(ZEEBURG, "2026-09-01", "2026-09-30", TODAY);
    expect(facts.roomTypeNames["zb-canal"]).toBe("Canal View Double");
    expect(facts.ratePlanNames["zb-saver"]).toBe("Non-refundable Saver");
  });
});

import { describe, expect, test } from "bun:test";
import { buildIntentLines, stayCents, toCents } from "./booking-lines";

const total = (lines: { unitAmountCents: number; quantity: number }[]) =>
  lines.reduce((sum, l) => sum + l.unitAmountCents * l.quantity, 0);

describe("buildIntentLines", () => {
  const tax = (amount: number) => ({ label: "€3.00 per person per night", amount, effectiveFrom: "2026-01-01" });
  const rooms = [
    {
      roomName: "Garden",
      roomType: "Suite",
      nights: [
        { date: "2031-11-10", price: 100 },
        { date: "2031-11-11", price: 100 },
        { date: "2031-11-12", price: 140 },
      ],
      touristTaxLines: [tax(18)],
    },
    {
      roomName: "Attic",
      roomType: null,
      nights: [
        { date: "2031-11-10", price: 90 },
        { date: "2031-11-11", price: 90 },
      ],
      touristTaxLines: [tax(6)],
    },
  ];

  test("each room is one stay line for its nights, followed by its own tourist tax", () => {
    const lines = buildIntentLines(rooms);
    expect(lines).toEqual([
      { name: "Garden Suite · 3 nights", unitAmountCents: 34000, quantity: 1, kind: "stay" },
      { name: "Tourist tax · €3.00 per person per night", unitAmountCents: 1800, quantity: 1, kind: "tourist_tax" },
      { name: "Attic · 2 nights", unitAmountCents: 18000, quantity: 1, kind: "stay" },
      { name: "Tourist tax · €3.00 per person per night", unitAmountCents: 600, quantity: 1, kind: "tourist_tax" },
    ]);
    expect(stayCents(lines)).toBe(52000);
    expect(total(lines)).toBe(54400);
  });

  test("one night reads as one night", () => {
    expect(buildIntentLines([{ ...rooms[1]!, nights: [{ date: "2031-11-10", price: 90 }] }])[0]!.name).toBe(
      "Attic · 1 night",
    );
  });

  test("sums the exact night prices before rounding to cents", () => {
    const nights = [
      { date: "2031-11-10", price: 33.333 },
      { date: "2031-11-11", price: 33.333 },
      { date: "2031-11-12", price: 33.334 },
    ];
    expect(buildIntentLines([{ ...rooms[0]!, nights, touristTaxLines: [] }])[0]!.unitAmountCents).toBe(10000);
  });
});

describe("toCents", () => {
  test("rounds to whole cents", () => {
    expect(toCents(99.995)).toBe(10000);
    expect(toCents(185)).toBe(18500);
  });
});

import { describe, expect, test } from "bun:test";
import { buildIntentLines, stayCents } from "./booking-lines";

const total = (lines: { unitAmountCents: number; quantity: number }[]) =>
  lines.reduce((sum, l) => sum + l.unitAmountCents * l.quantity, 0);

describe("buildIntentLines", () => {
  const tax = (amountCents: number) => ({ label: "€3.00 per person per night", amountCents, effectiveFrom: "2026-01-01" });
  const rooms = [
    {
      roomName: "Garden",
      roomType: "Suite",
      nights: [
        { date: "2031-11-10", priceCents: 10000 },
        { date: "2031-11-11", priceCents: 10000 },
        { date: "2031-11-12", priceCents: 14000 },
      ],
      touristTaxLines: [tax(1800)],
    },
    {
      roomName: "Attic",
      roomType: null,
      nights: [
        { date: "2031-11-10", priceCents: 9000 },
        { date: "2031-11-11", priceCents: 9000 },
      ],
      touristTaxLines: [tax(600)],
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
    expect(buildIntentLines([{ ...rooms[1]!, nights: [{ date: "2031-11-10", priceCents: 9000 }] }])[0]!.name).toBe(
      "Attic · 1 night",
    );
  });

  test("the stay line is the nights' cents added up, nothing rounded", () => {
    const nights = [
      { date: "2031-11-10", priceCents: 9325 },
      { date: "2031-11-11", priceCents: 9325 },
    ];
    const lines = buildIntentLines([{ ...rooms[0]!, nights, touristTaxLines: [tax(1212)] }]);
    expect(lines.map((l) => l.unitAmountCents)).toEqual([18650, 1212]);
    expect(total(lines)).toBe(19862);
  });
});

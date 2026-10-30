import { describe, expect, test } from "bun:test";
import { buildBookingLines, stayCents } from "./booking-lines";

const stay = { roomName: "Garden", roomType: "Suite", pricePerNight: 185, nights: 3 };
const total = (lines: { unitAmountCents: number; quantity: number }[]) =>
  lines.reduce((sum, l) => sum + l.unitAmountCents * l.quantity, 0);

describe("buildBookingLines", () => {
  test("without tourist tax the guest pays the host's price times the nights, and nothing else", () => {
    const lines = buildBookingLines(stay);
    expect(lines).toEqual([{ name: "Garden Suite", unitAmountCents: 18500, quantity: 3, kind: "stay" }]);
    expect(total(lines)).toBe(55500);
  });

  test("a room with no category is named by its name alone", () => {
    expect(buildBookingLines({ ...stay, roomType: null })[0]!.name).toBe("Garden");
  });

  test("fractional prices round to whole cents", () => {
    expect(buildBookingLines({ ...stay, pricePerNight: 99.995, nights: 1 })[0]!.unitAmountCents).toBe(10000);
  });

  test("each tourist tax charge is its own line on top of the stay", () => {
    const lines = buildBookingLines({
      ...stay,
      touristTax: [
        { label: "€2.50 per person per night", amount: 15, effectiveFrom: "2026-01-01" },
        { label: "€5.00 per booking", amount: 5, effectiveFrom: "2026-01-01" },
      ],
    });
    expect(lines.slice(1)).toEqual([
      { name: "Tourist tax · €2.50 per person per night", unitAmountCents: 1500, quantity: 1, kind: "tourist_tax" },
      { name: "Tourist tax · €5.00 per booking", unitAmountCents: 500, quantity: 1, kind: "tourist_tax" },
    ]);
    expect(total(lines)).toBe(57500);
  });
});

describe("stayCents", () => {
  test("is the room lines only, so commission never touches tourist tax", () => {
    const lines = buildBookingLines({
      ...stay,
      touristTax: [{ label: "€2.50 per person per night", amount: 15, effectiveFrom: "2026-01-01" }],
    });
    expect(stayCents(lines)).toBe(55500);
  });
});

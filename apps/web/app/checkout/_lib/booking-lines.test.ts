import { describe, expect, test } from "bun:test";
import { buildBookingLines } from "./booking-lines";

const stay = { roomName: "Garden", roomType: "Suite", pricePerNight: 185, nights: 3 };
const total = (lines: { unitAmountCents: number; quantity: number }[]) =>
  lines.reduce((sum, l) => sum + l.unitAmountCents * l.quantity, 0);

describe("buildBookingLines", () => {
  test("the guest pays the host's price times the nights, and nothing else", () => {
    const lines = buildBookingLines(stay);
    expect(lines).toEqual([{ name: "Garden Suite", unitAmountCents: 18500, quantity: 3 }]);
    expect(total(lines)).toBe(55500);
  });

  test("a room with no category is named by its name alone", () => {
    expect(buildBookingLines({ ...stay, roomType: null })[0]!.name).toBe("Garden");
  });

  test("fractional prices round to whole cents", () => {
    expect(buildBookingLines({ ...stay, pricePerNight: 99.995, nights: 1 })[0]!.unitAmountCents).toBe(10000);
  });
});

import { describe, expect, test } from "bun:test";
import { bookingReference, parseBookingReference } from "./booking-reference";

const ID = "b7b02a1c-52c4-465a-9289-2a58b24aa67d";

describe("bookingReference", () => {
  test("is OB plus the first 8 characters in two groups", () => {
    expect(bookingReference(ID)).toBe("OB-B7B0-2A1C");
  });
});

describe("parseBookingReference", () => {
  test("reads the reference however it is typed", () => {
    for (const typed of ["OB-B7B0-2A1C", "ob-b7b0-2a1c", " OB B7B0 2A1C ", "OBB7B02A1C", "B7B02A1C", "#b7b02a1c", "B7B0-2A1C"]) {
      expect(parseBookingReference(typed)).toBe("b7b02a1c");
    }
  });

  test("round-trips", () => {
    expect(parseBookingReference(bookingReference(ID))).toBe("b7b02a1c");
  });

  test("treats O, I and L as the 0 and 1 they were misread from", () => {
    expect(parseBookingReference("OB-OA1B-2C3D")).toBe("0a1b2c3d");
    expect(parseBookingReference("OB-IA1B-2C3L")).toBe("1a1b2c31");
  });

  test("keeps a full UUID whole", () => {
    expect(parseBookingReference(ID.toUpperCase())).toBe(ID);
    expect(parseBookingReference(ID.replace(/-/g, ""))).toBe(ID);
  });

  test("refuses anything that can't be a booking reference", () => {
    for (const bad of ["", "OB-", "OB-B7B0-2A1", "OB-B7B0-2A1C9", "B7B0%2A1C", "hotel oberhof", "b7b02a1c-52"]) {
      expect(parseBookingReference(bad)).toBeNull();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { attachGuestDetails, guestWindow } from "./guest-details";
import { booking, facts } from "./test-fixtures";

describe("guest details", () => {
  test("guestWindow runs 24 months back from today", () => {
    expect(guestWindow("2026-11-23")).toEqual({ from: "2024-11-23", to: "2026-11-23" });
  });

  test("attachGuestDetails leaves unmatched facts without guest details", () => {
    const matched = booking({ id: "r1", hasGuestDetails: false, guestKey: "", guestCountry: "", adults: 0, children: 0 });
    const other = booking({ id: "r2", hasGuestDetails: false, guestKey: "", guestCountry: "", adults: 0, children: 0 });
    const out = attachGuestDetails(facts([matched, other]), [
      { reservationId: "r1", guestKey: "u1", guestCountry: "NL", adults: 2, children: 1 },
    ]);
    expect(out.bookings[0]).toMatchObject({ hasGuestDetails: true, guestKey: "u1", guestCountry: "NL", adults: 2, children: 1 });
    expect(out.bookings[1]).toMatchObject({ hasGuestDetails: false, guestKey: "", adults: 0 });
  });
});

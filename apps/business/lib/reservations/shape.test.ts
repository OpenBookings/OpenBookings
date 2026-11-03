import { describe, expect, test } from "bun:test";
import { toGuestContact, toHostReservation, type HostReservationRow } from "./shape";

const room = (id: string, extra: Partial<HostReservationRow["rooms"][number]> = {}): HostReservationRow["rooms"][number] => ({
  reservation_id: id,
  room_name: "Deluxe",
  cancellation_tier: "flex",
  check_in_at: "2031-11-10T14:00:00+00:00",
  full_refund_until: "2031-11-09T14:00:00+00:00",
  nights: [
    { date: "2031-11-10", price: 100, touristTax: 3 },
    { date: "2031-11-11", price: 100, touristTax: 3 },
  ],
  cancelled_at: null,
  ...extra,
});

const row = (extra: Partial<HostReservationRow> = {}): HostReservationRow => ({
  booking_id: "b0000000-0000-4000-8000-000000000011",
  status: "confirmed",
  check_in_date: "2031-11-10",
  check_out_date: "2031-11-12",
  guest_name: "Emma de Vries",
  guests: 2,
  total_amount: 206,
  timezone: "Europe/Amsterdam",
  check_in_time: "15:00",
  check_in_until: "22:00",
  departed_early_on: null,
  confirmed_at: "2031-10-01T10:00:00+00:00",
  refunded: 0,
  unsettled_refunds: 0,
  rooms: [room("r1"), room("r2", { room_name: "Suite" })],
  ...extra,
});

const NOW = new Date("2031-11-01T10:00:00Z");

describe("toHostReservation", () => {
  test("the reservation itself carries no guest contact details", () => {
    const r = toHostReservation(row(), NOW) as Record<string, unknown>;
    expect("guestPhone" in r).toBe(false);
    expect("guestAddress" in r).toBe(false);
  });

  test("a confirmed booking ahead: its rooms, policy and what the host can do", () => {
    const r = toHostReservation(row(), NOW);
    expect(r.reference).toBe("B0000000");
    expect(r.roomName).toBe("Deluxe + Suite");
    expect(r.totalAmount).toBe(412);
    expect(r.actions).toEqual(["cancel", "goodwill_refund"]);
    expect(r.rooms[0]).toMatchObject({ reservationId: "r1", tierLabel: "Flex", paid: 206, cancelledAt: null });
    expect(r.rooms[0].policyLines[0]).toBe("Free cancellation until Sun 9 Nov 2031, 15:00.");
  });

  test("completed shows as checked out", () => {
    expect(toHostReservation(row({ status: "completed" }), NOW).status).toBe("checked_out");
  });

  test("after the arrival window closes the host can mark a no-show", () => {
    expect(toHostReservation(row(), new Date("2031-11-10T22:30:00Z")).actions).toContain("mark_no_show");
  });

  test("a booking that already left early can't record a second departure", () => {
    const r = toHostReservation(row({ status: "checked_in", departed_early_on: "2031-11-10" }), new Date("2031-11-11T08:00:00Z"));
    expect(r.actions).not.toContain("record_early_departure");
  });

  test("a refund that hasn't gone through is flagged", () => {
    expect(toHostReservation(row({ unsettled_refunds: 1 }), NOW).refundIssue).toBe(true);
  });

  test("a cut-off after midnight keeps the no-show button away until it passes", () => {
    const r = row({ check_in_until: "01:00" });
    expect(toHostReservation(r, new Date("2031-11-10T22:30:00Z")).actions).not.toContain("mark_no_show");
    expect(toHostReservation(r, new Date("2031-11-11T00:30:00Z")).actions).toContain("mark_no_show");
  });

  test("goodwill is still possible on a no-show", () => {
    expect(toHostReservation(row({ status: "no_show" }), new Date("2031-11-12T10:00:00Z")).actions).toEqual(["goodwill_refund"]);
  });
});

describe("toGuestContact", () => {
  test("contact details the guest shared; none means null", () => {
    expect(
      toGuestContact({
        guest_phone: "+31 6 1234 5678",
        guest_address: { line1: "Oudegracht 1", line2: null, postal_code: "3511 AA", city: "Utrecht", country: "NL" },
      }),
    ).toEqual({ phone: "+31 6 1234 5678", address: ["Oudegracht 1", "3511 AA Utrecht", "Netherlands"] });
    expect(toGuestContact({ guest_phone: null, guest_address: null })).toEqual({ phone: null, address: null });
  });
});

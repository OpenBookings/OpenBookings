import { describe, expect, test } from "bun:test";
import { toHostReservation, type HostReservationRow } from "./shape";

const room = (id: string, extra: Partial<HostReservationRow["rooms"][number]> = {}): HostReservationRow["rooms"][number] => ({
  reservation_id: id,
  room_name: "Deluxe",
  cancellation_tier: "flex",
  check_in_at: "2031-11-10T14:00:00+00:00",
  grace_until: null,
  full_refund_until: "2031-11-09T14:00:00+00:00",
  partial_refund_until: null,
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
});

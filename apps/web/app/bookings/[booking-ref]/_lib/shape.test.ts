import { describe, expect, test } from "bun:test";
import { toGuestBooking, type GuestBookingRow } from "./shape";

const room = (id: string, extra: Partial<GuestBookingRow["rooms"][number]> = {}): GuestBookingRow["rooms"][number] => ({
  reservation_id: id,
  room_name: "Deluxe",
  cancellation_tier: "flex",
  check_in_at: "2031-11-10T14:00:00+00:00",
  full_refund_until: "2031-11-09T14:00:00+00:00",
  nights: [
    { date: "2031-11-10", price: 185, touristTax: 3 },
    { date: "2031-11-11", price: 185, touristTax: 3 },
  ],
  cancelled_at: null,
  ...extra,
});

const row = (extra: Partial<GuestBookingRow> = {}): GuestBookingRow => ({
  booking_id: "b0000000-0000-4000-8000-000000000011",
  status: "confirmed",
  check_in_date: "2031-11-10",
  check_out_date: "2031-11-12",
  property_name: "Terme di Saturnia",
  city: "Saturnia",
  timezone: "Europe/Rome",
  check_in_until: null,
  confirmed_at: "2031-10-01T10:00:00+00:00",
  refunded: 0,
  rooms: [room("r1"), room("r2")],
  ...extra,
});

const NOW = new Date("2031-11-01T10:00:00Z");

describe("toGuestBooking", () => {
  test("a confirmed booking: each room's policy, and it can be cancelled", () => {
    const b = toGuestBooking(row(), NOW);
    expect(b.reference).toBe("B0000000");
    expect(b.canCancel).toBe(true);
    expect(b.rooms).toHaveLength(2);
    expect(b.rooms[0]).toMatchObject({ tierLabel: "Flex", paid: 376, cancelledAt: null });
    expect(b.rooms[0].policyLines).toContain("If you don't show up, nothing is refunded.");
    expect(b.totalPaid).toBe(752);
  });

  test("a cancelled booking can't be cancelled again", () => {
    expect(toGuestBooking(row({ status: "cancelled" }), NOW).canCancel).toBe(false);
  });

  test("once the stay is over there is nothing to cancel", () => {
    expect(toGuestBooking(row(), new Date("2031-11-13T10:00:00Z")).canCancel).toBe(false);
  });
});

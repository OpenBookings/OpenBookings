import { describe, expect, test } from "bun:test";
import {
  mapBookings,
  mapInventory,
  type BookingMoneyRow,
  type ReservationRow,
} from "./facts-map";

function res(over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    reservationId: "r1",
    bookingId: "b1",
    sortIndex: 0,
    bookingStatus: "confirmed",
    bookedAt: "2026-05-01T10:00:00.000Z",
    checkIn: "2026-06-01",
    checkOut: "2026-06-04",
    totalNights: 3,
    departedEarlyOn: null,
    reservationCancelledAt: null,
    bookingCancelledAt: null,
    roomId: "room",
    ratePlanId: "plan",
    pricePerNightCents: 10000,
    nightsJson: [],
    vatSplit: null,
    discountCents: null,
    roomsTotalCents: 30000,
    ...over,
  };
}

function money(over: Partial<BookingMoneyRow> = {}): BookingMoneyRow {
  return {
    bookingId: "b1",
    commissionCents: 0,
    commissionRefundedCents: 0,
    accommodationRefunds: [],
    ...over,
  };
}

describe("mapBookings", () => {
  test("net per night is price minus room and breakfast VAT", () => {
    const { bookings } = mapBookings(
      [
        res({
          checkOut: "2026-06-02",
          totalNights: 1,
          nightsJson: [{ date: "2026-06-01", priceCents: 12100 }],
          vatSplit: { nights: [{ date: "2026-06-01", room: { vatCents: 2100 }, breakfast: null }] },
        }),
        res({
          reservationId: "r2",
          checkOut: "2026-06-02",
          totalNights: 1,
          nightsJson: [{ date: "2026-06-01", priceCents: 13000 }],
          vatSplit: { nights: [{ date: "2026-06-01", room: { vatCents: 2100 }, breakfast: { vatCents: 900 } }] },
        }),
      ],
      [money()],
    );
    expect(bookings[0].nightlyNetCents).toEqual([10000]);
    expect(bookings[1].nightlyNetCents).toEqual([10000]);
  });

  test("empty nights json falls back to price_per_night_cents", () => {
    const { bookings, nights } = mapBookings([res()], [money()]);
    expect(bookings[0].nightlyNetCents).toEqual([10000, 10000, 10000]);
    expect(nights.map((n) => n.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(bookings[0].guestKey).toBe("");
    expect(bookings[0].hasGuestDetails).toBe(false);
    expect(bookings[0].createdAt).toBe("2026-05-01T10:00:00.000Z");
  });

  test("pending bookings are excluded", () => {
    const { bookings, nights } = mapBookings([res({ bookingStatus: "pending" })], [money()]);
    expect(bookings).toEqual([]);
    expect(nights).toEqual([]);
  });

  test("checked_in maps to confirmed", () => {
    expect(mapBookings([res({ bookingStatus: "checked_in" })], [money()]).bookings[0].status).toBe(
      "confirmed",
    );
  });

  test("reservation cancelled_at makes it cancelled while booking is confirmed", () => {
    const { bookings, nights } = mapBookings(
      [res({ reservationCancelledAt: "2026-05-10T00:00:00.000Z" })],
      [money()],
    );
    expect(bookings[0].status).toBe("cancelled");
    expect(bookings[0].cancelledAt).toBe("2026-05-10T00:00:00.000Z");
    expect(nights).toEqual([]);
  });

  test("booking-level refund splits pro rata", () => {
    const vat = (n: number) => ({
      nights: Array.from({ length: n }, (_, i) => ({
        date: `2026-06-0${i + 1}`,
        room: { vatCents: 1736 },
        breakfast: null,
      })),
    });
    const { bookings } = mapBookings(
      [
        res({
          reservationId: "r0",
          sortIndex: 0,
          roomsTotalCents: 30000,
          nightsJson: [1, 2, 3].map((d) => ({ date: `2026-06-0${d}`, priceCents: 10000 })),
          vatSplit: vat(3),
        }),
        res({
          reservationId: "r1",
          sortIndex: 1,
          roomsTotalCents: 10000,
          checkOut: "2026-06-02",
          totalNights: 1,
          nightsJson: [{ date: "2026-06-01", priceCents: 10000 }],
          vatSplit: vat(1),
        }),
      ],
      [money({ accommodationRefunds: [{ reservationId: null, cents: 1001 }] })],
    );
    for (const b of bookings) {
      expect(b.nightlyNetCents.reduce((a, c) => a + c, 0)).toBe(b.netRevenueCents);
    }
    // gross shares 751 / 250; net = gross * (8264 / 10000)
    expect(bookings[0].netRevenueCents).toBe(24792 - Math.round(751 * 0.8264));
    expect(bookings[1].netRevenueCents).toBe(8264 - Math.round(250 * 0.8264));
  });

  test("refund spread over nights, remainder on last night", () => {
    const { bookings } = mapBookings(
      [res()],
      [money({ accommodationRefunds: [{ reservationId: "r1", cents: 100 }] })],
    );
    expect(bookings[0].nightlyNetCents).toEqual([9967, 9967, 9966]);
    expect(bookings[0].netRevenueCents).toBe(29900);
  });

  test("cancelled reservation keeps fee", () => {
    const { bookings } = mapBookings(
      [
        res({
          reservationCancelledAt: "2026-05-10T00:00:00.000Z",
          checkOut: "2026-06-03",
          totalNights: 2,
          roomsTotalCents: 20000,
        }),
      ],
      [money({ accommodationRefunds: [{ reservationId: "r1", cents: 15000 }] })],
    );
    expect(bookings[0].netRevenueCents).toBe(5000);
    expect(bookings[0].cancellationFeeCents).toBe(5000);
  });

  test("kept reservations have no cancellation fee", () => {
    expect(mapBookings([res()], [money()]).bookings[0].cancellationFeeCents).toBe(0);
  });

  test("no_show keeps revenue and has no sold nights", () => {
    const { bookings, nights } = mapBookings([res({ bookingStatus: "no_show" })], [money()]);
    expect(bookings[0].status).toBe("no_show");
    expect(bookings[0].netRevenueCents).toBe(30000);
    expect(nights).toEqual([]);
  });

  test("early departure stops sold nights after departed_early_on", () => {
    const { bookings, nights } = mapBookings(
      [res({ checkOut: "2026-06-05", totalNights: 4, departedEarlyOn: "2026-06-02", roomsTotalCents: 40000 })],
      [money()],
    );
    expect(nights.map((n) => n.date)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(nights[0]).toMatchObject({ roomId: "room", ratePlanId: "plan", bookingId: "r1", revenueCents: 10000 });
    expect(bookings[0].netRevenueCents).toBe(40000);
  });

  test("commission is charged minus refunded, split pro rata", () => {
    const { bookings } = mapBookings(
      [
        res({ reservationId: "r0", sortIndex: 0, roomsTotalCents: 30000 }),
        res({ reservationId: "r1", sortIndex: 1, roomsTotalCents: 10000, checkOut: "2026-06-02", totalNights: 1 }),
      ],
      [money({ commissionCents: 1801, commissionRefundedCents: 100 })],
    );
    // 1701: 1275.75 / 425.25 -> 1275 / 425, remainder 1 to sortIndex 0
    expect(bookings.map((b) => b.commissionCents)).toEqual([1276, 425]);
  });

  test("discount is converted ex VAT and added back to the base price", () => {
    const { bookings } = mapBookings(
      [
        res({
          checkOut: "2026-06-02",
          totalNights: 1,
          nightsJson: [{ date: "2026-06-01", priceCents: 12100 }],
          vatSplit: { nights: [{ date: "2026-06-01", room: { vatCents: 2100 }, breakfast: null }] },
          discountCents: 1210,
        }),
      ],
      [money()],
    );
    expect(bookings[0].discountCents).toBe(1000);
    expect(bookings[0].basePriceCents).toBe(11000);
  });
});

describe("mapInventory", () => {
  const range = { from: "2026-06-01", to: "2026-06-05" };

  test("room counts from created_on and stops at archived_on", () => {
    const out = mapInventory(
      range,
      [{ roomId: "a", totalUnits: 4, createdOn: "2026-06-02", archivedOn: "2026-06-05" }],
      [],
    );
    expect(out.map((i) => i.date)).toEqual(["2026-06-02", "2026-06-03", "2026-06-04"]);
    expect(out[0]).toEqual({ date: "2026-06-02", roomId: "a", unitsTotal: 4, unitsOutOfOrder: 0 });
  });

  test("available_override beats total; blocked rooms are out of order", () => {
    const out = mapInventory(
      range,
      [{ roomId: "a", totalUnits: 4, createdOn: "2026-01-01", archivedOn: null }],
      [
        { roomId: "a", date: "2026-06-01", totalRooms: 6, availableOverride: null, blockedRooms: 1 },
        { roomId: "a", date: "2026-06-02", totalRooms: 6, availableOverride: 3, blockedRooms: 2 },
      ],
    );
    expect(out.map((i) => [i.unitsTotal, i.unitsOutOfOrder])).toEqual([
      [6, 1],
      [3, 2],
      [4, 0],
      [4, 0],
      [4, 0],
    ]);
  });

  test("closures are not a mapper input", () => {
    expect(mapInventory.length).toBe(3);
  });
});

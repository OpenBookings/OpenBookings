import { describe, expect, test } from "bun:test";
import { classifyBooking, groupBookings, type GuestBookingListRow } from "./list";

const TODAY = "2026-11-01";

function row(over: Partial<GuestBookingListRow>): GuestBookingListRow {
  return {
    booking_id: "aaaaaaaa-0000-0000-0000-000000000000",
    status: "confirmed",
    check_in_date: "2026-11-10",
    check_out_date: "2026-11-12",
    property_name: "Hotel",
    property_slug: "hotel",
    city: "Utrecht",
    hero_image_url: null,
    rooms: 1,
    guests: 2,
    total_paid: 200,
    ...over,
  };
}

describe("classifyBooking", () => {
  test("cancelled status is cancelled, whatever the dates", () => {
    expect(classifyBooking(row({ status: "cancelled" }), TODAY)).toBe("cancelled");
    expect(classifyBooking(row({ status: "cancelled", check_out_date: "2025-01-01" }), TODAY)).toBe("cancelled");
  });

  test("completed and no-show are past", () => {
    expect(classifyBooking(row({ status: "completed" }), TODAY)).toBe("past");
    expect(classifyBooking(row({ status: "no_show" }), TODAY)).toBe("past");
  });

  test("confirmed or checked in with checkout before today is past", () => {
    expect(classifyBooking(row({ check_in_date: "2026-10-20", check_out_date: "2026-10-31" }), TODAY)).toBe("past");
    expect(
      classifyBooking(row({ status: "checked_in", check_in_date: "2026-10-20", check_out_date: "2026-10-31" }), TODAY),
    ).toBe("past");
  });

  test("checkout today still counts as upcoming", () => {
    expect(classifyBooking(row({ check_in_date: "2026-10-30", check_out_date: TODAY }), TODAY)).toBe("upcoming");
  });

  test("confirmed future stay is upcoming; checked in mid-stay is upcoming", () => {
    expect(classifyBooking(row({}), TODAY)).toBe("upcoming");
    expect(classifyBooking(row({ status: "checked_in", check_in_date: "2026-10-31" }), TODAY)).toBe("upcoming");
  });
});

describe("groupBookings", () => {
  test("upcoming soonest first; past and cancelled most recent first", () => {
    const groups = groupBookings(
      [
        row({ booking_id: "u-late", check_in_date: "2026-12-01", check_out_date: "2026-12-03" }),
        row({ booking_id: "u-soon", check_in_date: "2026-11-05", check_out_date: "2026-11-06" }),
        row({ booking_id: "p-old", status: "completed", check_in_date: "2025-01-01", check_out_date: "2025-01-02" }),
        row({ booking_id: "p-new", status: "completed", check_in_date: "2026-09-01", check_out_date: "2026-09-02" }),
        row({ booking_id: "c-old", status: "cancelled", check_in_date: "2026-02-01" }),
        row({ booking_id: "c-new", status: "cancelled", check_in_date: "2026-12-20" }),
      ],
      TODAY,
    );
    expect(groups.upcoming.map((b) => b.booking_id)).toEqual(["u-soon", "u-late"]);
    expect(groups.past.map((b) => b.booking_id)).toEqual(["p-new", "p-old"]);
    expect(groups.cancelled.map((b) => b.booking_id)).toEqual(["c-new", "c-old"]);
  });

  test("no bookings gives three empty lists", () => {
    expect(groupBookings([], TODAY)).toEqual({ upcoming: [], past: [], cancelled: [] });
  });
});

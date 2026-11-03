import { describe, expect, test } from "bun:test";
import type { GuestBookingRow } from "./shape";
import { buildTimeline, timeLeft } from "./timeline";

const room = (id: string, extra: Partial<GuestBookingRow["rooms"][number]> = {}): GuestBookingRow["rooms"][number] => ({
  reservation_id: id,
  room_name: `Room ${id}`,
  cancellation_tier: "standard",
  check_in_at: "2031-11-10T14:00:00+00:00",
  full_refund_until: "2031-11-03T14:00:00+00:00",
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
  check_in_time: "15:00",
  check_out_time: "11:00",
  check_in_until: "22:00",
  confirmed_at: "2031-10-01T10:00:00+00:00",
  refunded: 0,
  rooms: [room("1")],
  ...extra,
});

const labels = (t: ReturnType<typeof buildTimeline>) => t.steps.map((s) => s.label);
const details = (t: ReturnType<typeof buildTimeline>) => t.steps.filter((s) => s.detail).map((s) => s.label);

describe("buildTimeline", () => {
  test("inside the free window: Today before the deadline, full refund applies now", () => {
    const t = buildTimeline(row(), new Date("2031-10-20T10:00:00Z"));
    expect(labels(t)).toEqual(["Booked", "Today", "Free cancellation ends", "Check-in", "Check-out"]);
    expect(t.steps.map((s) => s.state)).toEqual(["past", "today", "future", "future", "future"]);
    expect(t.steps[2]).toMatchObject({ date: "Mon 3 Nov", time: "15:00" });
    expect(t.headline).toEqual({
      tone: "free",
      eyebrow: "Free cancellation",
      sentence: "Cancel before Mon 3 Nov, 15:00 for a full refund.",
    });
    expect(details(t)).toEqual(["Check-out"]);
    expect(t.steps[4].detail).toBe("Leaving early? The remaining nights are still charged.");
    expect(t.trip).toEqual({
      checkInDate: "Mon 10 Nov",
      checkInTime: "15:00",
      checkOutDate: "Wed 12 Nov",
      checkOutTime: "11:00",
      nights: 2,
      countdown: "21 days to go",
    });
  });

  test("after the deadline: Today moves past it and the expired rule is gone", () => {
    const t = buildTimeline(row(), new Date("2031-11-05T10:00:00Z"));
    expect(labels(t)).toEqual(["Booked", "Free cancellation ends", "Today", "Check-in", "Check-out"]);
    expect(t.headline.eyebrow).toBe("Check-in in 5 days");
    expect(t.trip.countdown).toBe("5 days to go");
  });

  test("non-refundable: no deadline step, cancelling never refunds the room", () => {
    const t = buildTimeline(
      row({ rooms: [room("1", { cancellation_tier: "non_refundable", full_refund_until: null })] }),
      new Date("2031-10-20T10:00:00Z"),
    );
    expect(labels(t)).toEqual(["Booked", "Today", "Check-in", "Check-out"]);
    expect(t.headline.sentence).toBe("Check in from Mon 10 Nov, 15:00. Cancelling now won't refund the room price.");
  });

  test("rooms with different policies: the deadline names its rooms", () => {
    const t = buildTimeline(
      row({ rooms: [room("1"), room("2", { cancellation_tier: "non_refundable", full_refund_until: null })] }),
      new Date("2031-10-20T10:00:00Z"),
    );
    expect(t.steps.find((s) => s.label === "Free cancellation ends")?.note).toBe("Room 1");
    expect(t.headline.eyebrow).toBe("Free cancellation for some rooms");
  });

  test("during the stay only check-out still has a rule", () => {
    const t = buildTimeline(row({ status: "checked_in" }), new Date("2031-11-11T10:00:00Z"));
    expect(labels(t)).toEqual(["Booked", "Free cancellation ends", "Check-in", "Today", "Check-out"]);
    expect(details(t)).toEqual(["Check-out"]);
    expect(t.trip.countdown).toBe("Happening now");
    expect(t.headline.eyebrow).toBe("You're checked in");
  });

  test("a cancelled booking: booked, cancelled, the refund, no details", () => {
    const t = buildTimeline(
      row({ status: "cancelled", refunded: 376, rooms: [room("1", { cancelled_at: "2031-10-15T09:00:00+00:00" })] }),
      new Date("2031-10-20T10:00:00Z"),
    );
    expect(labels(t)).toEqual(["Booked", "Cancelled"]);
    expect(t.steps[1].tone).toBe("cancelled");
    expect(details(t)).toEqual([]);
    expect(t.trip.countdown).toBeNull();
    expect(t.headline.sentence).toContain("376,00 is refunded to your card.");
  });

  test("a stay longer than 7 nights keeps only the next 7 on leaving early", () => {
    const t = buildTimeline(row({ check_out_date: "2031-11-20" }), new Date("2031-10-20T10:00:00Z"));
    expect(t.steps.at(-1)?.detail).toBe("Leaving early? The next 7 nights are still charged.");
  });

  test("a no-show marks check-in", () => {
    const t = buildTimeline(row({ status: "no_show" }), new Date("2031-11-11T10:00:00Z"));
    expect(t.steps.find((s) => s.key === "check-in")).toMatchObject({ label: "No-show", tone: "noshow" });
    expect(details(t)).toEqual([]);
  });

  test("once checked out: everything past, no Today", () => {
    const t = buildTimeline(row({ status: "completed" }), new Date("2031-11-20T10:00:00Z"));
    expect(t.steps.every((s) => s.state === "past")).toBe(true);
    expect(t.headline.eyebrow).toBe("Stay completed");
  });
});

test("timeLeft", () => {
  expect(timeLeft(3 * 86_400_000)).toBe("3 days");
  expect(timeLeft(5 * 3_600_000)).toBe("5 hours");
  expect(timeLeft(60_000)).toBe("under an hour");
});

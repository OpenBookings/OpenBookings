import { describe, expect, test } from "bun:test";
import type { HostReservationRow } from "./shape";
import { buildHostTimeline } from "./timeline";

const room = (id: string, extra: Partial<HostReservationRow["rooms"][number]> = {}): HostReservationRow["rooms"][number] => ({
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

const row = (extra: Partial<HostReservationRow> = {}): HostReservationRow => ({
  booking_id: "b0000000-0000-4000-8000-000000000011",
  status: "confirmed",
  check_in_date: "2031-11-10",
  check_out_date: "2031-11-12",
  guest_name: "Emma de Vries",
  guests: 2,
  adults: 2,
  children: 0,
  infants: 0,
  cots: 0,
  extra_beds: 0,
  pay_at_property: 0,
  total_amount: 376,
  timezone: "Europe/Amsterdam",
  check_in_time: "15:00",
  check_in_until: "22:00",
  check_out_time: "11:00",
  departed_early_on: null,
  confirmed_at: "2031-10-01T10:00:00+00:00",
  refunded: 0,
  unsettled_refunds: 0,
  rooms: [room("1")],
  ...extra,
});

const labels = (t: ReturnType<typeof buildHostTimeline>) => t.steps.map((s) => s.label);

describe("buildHostTimeline", () => {
  test("inside the free window: Today before the deadline, in words for staff", () => {
    const t = buildHostTimeline(row(), new Date("2031-10-20T10:00:00Z"));
    expect(labels(t)).toEqual(["Booked", "Today", "Free cancellation ends", "Check-in", "Check-out"]);
    expect(t.steps.map((s) => s.state)).toEqual(["past", "today", "future", "future", "future"]);
    expect(t.steps[2]).toMatchObject({ date: "Mon 3 Nov", time: "15:00" });
    expect(t.headline).toEqual({
      tone: "free",
      eyebrow: "Free cancellation",
      sentence: "The guest can cancel for a full refund until Mon 3 Nov, 15:00.",
    });
    expect(t.steps[4].detail).toBe("If the guest leaves early, the remaining nights are still charged.");
  });

  test("after the free window: the room price is no longer refunded", () => {
    const t = buildHostTimeline(row(), new Date("2031-11-05T10:00:00Z"));
    expect(t.headline.tone).toBe("fee");
    expect(t.headline.eyebrow).toBe("Check-in in 5 days");
    expect(labels(t)).toEqual(["Booked", "Free cancellation ends", "Today", "Check-in", "Check-out"]);
  });

  test("during the stay: checked in, check-out ahead", () => {
    const t = buildHostTimeline(row({ status: "checked_in" }), new Date("2031-11-11T09:00:00Z"));
    expect(t.headline).toEqual({ tone: "stay", eyebrow: "Checked in", sentence: "Check-out is on Wed 12 Nov." });
  });

  test("cancelled: what went back to the guest, no Today", () => {
    const t = buildHostTimeline(
      row({ status: "cancelled", refunded: 376, rooms: [room("1", { cancelled_at: "2031-10-10T08:00:00+00:00" })] }),
      new Date("2031-10-20T10:00:00Z"),
    );
    expect(labels(t)).toEqual(["Booked", "Cancelled"]);
    expect(t.headline.sentence).toBe("€376.00 was refunded to the guest.");
  });

  test("left early: the departure replaces check-out", () => {
    const t = buildHostTimeline(
      row({ status: "checked_in", departed_early_on: "2031-11-10" }),
      new Date("2031-11-11T12:00:00Z"),
    );
    expect(labels(t)).toEqual(["Booked", "Free cancellation ends", "Check-in", "Left early"]);
    expect(t.steps.at(-1)).toMatchObject({ label: "Left early", date: "Tue 11 Nov", state: "past" });
  });

  test("two policies, two deadlines: each says which rooms", () => {
    const t = buildHostTimeline(
      row({ rooms: [room("1"), room("2", { cancellation_tier: "flex", full_refund_until: "2031-11-09T14:00:00+00:00" })] }),
      new Date("2031-10-20T10:00:00Z"),
    );
    const deadlines = t.steps.filter((s) => s.label === "Free cancellation ends");
    expect(deadlines.map((d) => d.note)).toEqual(["Room 1", "Room 2"]);
  });
});

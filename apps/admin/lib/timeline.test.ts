import { describe, expect, test } from "bun:test";
import type { BookingEvent } from "@openbookings/db";
import { buildTimeline } from "./timeline";

const t = (s: string) => new Date(`2031-01-01T${s}Z`);

function base() {
  return {
    booking: {
      id: "b1",
      status: "confirmed",
      user_id: "u1",
      created_at: t("10:00:00"),
      confirmed_at: t("10:05:00"),
      cancelled_at: null,
      no_show_reported_at: null,
      departed_early_on: null,
      hotel_id: "h1",
      cancellation_reason: null,
    },
    rooms: [
      { id: "r1", room_name: "A", rate_plan_name: "Flex", cancelled_at: t("11:00:00") },
      { id: "r2", room_name: "B", rate_plan_name: "Flex", cancelled_at: null },
    ],
    refunds: [
      { id: "f1", reservation_id: "r1", reason: "room_cancelled", amount: 50, status: "succeeded", created_by: null, created_at: t("11:30:00") },
    ],
    transactions: [] as { id: string; type: string; amount: number; status: string; created_at: Date }[],
    events: [] as BookingEvent[],
  };
}

function ev(kind: BookingEvent["kind"], at: Date, id: string = kind): BookingEvent {
  return { id, bookingId: "b1", reservationId: null, kind, actorKind: "admin", actorId: "dev", reason: null, data: {}, createdAt: at };
}

describe("buildTimeline", () => {
  test("no events: fully reconstructed", () => {
    const tl = buildTimeline(base());
    expect(tl.map((e) => e.kind)).toEqual(["created", "confirmed", "room_cancelled", "refund_succeeded"]);
    expect(tl.every((e) => e.reconstructed)).toBe(true);
    expect(tl[0].actorKind).toBe("guest");
    expect(tl[0].actorId).toBe("u1");
    expect(tl[2].reservationId).toBe("r1");
    expect(tl[2].actorKind).toBe("unknown");
    expect(tl[3].actorKind).toBe("system");
  });

  test("with events: stored plus earlier facts only", () => {
    const b = base();
    b.events = [ev("forced_uncancel", t("12:00:00"))];
    const tl = buildTimeline(b);
    expect(tl.map((e) => e.kind)).toEqual(["created", "confirmed", "room_cancelled", "refund_succeeded", "forced_uncancel"]);
    expect(tl.map((e) => e.reconstructed)).toEqual([true, true, true, true, false]);
  });

  test("reconstructed facts at or after the first stored event are dropped", () => {
    const b = base();
    b.events = [ev("rooms_cancelled", t("11:00:00"))];
    const tl = buildTimeline(b);
    expect(tl.map((e) => e.kind)).toEqual(["created", "confirmed", "rooms_cancelled"]);
  });

  test("created is kept even at or after the first stored event", () => {
    const b = base();
    b.events = [ev("checked_in", t("09:00:00"))];
    const tl = buildTimeline(b);
    expect(tl.map((e) => e.kind)).toEqual(["checked_in", "created"]);
  });

  test("ties sort stored first", () => {
    const b = base();
    b.events = [ev("checked_in", t("10:00:00"))];
    const tl = buildTimeline(b);
    expect(tl.map((e) => e.kind)).toEqual(["checked_in", "created"]);
  });
});

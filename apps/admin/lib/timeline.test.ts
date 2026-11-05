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

  describe("duplicates by meaning", () => {
    const evd = (kind: BookingEvent["kind"], at: Date, data: Record<string, unknown>): BookingEvent => ({
      ...ev(kind, at),
      data,
    });

    test("a stored confirmed replaces the reconstructed one even when it lands a few ms later", () => {
      const b = base();
      b.booking.confirmed_at = new Date(t("10:05:00").getTime() - 3);
      b.events = [ev("confirmed", t("10:05:00"))];
      const kinds = buildTimeline(b).map((e) => e.kind);
      expect(kinds.filter((k) => k === "confirmed")).toHaveLength(1);
      expect(buildTimeline(b).find((e) => e.kind === "confirmed")?.reconstructed).toBe(false);
    });

    test("a stored rooms_cancelled replaces reconstructed room/booking/refund facts a few ms earlier", () => {
      const b = base();
      b.booking.status = "cancelled";
      const bk = b.booking as { cancelled_at: Date | null };
      const at = t("12:00:00");
      const before = (ms: number) => new Date(at.getTime() - ms);
      b.rooms[0].cancelled_at = before(5);
      bk.cancelled_at = before(5);
      b.refunds[0].created_at = before(4);
      b.events = [
        evd("rooms_cancelled", at, { reservationIds: ["r1"], cancelsBooking: true, refundTotal: 50 }),
        { ...evd("refund_succeeded", new Date(at.getTime() + 2), { refundId: "f1", amount: 50 }), reservationId: "r1" },
      ];
      const tl = buildTimeline(b);
      expect(tl.map((e) => e.kind)).toEqual(["created", "confirmed", "rooms_cancelled", "refund_succeeded"]);
    });

    test("forced_cancel also covers its rooms; unrelated rooms keep their reconstructed fact", () => {
      const b = base();
      b.rooms[1].cancelled_at = new Date(t("12:00:00").getTime() - 2);
      b.events = [evd("forced_cancel", t("12:00:00"), { reservationIds: ["r2"], cancelsBooking: false })];
      const tl = buildTimeline(b);
      expect(tl.filter((e) => e.kind === "room_cancelled").map((e) => e.reservationId)).toEqual(["r1"]);
    });

    test("a stored no_show replaces the reconstructed one", () => {
      const b = base();
      (b.booking as { no_show_reported_at: Date | null }).no_show_reported_at = new Date(t("12:00:00").getTime() - 2);
      b.events = [ev("no_show", t("12:00:00"))];
      expect(buildTimeline(b).filter((e) => e.kind === "no_show")).toHaveLength(1);
    });

    test("a reconstructed refund is only dropped for the refund a stored event names", () => {
      const b = base();
      b.refunds.push({ id: "f2", reservation_id: "r2", reason: "x", amount: 5, status: "pending", created_by: null, created_at: t("11:40:00") });
      b.events = [evd("refund_succeeded", t("11:30:00"), { refundId: "f1", amount: 50 })];
      b.refunds[0].created_at = new Date(t("11:30:00").getTime() - 2);
      const refunds = buildTimeline(b).filter((e) => e.kind.startsWith("refund_"));
      expect(refunds.map((e) => e.kind)).toEqual(["refund_succeeded"]);
      expect(refunds[0].reconstructed).toBe(false);
    });
  });
});

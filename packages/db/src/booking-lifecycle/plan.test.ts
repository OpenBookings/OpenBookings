import { describe, expect, test } from "bun:test";
import { buildPolicySnapshot, type CancellationTier, type NightValue } from "@openbookings/pricing";
import { planCancellation, planEarlyDeparture, planGoodwill, roomPaidCents, type RoomState } from "./plan";

const DAY = 86_400_000;
const ARRIVAL = "2026-11-10";
const CHECK_IN_AT = new Date("2026-11-10T14:00:00Z");

const nights = (count: number): NightValue[] =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.parse(`${ARRIVAL}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10),
    priceCents: 10_000,
    touristTaxCents: 300,
  }));

const room = (id: string, tier: CancellationTier = "flex", extra: Partial<RoomState> = {}): RoomState => ({
  reservationId: id,
  snapshot: buildPolicySnapshot({
    tier,
    timeZone: "Europe/Amsterdam",
    checkInTime: "15:00",
    arrivalDate: ARRIVAL,
    confirmedAt: new Date("2026-10-01T10:00:00Z"),
  }),
  nights: nights(3),
  cancelledAt: null,
  refundedCents: 0,
  ...extra,
});

/** Ten days before check-in: outside Flex's 24h, so a full refund on Flex. */
const TEN_DAYS_BEFORE = new Date(CHECK_IN_AT.getTime() - 10 * DAY);

describe("planCancellation", () => {
  test("a guest cancelling one room of two: that room's refund, booking stays", () => {
    const plan = planCancellation({ rooms: [room("a"), room("b")], reservationIds: ["a"], actor: "guest", now: TEN_DAYS_BEFORE });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rooms.map((r) => [r.reservationId, r.result.refund.totalCents, r.reason])).toEqual([["a", 30_900, "guest_cancellation"]]);
    expect(plan.cancelsBooking).toBe(false);
    expect(plan.totalCents).toBe(30_900);
  });

  test("cancelling the last active room cancels the booking", () => {
    const plan = planCancellation({
      rooms: [room("a", "flex", { cancelledAt: new Date() }), room("b")],
      reservationIds: null,
      actor: "guest",
      now: TEN_DAYS_BEFORE,
    });
    expect(plan.ok && plan.cancelsBooking).toBe(true);
    expect(plan.ok && plan.rooms.map((r) => r.reservationId)).toEqual(["b"]);
  });

  test("a room that is already cancelled can't be cancelled again", () => {
    const plan = planCancellation({
      rooms: [room("a", "flex", { cancelledAt: new Date() }), room("b")],
      reservationIds: ["a"],
      actor: "guest",
      now: TEN_DAYS_BEFORE,
    });
    expect(plan).toEqual({ ok: false, error: "already_cancelled" });
  });

  test("a room that isn't on the booking is not found", () => {
    expect(planCancellation({ rooms: [room("a")], reservationIds: ["zzz"], actor: "guest", now: TEN_DAYS_BEFORE })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  test("the guest's tier decides; a host cancellation refunds everything", () => {
    const late = new Date(CHECK_IN_AT.getTime() - 3 * DAY);
    const guest = planCancellation({ rooms: [room("a", "standard")], reservationIds: null, actor: "guest", now: late });
    const host = planCancellation({ rooms: [room("a", "standard")], reservationIds: null, actor: "host", now: late });
    expect(guest.ok && guest.totalCents).toBe(900);
    expect(host.ok && host.totalCents).toBe(30_900);
    expect(host.ok && host.rooms[0].reason).toBe("host_cancellation");
  });

  test("never refunds more than is left on the room", () => {
    const plan = planCancellation({ rooms: [room("a", "flex", { refundedCents: 30_000 })], reservationIds: null, actor: "host", now: TEN_DAYS_BEFORE });
    expect(plan.ok && plan.totalCents).toBe(900);
  });
});

describe("rooms priced with cents (Review Focus 4)", () => {
  // Two rooms, two nights of €93.25 each: €186.50 a room, €373.00 on the booking.
  const priced = (id: string): RoomState =>
    room(id, "flex", {
      nights: [
        { date: "2026-11-10", priceCents: 9_325, touristTaxCents: 0 },
        { date: "2026-11-11", priceCents: 9_325, touristTaxCents: 0 },
      ],
    });

  test("cancelling one of two €186.50 rooms refunds exactly 18650, half the booking", () => {
    const plan = planCancellation({ rooms: [priced("a"), priced("b")], reservationIds: ["a"], actor: "guest", now: TEN_DAYS_BEFORE });
    expect(plan.ok && plan.rooms[0].refund).toEqual({ accommodationCents: 18_650, touristTaxCents: 0, totalCents: 18_650 });
    expect(plan.ok && plan.totalCents).toBe(18_650);
  });

  test("what a room paid is the exact sum of its nights", () => {
    expect(roomPaidCents(priced("a"))).toBe(18_650);
    expect(roomPaidCents(room("a"))).toBe(30_900);
  });
});

describe("planEarlyDeparture", () => {
  test("refunds each active room from the night after the last one stayed: the next 7 nights are kept", () => {
    const plan = planEarlyDeparture({ rooms: [room("a", "flex")], lastNightStayed: "2026-11-10" });
    // Two unused nights, both within the 7 kept: only their tourist tax comes back.
    expect(plan.ok && plan.rooms[0].result.refund).toEqual({ accommodationCents: 0, touristTaxCents: 600, totalCents: 600 });
    expect(plan.ok && plan.rooms[0].reason).toBe("early_departure");
  });

  test("the last night isn't an early departure, and a date outside the stay is refused", () => {
    expect(planEarlyDeparture({ rooms: [room("a")], lastNightStayed: "2026-11-12" })).toEqual({ ok: false, error: "not_allowed" });
    expect(planEarlyDeparture({ rooms: [room("a")], lastNightStayed: "2026-11-01" })).toEqual({ ok: false, error: "not_allowed" });
  });

  test("cancelled rooms are left out", () => {
    const plan = planEarlyDeparture({
      rooms: [room("a", "flex", { cancelledAt: new Date() }), room("b", "flex")],
      lastNightStayed: "2026-11-10",
    });
    expect(plan.ok && plan.rooms.map((r) => r.reservationId)).toEqual(["b"]);
  });
});

describe("planGoodwill", () => {
  test("capped at what is left unrefunded", () => {
    expect(planGoodwill({ paidCents: 61_800, refundedCents: 0, amountCents: 1_000_000 })).toEqual({ ok: true, amountCents: 61_800 });
    expect(planGoodwill({ paidCents: 61_800, refundedCents: 1_800, amountCents: 5_000 })).toEqual({ ok: true, amountCents: 5_000 });
    expect(planGoodwill({ paidCents: 61_800, refundedCents: 0, amountCents: 1_250 })).toEqual({ ok: true, amountCents: 1_250 });
  });

  test("nothing left, or nothing asked → nothing to refund", () => {
    expect(planGoodwill({ paidCents: 61_800, refundedCents: 61_800, amountCents: 1_000 })).toEqual({ ok: false, error: "nothing_to_refund" });
    expect(planGoodwill({ paidCents: 61_800, refundedCents: 0, amountCents: 0 })).toEqual({ ok: false, error: "nothing_to_refund" });
    expect(planGoodwill({ paidCents: 61_800, refundedCents: 0, amountCents: -500 })).toEqual({ ok: false, error: "nothing_to_refund" });
  });

  // NaN <= 0 is false, so a `<= 0` guard let it through to a numeric column.
  test("NaN, Infinity and fractions of a cent are rejected, never planned", () => {
    for (const amountCents of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 12.5]) {
      expect(planGoodwill({ paidCents: 61_800, refundedCents: 0, amountCents })).toEqual({ ok: false, error: "invalid_amount" });
    }
  });

  test("a NaN in the booking's own totals refunds nothing rather than NaN", () => {
    expect(planGoodwill({ paidCents: Number.NaN, refundedCents: 0, amountCents: 1_000 })).toEqual({ ok: false, error: "nothing_to_refund" });
    expect(planGoodwill({ paidCents: 61_800, refundedCents: Number.NaN, amountCents: 1_000 })).toEqual({ ok: false, error: "nothing_to_refund" });
  });
});

describe("never refunds more than is left on the whole booking", () => {
  test("goodwill already paid (stored against no room) shrinks a later host cancellation", () => {
    // One room, €309 paid; €250 goodwill already refunded at booking level.
    const plan = planCancellation({ rooms: [room("a")], reservationIds: null, actor: "host", now: TEN_DAYS_BEFORE, bookingLeftCents: 5_900 });
    expect(plan.ok && plan.totalCents).toBe(5_900);
  });

  test("the booking cap is shared across rooms, in order", () => {
    const plan = planCancellation({ rooms: [room("a"), room("b")], reservationIds: null, actor: "host", now: TEN_DAYS_BEFORE, bookingLeftCents: 40_000 });
    expect(plan.ok && plan.rooms.map((r) => r.refund.totalCents)).toEqual([30_900, 9_100]);
  });

  test("an early departure is capped the same way", () => {
    const plan = planEarlyDeparture({ rooms: [room("a")], lastNightStayed: "2026-11-10", bookingLeftCents: 200 });
    expect(plan.ok && plan.totalCents).toBe(200);
  });
});

import { describe, expect, test } from "bun:test";
import { buildPolicySnapshot, type CancellationTier, type NightValue } from "@openbookings/pricing";
import { planCancellation, planEarlyDeparture, planGoodwill, type RoomState } from "./plan";

const DAY = 86_400_000;
const ARRIVAL = "2026-11-10";
const CHECK_IN_AT = new Date("2026-11-10T14:00:00Z");

const nights = (count: number): NightValue[] =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.parse(`${ARRIVAL}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10),
    price: 100,
    touristTax: 3,
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
  refunded: 0,
  ...extra,
});

/** Ten days before check-in: outside Flex's 24h, so a full refund on Flex. */
const TEN_DAYS_BEFORE = new Date(CHECK_IN_AT.getTime() - 10 * DAY);

describe("planCancellation", () => {
  test("a guest cancelling one room of two: that room's refund, booking stays", () => {
    const plan = planCancellation({ rooms: [room("a"), room("b")], reservationIds: ["a"], actor: "guest", now: TEN_DAYS_BEFORE });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.rooms.map((r) => [r.reservationId, r.result.refund.total, r.reason])).toEqual([["a", 309, "guest_cancellation"]]);
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
    const guest = planCancellation({ rooms: [room("a", "limited")], reservationIds: null, actor: "guest", now: late });
    const host = planCancellation({ rooms: [room("a", "limited")], reservationIds: null, actor: "host", now: late });
    expect(guest.ok && guest.totalCents).toBe(900);
    expect(host.ok && host.totalCents).toBe(30_900);
    expect(host.ok && host.rooms[0].reason).toBe("host_cancellation");
  });

  test("never refunds more than is left on the room", () => {
    const plan = planCancellation({ rooms: [room("a", "flex", { refunded: 300 })], reservationIds: null, actor: "host", now: TEN_DAYS_BEFORE });
    expect(plan.ok && plan.totalCents).toBe(900);
  });
});

describe("planEarlyDeparture", () => {
  test("refunds each active room by its tier from the night after the last one stayed", () => {
    const plan = planEarlyDeparture({ rooms: [room("a", "flex")], lastNightStayed: "2026-11-10" });
    expect(plan.ok && plan.rooms[0].result.refund).toEqual({ accommodation: 100, touristTax: 6, total: 106 });
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
    expect(planGoodwill({ paid: 618, refunded: 0, amount: 10_000 })).toEqual({ ok: true, amount: 618 });
    expect(planGoodwill({ paid: 618, refunded: 18, amount: 50 })).toEqual({ ok: true, amount: 50 });
  });

  test("nothing left, or nothing asked → nothing to refund", () => {
    expect(planGoodwill({ paid: 618, refunded: 618, amount: 10 })).toEqual({ ok: false, error: "nothing_to_refund" });
    expect(planGoodwill({ paid: 618, refunded: 0, amount: 0 })).toEqual({ ok: false, error: "nothing_to_refund" });
  });
});

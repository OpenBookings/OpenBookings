/**
 * The decisions behind each booking action, without the database or Stripe:
 * which rooms, which rule, how much. `booking-lifecycle/index.ts` reads the
 * rows, calls these, and writes what they decide.
 */
import { calculateRefund, type Amounts, type NightValue, type PolicySnapshot, type RefundResult } from "@openbookings/pricing";

export type RefundReason =
  | "guest_cancellation"
  | "early_departure"
  | "host_cancellation"
  | "property_unable"
  | "travel_restriction"
  | "goodwill";

/** One reserved room as the lifecycle sees it. */
export type RoomState = {
  reservationId: string;
  snapshot: PolicySnapshot;
  nights: NightValue[];
  cancelledAt: Date | null;
  /** Refunded on this room so far (refund rows that did not fail), euros. */
  refunded: number;
};

export type PlannedRefund = {
  reservationId: string;
  reason: RefundReason;
  /** What the policy says, for the record. */
  result: RefundResult;
  /** What is actually refunded: the policy's amount, capped at what is left on the room. */
  refund: Amounts;
};

export type PlanError = "not_found" | "already_cancelled" | "not_allowed" | "nothing_to_refund";
type Planned<T> = ({ ok: true } & T) | { ok: false; error: PlanError };

const cents = (euros: number) => Math.round(euros * 100);

/** What a room's guest paid: every night's price and tourist tax. */
export function roomPaid(room: Pick<RoomState, "nights">): number {
  return room.nights.reduce((sum, n) => sum + cents(n.price) + cents(n.touristTax), 0) / 100;
}

function capped(room: RoomState, reason: RefundReason, result: RefundResult, bookingLeftCents: number): PlannedRefund {
  const left = Math.max(0, Math.min(cents(roomPaid(room)) - cents(room.refunded), bookingLeftCents));
  const total = Math.min(cents(result.refund.total), left);
  // Tourist tax first: it is never the host's money to keep.
  const touristTax = Math.min(cents(result.refund.touristTax), total);
  return {
    reservationId: room.reservationId,
    reason,
    result,
    refund: { accommodation: (total - touristTax) / 100, touristTax: touristTax / 100, total: total / 100 },
  };
}

const sumCents = (rooms: PlannedRefund[]) => rooms.reduce((sum, r) => sum + cents(r.refund.total), 0);

/**
 * Cap each room at what is left on it AND, room by room, at what is left on
 * the whole booking: goodwill refunds belong to no room, so a per-room cap
 * alone would let goodwill-then-cancel refund more than was paid.
 */
function cappedAll(
  items: { room: RoomState; reason: RefundReason; result: RefundResult }[],
  bookingLeft: number | undefined,
): PlannedRefund[] {
  let left = bookingLeft === undefined ? Number.POSITIVE_INFINITY : Math.max(0, cents(bookingLeft));
  return items.map(({ room, reason, result }) => {
    const planned = capped(room, reason, result, left);
    left -= cents(planned.refund.total);
    return planned;
  });
}

/**
 * Cancel some rooms (`reservationIds`) or every room still active (`null`).
 * A guest gets their tier; a host cancelling gets the guest everything back
 * (Annex B B.5.4).
 */
export function planCancellation(i: {
  rooms: RoomState[];
  reservationIds: string[] | null;
  actor: "guest" | "host";
  now: Date;
  /** What is left unrefunded on the whole booking, euros. */
  bookingLeft?: number;
}): Planned<{ rooms: PlannedRefund[]; cancelsBooking: boolean; totalCents: number }> {
  const ids = i.reservationIds ?? i.rooms.filter((r) => !r.cancelledAt).map((r) => r.reservationId);
  const chosen = ids.map((id) => i.rooms.find((r) => r.reservationId === id));
  if (chosen.some((r) => !r)) return { ok: false, error: "not_found" };
  const active = (chosen as RoomState[]).filter((r) => !r.cancelledAt);
  if (active.length === 0) return { ok: false, error: "already_cancelled" };

  const reason: RefundReason = i.actor === "host" ? "host_cancellation" : "guest_cancellation";
  const rooms = cappedAll(
    active.map((room) => ({
      room,
      reason,
      result: calculateRefund(
        room.snapshot,
        room.nights,
        reason === "host_cancellation" ? { kind: "host_cancellation" } : { kind: "guest_cancellation", at: i.now },
      ),
    })),
    i.bookingLeft,
  );
  const stillActive = i.rooms.filter((r) => !r.cancelledAt && !active.includes(r));
  return { ok: true, rooms, cancelsBooking: stillActive.length === 0, totalCents: sumCents(rooms) };
}

/**
 * The guest left after `lastNightStayed`. It has to be a night of the stay
 * and not the last one: leaving after the last night is just checking out.
 */
export function planEarlyDeparture(i: {
  rooms: RoomState[];
  lastNightStayed: string;
  /** What is left unrefunded on the whole booking, euros. */
  bookingLeft?: number;
}): Planned<{ rooms: PlannedRefund[]; totalCents: number }> {
  const active = i.rooms.filter((r) => !r.cancelledAt);
  const stayNights = active[0]?.nights.map((n) => n.date) ?? [];
  const index = stayNights.indexOf(i.lastNightStayed);
  if (index < 0 || index >= stayNights.length - 1) return { ok: false, error: "not_allowed" };

  const rooms = cappedAll(
    active.map((room) => ({
      room,
      reason: "early_departure" as const,
      result: calculateRefund(room.snapshot, room.nights, { kind: "early_departure", lastNightStayed: i.lastNightStayed }),
    })),
    i.bookingLeft,
  );
  return { ok: true, rooms, totalCents: sumCents(rooms) };
}

/** A goodwill refund (Path A, the host's choice), capped at what is left unrefunded. */
export function planGoodwill(i: { paid: number; refunded: number; amount: number }): Planned<{ amount: number }> {
  const left = Math.max(0, cents(i.paid) - cents(i.refunded));
  const amount = Math.min(cents(i.amount), left);
  if (amount <= 0) return { ok: false, error: "nothing_to_refund" };
  return { ok: true, amount: amount / 100 };
}

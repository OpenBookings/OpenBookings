import type { BookingEvent } from "@openbookings/db";
import type { AdminBooking } from "./booking";

export type TimelineEntry = {
  at: Date;
  kind: string;
  actorKind: string;
  actorId: string | null;
  reason: string | null;
  data: Record<string, unknown>;
  reservationId: string | null;
  reconstructed: boolean;
};

type Input = Pick<AdminBooking, "booking" | "rooms" | "refunds" | "transactions" | "events">;

function fromEvent(e: BookingEvent): TimelineEntry {
  return {
    at: e.createdAt,
    kind: e.kind,
    actorKind: e.actorKind,
    actorId: e.actorId,
    reason: e.reason,
    data: e.data,
    reservationId: e.reservationId,
    reconstructed: false,
  };
}

function rec(
  at: Date,
  kind: string,
  extra: Partial<Omit<TimelineEntry, "at" | "kind" | "reconstructed">> = {},
): TimelineEntry {
  return {
    at,
    kind,
    actorKind: "unknown",
    actorId: null,
    reason: null,
    data: {},
    reservationId: null,
    reconstructed: true,
    ...extra,
  };
}

/**
 * Row timestamps (JS clock / transaction start) and event timestamps
 * (clock_timestamp) differ by a few ms, so a fact and the stored event that
 * describes it can't be matched by time. Match by meaning instead.
 */
function coveredByStored(stored: TimelineEntry[]): (f: TimelineEntry) => boolean {
  const has = (kind: string) => stored.some((e) => e.kind === kind);
  const ids = (e: TimelineEntry) => (Array.isArray(e.data.reservationIds) ? (e.data.reservationIds as unknown[]) : []);
  const cancelledRooms = new Set(
    stored.filter((e) => e.kind === "rooms_cancelled" || e.kind === "forced_cancel").flatMap(ids),
  );
  const cancelsBooking = stored.some((e) => e.data.cancelsBooking === true);
  const refundIds = new Set(
    stored.filter((e) => e.kind.startsWith("refund_")).map((e) => e.data.refundId),
  );
  return (f) => {
    if (f.kind === "confirmed" || f.kind === "no_show") return has(f.kind);
    if (f.kind === "room_cancelled") return f.reservationId !== null && cancelledRooms.has(f.reservationId);
    if (f.kind === "booking_cancelled") return cancelsBooking;
    if (f.kind.startsWith("refund_")) return refundIds.has(f.data.refundId);
    return false;
  };
}

export function buildTimeline(b: Input): TimelineEntry[] {
  const { booking } = b;
  const facts: TimelineEntry[] = [
    rec(booking.created_at, "created", { actorKind: "guest", actorId: booking.user_id }),
  ];
  if (booking.confirmed_at) facts.push(rec(booking.confirmed_at, "confirmed", { actorKind: "system" }));
  for (const room of b.rooms) {
    if (room.cancelled_at) {
      facts.push(
        rec(room.cancelled_at, "room_cancelled", {
          reservationId: room.id,
          data: { room: room.room_name },
        }),
      );
    }
  }
  if (booking.cancelled_at) {
    const reason = booking.cancellation_reason;
    facts.push(
      rec(booking.cancelled_at, "booking_cancelled", { reason: typeof reason === "string" ? reason : null }),
    );
  }
  if (booking.no_show_reported_at) facts.push(rec(booking.no_show_reported_at, "no_show"));
  for (const r of b.refunds) {
    facts.push(
      rec(r.created_at, `refund_${r.status}`, {
        actorKind: r.created_by ? "unknown" : "system",
        actorId: r.created_by,
        reason: r.reason,
        reservationId: r.reservation_id,
        data: { amount: r.amount, refundId: r.id },
      }),
    );
  }
  for (const t of b.transactions) {
    facts.push(rec(t.created_at, `transaction_${t.type}`, { data: { amount: t.amount, status: t.status } }));
  }

  const stored = b.events.map(fromEvent);
  let kept = facts;
  if (stored.length > 0) {
    const first = Math.min(...stored.map((e) => e.at.getTime()));
    const covered = coveredByStored(stored);
    kept = facts.filter(
      (f) => f.kind === "created" || (f.at.getTime() < first && !covered(f)),
    );
  }
  const all = [...stored, ...kept];
  return all
    .map((e, i) => ({ e, i }))
    .sort((x, y) => {
      const d = x.e.at.getTime() - y.e.at.getTime();
      if (d !== 0) return d;
      if (x.e.reconstructed !== y.e.reconstructed) return x.e.reconstructed ? 1 : -1;
      return x.i - y.i;
    })
    .map((x) => x.e);
}

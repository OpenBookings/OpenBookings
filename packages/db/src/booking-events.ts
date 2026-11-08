import type { Queryable } from "./reservation-policy";

export type BookingEventKind =
  | "confirmed" | "rooms_cancelled" | "checked_in" | "no_show" | "early_departure"
  | "goodwill_refund" | "refund_succeeded" | "refund_failed" | "refund_uncertain"
  | "forced_status" | "forced_uncancel" | "forced_cancel" | "forced_refund_deleted"
  | "forced_refund_status" | "forced_markers_cleared";

export type BookingEventActor = { kind: "guest" | "host" | "system" | "admin"; id: string | null };

export type NewBookingEvent = {
  bookingId: string;
  reservationId?: string | null;
  kind: BookingEventKind;
  actor: BookingEventActor;
  reason?: string | null;
  data?: Record<string, unknown>;
};

export type BookingEvent = {
  id: string;
  bookingId: string;
  reservationId: string | null;
  kind: BookingEventKind;
  actorKind: BookingEventActor["kind"];
  actorId: string | null;
  reason: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
};

/** The dev super-admin dashboard's identity in the event log. */
export const ADMIN_ACTOR: BookingEventActor = { kind: "admin", id: "dev-super-admin" };

/**
 * Append one event. `created_at` is `clock_timestamp()`, not the column's
 * `now()` default: inside a transaction `now()` is frozen, so two events
 * recorded in one transaction would tie and sort by random id.
 */
export async function recordBookingEvent(db: Queryable, e: NewBookingEvent): Promise<void> {
  await db.query(
    `INSERT INTO booking_events (booking_id, reservation_id, kind, actor_kind, actor_id, reason, data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, clock_timestamp())`,
    [
      e.bookingId,
      e.reservationId ?? null,
      e.kind,
      e.actor.kind,
      e.actor.id,
      e.reason ?? null,
      JSON.stringify(e.data ?? {}),
    ],
  );
}

type EventRow = {
  id: string;
  booking_id: string;
  reservation_id: string | null;
  kind: BookingEventKind;
  actor_kind: BookingEventActor["kind"];
  actor_id: string | null;
  reason: string | null;
  data: Record<string, unknown>;
  created_at: Date;
};

/** Oldest first (created_at, id). */
export async function loadBookingEvents(db: Queryable, bookingId: string): Promise<BookingEvent[]> {
  const { rows } = await db.query(
    `SELECT id, booking_id, reservation_id, kind, actor_kind, actor_id, reason, data, created_at
       FROM booking_events
      WHERE booking_id = $1
      ORDER BY created_at, id`,
    [bookingId],
  );
  return (rows as EventRow[]).map((r) => ({
    id: r.id,
    bookingId: r.booking_id,
    reservationId: r.reservation_id,
    kind: r.kind,
    actorKind: r.actor_kind,
    actorId: r.actor_id,
    reason: r.reason,
    data: r.data,
    createdAt: r.created_at,
  }));
}

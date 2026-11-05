import { ADMIN_ACTOR, recordBookingEvent, type Queryable } from "@openbookings/db";
import { UUID_RE } from "./search";

/**
 * Forced edits ignore every booking rule and never touch Stripe: they only
 * rewrite database rows, for playing with demo data. Each function runs on the
 * transaction it is given, locks the booking, and writes one admin event.
 */
export type ForcedResult = { ok: true } | { ok: false; error: "not_found" | "invalid" };

const STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show", "checked_in"];
const REFUND_STATUSES = ["pending", "succeeded", "failed"];
const invalid = { ok: false, error: "invalid" } as const;
const notFound = { ok: false, error: "not_found" } as const;
const ok = { ok: true } as const;

const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const idList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every(isId);

/** How many of these reservations belong to the booking. */
async function owned(tx: Queryable, bookingId: string, reservationIds: string[]): Promise<number> {
  const { rows } = await tx.query(
    `SELECT count(*)::int AS n FROM reservations WHERE booking_id = $1 AND id = ANY($2::uuid[])`,
    [bookingId, reservationIds],
  );
  return (rows[0] as { n: number }).n;
}

async function lock(tx: Queryable, bookingId: string): Promise<{ status: string } | null> {
  const { rows } = await tx.query(`SELECT status FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
  return (rows[0] as { status: string } | undefined) ?? null;
}

export async function forceStatus(
  tx: Queryable,
  i: { bookingId: string; status: string; reason?: string },
): Promise<ForcedResult> {
  if (!isId(i.bookingId) || !STATUSES.includes(i.status)) return invalid;
  const b = await lock(tx, i.bookingId);
  if (!b) return notFound;
  await tx.query(`UPDATE bookings SET status = $2::booking_status, updated_at = now() WHERE id = $1`, [
    i.bookingId,
    i.status,
  ]);
  await recordBookingEvent(tx, {
    bookingId: i.bookingId,
    kind: "forced_status",
    actor: ADMIN_ACTOR,
    reason: i.reason,
    data: { from: b.status, to: i.status },
  });
  return ok;
}

export async function forceUncancelRooms(
  tx: Queryable,
  i: { bookingId: string; reservationIds: string[]; reason?: string },
): Promise<ForcedResult> {
  if (!isId(i.bookingId) || !idList(i.reservationIds)) return invalid;
  const b = await lock(tx, i.bookingId);
  if (!b || (await owned(tx, i.bookingId, i.reservationIds)) === 0) return notFound;
  await tx.query(`UPDATE reservations SET cancelled_at = NULL WHERE booking_id = $1 AND id = ANY($2::uuid[])`, [
    i.bookingId,
    i.reservationIds,
  ]);
  const to = b.status === "cancelled" ? "confirmed" : b.status;
  if (to !== b.status) {
    await tx.query(
      `UPDATE bookings SET status = 'confirmed', cancelled_at = NULL, cancellation_reason = NULL, updated_at = now() WHERE id = $1`,
      [i.bookingId],
    );
  }
  await recordBookingEvent(tx, {
    bookingId: i.bookingId,
    kind: "forced_uncancel",
    actor: ADMIN_ACTOR,
    reason: i.reason,
    data: { reservationIds: i.reservationIds, bookingStatusFrom: b.status, bookingStatusTo: to },
  });
  return ok;
}

export async function forceCancelRooms(
  tx: Queryable,
  i: { bookingId: string; reservationIds: string[]; reason?: string },
): Promise<ForcedResult> {
  if (!isId(i.bookingId) || !idList(i.reservationIds)) return invalid;
  const b = await lock(tx, i.bookingId);
  if (!b || (await owned(tx, i.bookingId, i.reservationIds)) === 0) return notFound;
  await tx.query(
    `UPDATE reservations SET cancelled_at = now() WHERE booking_id = $1 AND id = ANY($2::uuid[]) AND cancelled_at IS NULL`,
    [i.bookingId, i.reservationIds],
  );
  const { rows } = await tx.query(
    `SELECT count(*) FILTER (WHERE cancelled_at IS NULL)::int AS open, count(*)::int AS total
       FROM reservations WHERE booking_id = $1`,
    [i.bookingId],
  );
  const counts = rows[0] as { open: number; total: number };
  const cancelsBooking = counts.total > 0 && counts.open === 0;
  if (cancelsBooking) {
    await tx.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Cancelled by admin', updated_at = now() WHERE id = $1`,
      [i.bookingId],
    );
  }
  await recordBookingEvent(tx, {
    bookingId: i.bookingId,
    kind: "forced_cancel",
    actor: ADMIN_ACTOR,
    reason: i.reason,
    data: { reservationIds: i.reservationIds, cancelsBooking },
  });
  return ok;
}

export async function forceDeleteRefund(
  tx: Queryable,
  i: { bookingId: string; refundId: string; reason?: string },
): Promise<ForcedResult> {
  if (!isId(i.bookingId) || !isId(i.refundId)) return invalid;
  if (!(await lock(tx, i.bookingId))) return notFound;
  const { rows } = await tx.query(`DELETE FROM refunds WHERE id = $1 AND booking_id = $2 RETURNING *`, [
    i.refundId,
    i.bookingId,
  ]);
  if (!rows[0]) return notFound;
  await recordBookingEvent(tx, {
    bookingId: i.bookingId,
    kind: "forced_refund_deleted",
    actor: ADMIN_ACTOR,
    reason: i.reason,
    data: { refund: rows[0] },
  });
  return ok;
}

export async function forceRefundStatus(
  tx: Queryable,
  i: { bookingId: string; refundId: string; status: "pending" | "succeeded" | "failed"; reason?: string },
): Promise<ForcedResult> {
  if (!isId(i.bookingId) || !isId(i.refundId) || !REFUND_STATUSES.includes(i.status)) return invalid;
  if (!(await lock(tx, i.bookingId))) return notFound;
  const cur = await tx.query(`SELECT status FROM refunds WHERE id = $1 AND booking_id = $2 FOR UPDATE`, [
    i.refundId,
    i.bookingId,
  ]);
  if (!cur.rows[0]) return notFound;
  await tx.query(`UPDATE refunds SET status = $2::payment_status WHERE id = $1`, [i.refundId, i.status]);
  await recordBookingEvent(tx, {
    bookingId: i.bookingId,
    kind: "forced_refund_status",
    actor: ADMIN_ACTOR,
    reason: i.reason,
    data: { refundId: i.refundId, from: (cur.rows[0] as { status: string }).status, to: i.status },
  });
  return ok;
}

export async function forceClearMarkers(
  tx: Queryable,
  i: { bookingId: string; noShow: boolean; earlyDeparture: boolean; reason?: string },
): Promise<ForcedResult> {
  if (!isId(i.bookingId)) return invalid;
  if (!(await lock(tx, i.bookingId))) return notFound;
  const noShow = i.noShow === true;
  const earlyDeparture = i.earlyDeparture === true;
  await tx.query(
    `UPDATE bookings
        SET no_show_reported_at = CASE WHEN $2 THEN NULL ELSE no_show_reported_at END,
            departed_early_on = CASE WHEN $3 THEN NULL ELSE departed_early_on END,
            updated_at = now()
      WHERE id = $1`,
    [i.bookingId, noShow, earlyDeparture],
  );
  await recordBookingEvent(tx, {
    bookingId: i.bookingId,
    kind: "forced_markers_cleared",
    actor: ADMIN_ACTOR,
    reason: i.reason,
    data: { noShow, earlyDeparture },
  });
  return ok;
}

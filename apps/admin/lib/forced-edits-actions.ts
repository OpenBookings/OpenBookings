"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import {
  forceCancelRooms,
  forceClearMarkers,
  forceDeleteRefund,
  forceRefundStatus,
  forceStatus,
  forceUncancelRooms,
  type ForcedResult,
} from "./forced-edits";
import { dangerousAction } from "./dangerous";
import type { Confirmation, DangerousAction, DangerousResult } from "./dangerous-actions";
import { withWriteTransaction } from "./db";
import { UUID_RE } from "./search";
import { requireStaff } from "./staff";

/**
 * Forced edits are all dangerous (./dangerous.ts): each takes the confirm
 * dialog's reason and step-up token. The reason is also the one the booking
 * event records. Refund edits are confirmed for the refund row, the others for
 * the booking.
 */

type Target = { type: "booking" | "refund"; id: string };

async function run(
  action: DangerousAction,
  bookingId: string,
  target: Target,
  confirm: Confirmation,
  detail: Record<string, unknown>,
  fn: (tx: PoolClient, reason: string) => Promise<ForcedResult>,
): Promise<DangerousResult<ForcedResult>> {
  await requireStaff();
  // Checked again by the edit itself; here so garbage spends no step-up and writes no audit row.
  if (!UUID_RE.test(String(bookingId)) || !UUID_RE.test(String(target.id))) {
    return { ok: true, value: { ok: false, error: "invalid" } };
  }
  const reason = typeof confirm?.reason === "string" ? confirm.reason.trim() : "";
  return dangerousAction(
    {
      action,
      targetType: target.type,
      targetId: target.id,
      reason,
      stepUpToken: confirm?.stepUpToken,
      detail: { booking_id: bookingId, ...detail },
    },
    async () => {
      const result = await withWriteTransaction((tx) => fn(tx, reason));
      revalidatePath(`/bookings/${bookingId}`);
      return result;
    },
  );
}

const booking = (id: string): Target => ({ type: "booking", id });
const refund = (id: string): Target => ({ type: "refund", id });

export async function adminForceStatus(i: { bookingId: string; status: string }, confirm: Confirmation) {
  return run("booking.force_status", i.bookingId, booking(i.bookingId), confirm, { status: i.status }, (tx, reason) =>
    forceStatus(tx, { bookingId: i.bookingId, status: i.status, reason }),
  );
}

export async function adminForceUncancelRooms(
  i: { bookingId: string; reservationIds: string[] },
  confirm: Confirmation,
) {
  return run(
    "booking.force_uncancel",
    i.bookingId,
    booking(i.bookingId),
    confirm,
    { reservation_ids: i.reservationIds },
    (tx, reason) => forceUncancelRooms(tx, { bookingId: i.bookingId, reservationIds: i.reservationIds, reason }),
  );
}

export async function adminForceCancelRooms(i: { bookingId: string; reservationIds: string[] }, confirm: Confirmation) {
  return run(
    "booking.force_cancel",
    i.bookingId,
    booking(i.bookingId),
    confirm,
    { reservation_ids: i.reservationIds },
    (tx, reason) => forceCancelRooms(tx, { bookingId: i.bookingId, reservationIds: i.reservationIds, reason }),
  );
}

export async function adminForceDeleteRefund(i: { bookingId: string; refundId: string }, confirm: Confirmation) {
  return run("refund.force_delete", i.bookingId, refund(i.refundId), confirm, {}, (tx, reason) =>
    forceDeleteRefund(tx, { bookingId: i.bookingId, refundId: i.refundId, reason }),
  );
}

export async function adminForceRefundStatus(
  i: { bookingId: string; refundId: string; status: "pending" | "succeeded" | "failed" },
  confirm: Confirmation,
) {
  return run("refund.force_status", i.bookingId, refund(i.refundId), confirm, { status: i.status }, (tx, reason) =>
    forceRefundStatus(tx, { bookingId: i.bookingId, refundId: i.refundId, status: i.status, reason }),
  );
}

export async function adminForceClearMarkers(
  i: { bookingId: string; noShow: boolean; earlyDeparture: boolean },
  confirm: Confirmation,
) {
  return run(
    "booking.force_clear_markers",
    i.bookingId,
    booking(i.bookingId),
    confirm,
    { no_show: i.noShow === true, early_departure: i.earlyDeparture === true },
    (tx, reason) =>
      forceClearMarkers(tx, { bookingId: i.bookingId, noShow: i.noShow, earlyDeparture: i.earlyDeparture, reason }),
  );
}

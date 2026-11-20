"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { userCan, type Permission } from "@openbookings/authz";
import { queryOne } from "@openbookings/db";
import {
  cancelRooms,
  issueGoodwillRefund,
  markCheckedIn,
  markNoShow,
  previewRefund,
  recordEarlyDeparture,
  retryRefunds,
  type LifecycleDeps,
  type LifecycleResult,
} from "@openbookings/db/booking-lifecycle";
import { captureOutcome } from "@openbookings/mailing/tracking";
import * as Sentry from "@sentry/nextjs";
import { findRefundForRow, isDefiniteRefundFailure, refundPayment } from "@openbookings/stripe";
import { getServerSession } from "@/lib/auth";
import { goodwillAmount } from "./goodwill-amount";
import { sendCancellation, sendRefundMail } from "@/lib/mailing/booking-mail";
import { ACTION_PERMISSION, RETRY_REFUND_PERMISSION } from "./permissions";

/**
 * The host's booking actions. Each one re-checks, on the server, that the
 * signed-in member's role allows that action at the booking's property (see
 * ./permissions.ts): the booking id comes from the client and is trusted for
 * nothing else. What may happen and how much is refunded is decided in
 * @openbookings/db/booking-lifecycle.
 */

const RESERVATIONS = "/dashboard/bookings/reservations";
const deps: LifecycleDeps = {
  refund: refundPayment,
  isDefiniteFailure: isDefiniteRefundFailure,
  findRefund: findRefundForRow,
  // A refund that didn't go through is money a guest is owed: make it loud.
  onRefundProblem: ({ error, ...context }) =>
    Sentry.captureException(error, { tags: { area: "refunds" }, extra: context }),
};

async function hostFor(bookingId: string, permission: Permission) {
  const session = await getServerSession();
  if (!session) throw new Error("Unauthenticated");
  const booking = await queryOne<{ hotel_id: string }>(
    `SELECT hotel_id FROM bookings WHERE id = $1::uuid`,
    [bookingId],
  ).catch(() => null);
  // Out of scope and missing look the same: not_found either way.
  if (!booking || !(await userCan(session, booking.hotel_id, permission))) return null;
  return { kind: "host" as const, userId: session.user.id };
}

async function run(
  bookingId: string,
  permission: Permission,
  act: (actor: { kind: "host"; userId: string }) => Promise<LifecycleResult>,
) {
  const actor = await hostFor(bookingId, permission);
  if (!actor) return { ok: false, error: "not_found" } satisfies LifecycleResult;
  const result = await act(actor);
  revalidatePath(RESERVATIONS);
  return result;
}

export async function hostCancelRooms(bookingId: string, reservationIds: string[] | null) {
  return run(bookingId, ACTION_PERMISSION.cancel, async (actor) => {
    const result = await cancelRooms(deps, { bookingId, actor, reservationIds });
    if (result.ok && result.cancelled) await sendCancellation(bookingId, result.cancelled);
    return result;
  });
}

export async function hostMarkCheckedIn(bookingId: string) {
  return run(bookingId, ACTION_PERMISSION.mark_checked_in, async (actor) => {
    const result = await markCheckedIn(deps, { bookingId, actor });
    if (result.ok) after(() => captureOutcome("stay_marked_arrived", { userId: actor.userId }));
    return result;
  });
}

export async function hostMarkNoShow(bookingId: string) {
  return run(bookingId, ACTION_PERMISSION.mark_no_show, (actor) => markNoShow(deps, { bookingId, actor }));
}

export async function hostRecordEarlyDeparture(bookingId: string, lastNightStayed: string) {
  return run(bookingId, ACTION_PERMISSION.record_early_departure, async (actor) => {
    const result = await recordEarlyDeparture(deps, { bookingId, actor, lastNightStayed });
    if (result.ok) await sendRefundMail(bookingId, "early_departure", result.refunds);
    return result;
  });
}

/** `amount` is whatever the browser sent; the dialog builds it with Number(text), so junk arrives as NaN. */
export async function hostGoodwillRefund(bookingId: string, amount: number) {
  const parsed = goodwillAmount.safeParse(amount);
  if (!parsed.success) return { ok: false, error: "invalid_amount" } satisfies LifecycleResult;
  return run(bookingId, ACTION_PERMISSION.goodwill_refund, async (actor) => {
    const result = await issueGoodwillRefund(deps, { bookingId, actor, amount: parsed.data });
    if (result.ok) await sendRefundMail(bookingId, "goodwill", result.refunds);
    return result;
  });
}

export async function hostRetryRefunds(bookingId: string) {
  return run(bookingId, RETRY_REFUND_PERMISSION, async () => {
    const result = await retryRefunds(deps, { bookingId });
    if (result.ok) await sendRefundMail(bookingId, "retry", result.refunds);
    return result;
  });
}

/** What an early departure after `lastNightStayed` would refund, for the confirm dialog. */
export async function hostPreviewEarlyDeparture(bookingId: string, lastNightStayed: string) {
  if (!(await hostFor(bookingId, ACTION_PERMISSION.record_early_departure))) return null;
  return previewRefund({ bookingId, reservationIds: null, event: { kind: "early_departure", lastNightStayed } });
}

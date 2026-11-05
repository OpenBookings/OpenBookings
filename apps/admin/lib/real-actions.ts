"use server";

import { revalidatePath } from "next/cache";
import { getPool } from "@openbookings/db";
import {
  cancelRooms,
  issueGoodwillRefund,
  loadBookingState,
  markCheckedIn,
  markNoShow,
  previewRefund,
  recordEarlyDeparture,
  retryRefunds,
  type Actor,
  type LifecycleDeps,
  type LifecycleResult,
} from "@openbookings/db/booking-lifecycle";
import type { BookingAction } from "@openbookings/pricing";
import { findRefundForRow, isDefiniteRefundFailure, refundPayment } from "@openbookings/stripe";
import { actorFor, type ActAs } from "./actor";
import { requireSuperAdmin } from "./super-admin";

/**
 * Real booking actions, run as the booking's guest or the property owner and
 * marked via "admin" in the booking's events. The lifecycle module decides what
 * may happen and how much is refunded, exactly as it does for the host app.
 */

const deps: LifecycleDeps = {
  refund: refundPayment,
  isDefiniteFailure: isDefiniteRefundFailure,
  findRefund: findRefundForRow,
  onRefundProblem: ({ error, ...context }) => console.error("[admin] refund problem", error, context),
};

const notFound = { ok: false, error: "not_found" } satisfies LifecycleResult;

async function run(
  bookingId: string,
  as: ActAs,
  act: (actor: Actor) => Promise<LifecycleResult>,
): Promise<LifecycleResult> {
  requireSuperAdmin();
  const actor = await actorFor(getPool(), bookingId, as);
  if (!actor) return notFound;
  const result = await act(actor);
  revalidatePath(`/bookings/${bookingId}`);
  return result;
}

export async function allowedFor(
  bookingId: string,
  as: ActAs,
): Promise<{ actor: boolean; actions: BookingAction[] }> {
  requireSuperAdmin();
  const actor = await actorFor(getPool(), bookingId, as);
  if (!actor) return { actor: false, actions: [] };
  const state = await loadBookingState(getPool(), bookingId, new Date(), false, as);
  return { actor: true, actions: state?.actions ?? [] };
}

/** What a guest cancellation of these rooms (null = all) would refund now. */
export async function adminPreviewRefund(bookingId: string, reservationIds: string[] | null) {
  requireSuperAdmin();
  return previewRefund({ bookingId, reservationIds });
}

export async function adminCancelRooms(bookingId: string, as: ActAs, reservationIds: string[] | null) {
  return run(bookingId, as, (actor) => cancelRooms(deps, { bookingId, actor, reservationIds }));
}

export async function adminMarkCheckedIn(bookingId: string, as: ActAs) {
  return run(bookingId, as, (actor) => markCheckedIn(deps, { bookingId, actor }));
}

export async function adminMarkNoShow(bookingId: string, as: ActAs) {
  return run(bookingId, as, (actor) => markNoShow(deps, { bookingId, actor }));
}

export async function adminRecordEarlyDeparture(bookingId: string, as: ActAs, lastNightStayed: string) {
  return run(bookingId, as, (actor) => recordEarlyDeparture(deps, { bookingId, actor, lastNightStayed }));
}

/** Always as host. */
export async function adminGoodwillRefund(bookingId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" } satisfies LifecycleResult;
  return run(bookingId, "host", (actor) => issueGoodwillRefund(deps, { bookingId, actor, amount }));
}

export async function adminRetryRefunds(bookingId: string) {
  requireSuperAdmin();
  const result = await retryRefunds(deps, { bookingId });
  revalidatePath(`/bookings/${bookingId}`);
  return result;
}

"use server";

import { revalidatePath } from "next/cache";
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
import { sendBookingCancelled as sendCancellation, sendRefundIssued } from "@openbookings/mailing/booking-send";
import { actorFor, type ActAs } from "./actor";
import { readLifecycleDb, readPool, writeLifecycleDb, writePool } from "./db";
import { UUID_RE } from "./search";
import { isStripeTestMode, requireSuperAdmin } from "./super-admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const invalid = { ok: false, error: "invalid" } as unknown as LifecycleResult;
const badIds = (bookingId: string, ids: string[] | null) =>
  typeof bookingId !== "string" ||
  !UUID_RE.test(bookingId) ||
  (ids !== null && (!Array.isArray(ids) || ids.some((i) => typeof i !== "string" || !UUID_RE.test(i))));

/**
 * Real booking actions, run as the booking's guest or the property owner and
 * marked via "admin" in the booking's events. The lifecycle module decides what
 * may happen and how much is refunded, exactly as it does for the host app.
 *
 * Actions run on the write connection (ob_admin_write), reads on the read one
 * (see ./db). Lifecycle calls and emails get theirs explicitly: left out, they
 * would use the shared DATABASE_URL pool.
 */

const deps = (): LifecycleDeps => ({
  refund: refundPayment,
  isDefiniteFailure: isDefiniteRefundFailure,
  findRefund: findRefundForRow,
  onRefundProblem: ({ error, ...context }) => console.error("[admin] refund problem", error, context),
  db: writeLifecycleDb(),
});

/** Booking emails read on the write connection, untracked (no consent lookups on the shared pool). */
const mailDeps = () => ({
  db: writePool(),
  track: async (m: { html: string }) => ({ html: m.html, onSent: async () => {} }),
});

const notFound = { ok: false, error: "not_found" } satisfies LifecycleResult;
const notTestMode = { ok: false, error: "stripe_not_test_mode" } as unknown as LifecycleResult;

async function run(
  bookingId: string,
  as: ActAs,
  act: (actor: Actor) => Promise<LifecycleResult>,
): Promise<LifecycleResult> {
  requireSuperAdmin();
  if (!isStripeTestMode()) return notTestMode;
  const actor = await actorFor(writePool(), bookingId, as);
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
  const actor = await actorFor(readPool(), bookingId, as);
  if (!actor) return { actor: false, actions: [] };
  const state = await loadBookingState(readPool(), bookingId, new Date(), false, as);
  return { actor: true, actions: state?.actions ?? [] };
}

/** What a guest cancellation of these rooms (null = all) would refund now. */
export async function adminPreviewRefund(bookingId: string, reservationIds: string[] | null) {
  requireSuperAdmin();
  if (!isStripeTestMode() || badIds(bookingId, reservationIds)) return null;
  return previewRefund({ bookingId, reservationIds }, { db: readLifecycleDb() });
}

export async function adminCancelRooms(bookingId: string, as: ActAs, reservationIds: string[] | null) {
  requireSuperAdmin();
  if (badIds(bookingId, reservationIds)) return invalid;
  return run(bookingId, as, async (actor) => {
    const result = await cancelRooms(deps(), { bookingId, actor, reservationIds });
    if (result.ok && result.cancelled) await sendCancellation(bookingId, result.cancelled, undefined, mailDeps());
    return result;
  });
}

export async function adminMarkCheckedIn(bookingId: string, as: ActAs) {
  requireSuperAdmin();
  if (badIds(bookingId, null)) return invalid;
  return run(bookingId, as, (actor) => markCheckedIn(deps(), { bookingId, actor }));
}

export async function adminMarkNoShow(bookingId: string, as: ActAs) {
  requireSuperAdmin();
  if (badIds(bookingId, null)) return invalid;
  return run(bookingId, as, (actor) => markNoShow(deps(), { bookingId, actor }));
}

export async function adminRecordEarlyDeparture(bookingId: string, as: ActAs, lastNightStayed: string) {
  requireSuperAdmin();
  if (badIds(bookingId, null) || typeof lastNightStayed !== "string" || !DATE_RE.test(lastNightStayed)) return invalid;
  return run(bookingId, as, async (actor) => {
    const result = await recordEarlyDeparture(deps(), { bookingId, actor, lastNightStayed });
    if (result.ok) await sendRefundIssued(bookingId, { reason: "early_departure", refunds: result.refunds }, undefined, mailDeps());
    return result;
  });
}

/** Always as host. */
export async function adminGoodwillRefund(bookingId: string, amount: number) {
  requireSuperAdmin();
  if (badIds(bookingId, null)) return invalid;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" } satisfies LifecycleResult;
  return run(bookingId, "host", async (actor) => {
    const result = await issueGoodwillRefund(deps(), { bookingId, actor, amount });
    if (result.ok) await sendRefundIssued(bookingId, { reason: "goodwill", refunds: result.refunds }, undefined, mailDeps());
    return result;
  });
}

export async function adminRetryRefunds(bookingId: string) {
  requireSuperAdmin();
  if (!isStripeTestMode()) return notTestMode;
  if (badIds(bookingId, null)) return invalid;
  const result = await retryRefunds(deps(), { bookingId, via: "admin" });
  if (result.ok) await sendRefundIssued(bookingId, { reason: "retry", refunds: result.refunds }, undefined, mailDeps());
  revalidatePath(`/bookings/${bookingId}`);
  return result;
}

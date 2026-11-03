"use server";

import { revalidatePath } from "next/cache";
import { userOwnsProperty } from "@openbookings/authz";
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
import * as Sentry from "@sentry/nextjs";
import { findRefundForRow, isDefiniteRefundFailure, refundPayment } from "@openbookings/stripe";
import { getServerSession } from "@/lib/auth";
import { goodwillAmount } from "./goodwill-amount";

/**
 * The host's booking actions. Each one re-checks, on the server, that the
 * host may edit the booking's property: the booking id comes from the client
 * and is trusted for nothing else. What may happen and how much is refunded
 * is decided in @openbookings/db/booking-lifecycle.
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

async function hostFor(bookingId: string) {
  const session = await getServerSession();
  if (!session) throw new Error("Unauthenticated");
  const booking = await queryOne<{ hotel_id: string }>(
    `SELECT hotel_id FROM bookings WHERE id = $1::uuid`,
    [bookingId],
  ).catch(() => null);
  if (!booking || !(await userOwnsProperty(session, booking.hotel_id))) return null;
  return { kind: "host" as const, userId: session.user.id };
}

async function run(bookingId: string, act: (actor: { kind: "host"; userId: string }) => Promise<LifecycleResult>) {
  const actor = await hostFor(bookingId);
  if (!actor) return { ok: false, error: "not_found" } satisfies LifecycleResult;
  const result = await act(actor);
  revalidatePath(RESERVATIONS);
  return result;
}

export async function hostCancelRooms(bookingId: string, reservationIds: string[] | null) {
  return run(bookingId, (actor) => cancelRooms(deps, { bookingId, actor, reservationIds }));
}

export async function hostMarkCheckedIn(bookingId: string) {
  return run(bookingId, (actor) => markCheckedIn(deps, { bookingId, actor }));
}

export async function hostMarkNoShow(bookingId: string) {
  return run(bookingId, (actor) => markNoShow(deps, { bookingId, actor }));
}

export async function hostRecordEarlyDeparture(bookingId: string, lastNightStayed: string) {
  return run(bookingId, (actor) => recordEarlyDeparture(deps, { bookingId, actor, lastNightStayed }));
}

/** `amount` is whatever the browser sent; the dialog builds it with Number(text), so junk arrives as NaN. */
export async function hostGoodwillRefund(bookingId: string, amount: number) {
  const parsed = goodwillAmount.safeParse(amount);
  if (!parsed.success) return { ok: false, error: "invalid_amount" } satisfies LifecycleResult;
  return run(bookingId, (actor) => issueGoodwillRefund(deps, { bookingId, actor, amount: parsed.data }));
}

export async function hostRetryRefunds(bookingId: string) {
  return run(bookingId, () => retryRefunds(deps, { bookingId }));
}

/** What an early departure after `lastNightStayed` would refund, for the confirm dialog. */
export async function hostPreviewEarlyDeparture(bookingId: string, lastNightStayed: string) {
  if (!(await hostFor(bookingId))) return null;
  return previewRefund({ bookingId, reservationIds: null, event: { kind: "early_departure", lastNightStayed } });
}

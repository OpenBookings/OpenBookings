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
import type { BookingAction, RefundEvent } from "@openbookings/pricing";
import { parseEuroInput } from "@openbookings/pricing/money";
import { findRefundForRow, isDefiniteRefundFailure, refundPayment } from "@openbookings/stripe";
import { sendBookingCancelled as sendCancellation, sendRefundIssued } from "@openbookings/mailing/booking-send";
import { actorFor, type ActAs } from "./actor";
import { dangerousAction } from "./dangerous";
import type { Confirmation, DangerousAction, DangerousResult } from "./dangerous-actions";
import { readLifecycleDb, readPool, writeLifecycleDb, writePool } from "./db";
import { UUID_RE } from "./search";
import { stripeKeyAllowed } from "./super-admin";
import { requireStaff } from "./staff";

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
 * All but check-in are dangerous (./dangerous.ts): they take the confirm
 * dialog's reason and step-up token, for the booking as target, and answer
 * with a DangerousResult.
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
  await requireStaff();
  if (!stripeKeyAllowed().ok) return notTestMode;
  const actor = await actorFor(writePool(), bookingId, as);
  if (!actor) return notFound;
  const result = await act(actor);
  revalidatePath(`/bookings/${bookingId}`);
  return result;
}

/** A dangerous booking action: confirmed and audited, then `act`. */
async function runConfirmed(
  action: DangerousAction,
  bookingId: string,
  confirm: Confirmation,
  detail: Record<string, unknown>,
  act: () => Promise<LifecycleResult>,
): Promise<DangerousResult<LifecycleResult>> {
  const gate = stripeKeyAllowed();
  if (!gate.ok) return { ok: false, message: gate.error };
  return dangerousAction(
    {
      action,
      targetType: "booking",
      targetId: bookingId,
      reason: confirm?.reason,
      stepUpToken: confirm?.stepUpToken,
      detail,
    },
    act,
  );
}

export async function allowedFor(
  bookingId: string,
  as: ActAs,
): Promise<{ actor: boolean; actions: BookingAction[] }> {
  await requireStaff();
  const actor = await actorFor(readPool(), bookingId, as);
  if (!actor) return { actor: false, actions: [] };
  const state = await loadBookingState(readPool(), bookingId, new Date(), false, as);
  return { actor: true, actions: state?.actions ?? [] };
}

/**
 * What cancelling these rooms (null = all) as the guest or the host, or an
 * early departure after `lastNightStayed`, would refund now. For the confirm
 * dialog's summary; changes nothing.
 */
export async function adminPreviewRefund(
  bookingId: string,
  reservationIds: string[] | null,
  as: ActAs = "guest",
  lastNightStayed?: string,
) {
  await requireStaff();
  if (!stripeKeyAllowed().ok || badIds(bookingId, reservationIds)) return null;
  if (lastNightStayed !== undefined && (typeof lastNightStayed !== "string" || !DATE_RE.test(lastNightStayed))) return null;
  const event: RefundEvent =
    lastNightStayed !== undefined
      ? { kind: "early_departure", lastNightStayed }
      : as === "host"
        ? { kind: "host_cancellation" }
        : { kind: "guest_cancellation", at: new Date() };
  return previewRefund({ bookingId, reservationIds, event }, { db: readLifecycleDb() });
}

export async function adminCancelRooms(
  bookingId: string,
  as: ActAs,
  reservationIds: string[] | null,
  confirm: Confirmation,
) {
  await requireStaff();
  if (badIds(bookingId, reservationIds)) return { ok: true, value: invalid } as const;
  return runConfirmed("booking.cancel_rooms", bookingId, confirm, { as, reservation_ids: reservationIds }, () =>
    run(bookingId, as, async (actor) => {
      const result = await cancelRooms(deps(), { bookingId, actor, reservationIds });
      if (result.ok && result.cancelled) await sendCancellation(bookingId, result.cancelled, undefined, mailDeps());
      return result;
    }),
  );
}

/** Not dangerous: it moves no money and is undone by the next step of the stay. */
export async function adminMarkCheckedIn(bookingId: string, as: ActAs) {
  await requireStaff();
  if (badIds(bookingId, null)) return invalid;
  return run(bookingId, as, (actor) => markCheckedIn(deps(), { bookingId, actor }));
}

export async function adminMarkNoShow(bookingId: string, as: ActAs, confirm: Confirmation) {
  await requireStaff();
  if (badIds(bookingId, null)) return { ok: true, value: invalid } as const;
  return runConfirmed("booking.mark_no_show", bookingId, confirm, { as }, () =>
    run(bookingId, as, (actor) => markNoShow(deps(), { bookingId, actor })),
  );
}

export async function adminRecordEarlyDeparture(
  bookingId: string,
  as: ActAs,
  lastNightStayed: string,
  confirm: Confirmation,
) {
  await requireStaff();
  if (badIds(bookingId, null) || typeof lastNightStayed !== "string" || !DATE_RE.test(lastNightStayed)) {
    return { ok: true, value: invalid } as const;
  }
  return runConfirmed(
    "booking.early_departure",
    bookingId,
    confirm,
    { as, last_night_stayed: lastNightStayed },
    () =>
      run(bookingId, as, async (actor) => {
        const result = await recordEarlyDeparture(deps(), { bookingId, actor, lastNightStayed });
        if (result.ok) await sendRefundIssued(bookingId, { reason: "early_departure", refunds: result.refunds }, undefined, mailDeps());
        return result;
      }),
  );
}

/** Always as host. `amount` is the euros staff typed ("12,50"), read into cents here. */
export async function adminGoodwillRefund(bookingId: string, amount: string, confirm: Confirmation) {
  await requireStaff();
  if (badIds(bookingId, null)) return { ok: true, value: invalid } as const;
  const typed = typeof amount === "string" ? parseEuroInput(amount) : null;
  if (!typed?.ok || typed.cents <= 0) {
    return { ok: true, value: { ok: false, error: "invalid_amount" } satisfies LifecycleResult } as const;
  }
  const amountCents = typed.cents;
  return runConfirmed("booking.goodwill_refund", bookingId, confirm, { amount_cents: amountCents }, () =>
    run(bookingId, "host", async (actor) => {
      const result = await issueGoodwillRefund(deps(), { bookingId, actor, amountCents });
      if (result.ok) await sendRefundIssued(bookingId, { reason: "goodwill", refunds: result.refunds }, undefined, mailDeps());
      return result;
    }),
  );
}

export async function adminRetryRefunds(bookingId: string, confirm: Confirmation) {
  await requireStaff();
  if (badIds(bookingId, null)) return { ok: true, value: invalid } as const;
  return runConfirmed("booking.retry_refunds", bookingId, confirm, {}, async () => {
    const result = await retryRefunds(deps(), { bookingId, via: "admin" });
    if (result.ok) await sendRefundIssued(bookingId, { reason: "retry", refunds: result.refunds }, undefined, mailDeps());
    revalidatePath(`/bookings/${bookingId}`);
    return result;
  });
}

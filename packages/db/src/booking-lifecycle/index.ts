/**
 * The only code that changes a booking's state or records a refund.
 *
 * Every action runs the same way: lock the booking, check the action is allowed
 * right now (`allowedActions`), let `plan.ts` decide the money, write the new
 * state and a `pending` refund row per room, commit, then ask Stripe. A Stripe
 * failure never undoes the cancellation: the row is marked `failed` (Stripe
 * refused it) or stays `pending` (outcome unknown), and `retryRefunds` sends it
 * again. A refund row moves money at most once:
 *
 * - Every send stamps `last_attempt_at` just before its Stripe call. A retry
 *   claims its rows in a transaction (`FOR UPDATE SKIP LOCKED`) and skips a
 *   `pending` row attempted in the last five minutes.
 * - A retry re-sends under the row's original idempotency key while Stripe
 *   remembers it, so Stripe dedupes against the original. Only after a lookup
 *   on Stripe found nothing, and only for a row Stripe definitively refused or
 *   one older than Stripe's key retention, does it use a fresh key per window.
 * - Should a retry still overlap a send on the same key, Stripe's idempotency
 *   conflict is treated as uncertain, not refused: the row stays `pending` and
 *   is looked up before it is ever sent under a fresh key.
 *
 * Who may act is the caller's job (property access for hosts, ownership for
 * guests). This module trusts `actor` and records it.
 */
import {
  allowedActions,
  checkInClosesAt,
  hostNoShowDeadline,
  type BookingAction,
  type BookingStatus,
  type CancellationTier,
  type NightValue,
  type RefundEvent,
  type RefundResult,
} from "@openbookings/pricing";
import { getPool, withTransaction } from "../index";
import { recordBookingEvent, type BookingEventActor, type BookingEventKind, type NewBookingEvent } from "../booking-events";
// Imported from the package root for the pool only; the root does not import
// this module back (apps use "@openbookings/db/booking-lifecycle").
import type { Queryable } from "../reservation-policy";
import {
  planCancellation,
  planEarlyDeparture,
  planGoodwill,
  roomPaidCents,
  type PlanError,
  type PlannedRefund,
  type RefundReason,
  type RoomState,
} from "./plan";

export * from "./plan";

export type RefundFn = (i: {
  paymentIntentId: string;
  stripeAccountId: string;
  amountCents: number;
  idempotencyKey: string;
  metadata: Record<string, string>;
  /**
   * How much of `amountCents` is room price (the rest is tourist tax), and the
   * room price on the whole booking. OpenBookings' commission goes back in
   * proportion to the room price refunded only. Absent for a booking without
   * a policy snapshot, whose nights are unknown.
   */
  roomPrice?: { refundCents: number; totalCents: number };
}) => Promise<{ id: string; status: string }>;

export type LifecycleDb = Queryable & {
  transaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
};

export type LifecycleDeps = {
  refund: RefundFn;
  now?: () => Date;
  /** Defaults to the shared pool. Tests pass a client inside their own transaction. */
  db?: LifecycleDb;
  /**
   * Whether an error from `refund` means Stripe refused it (no money moved).
   * Anything else might have gone through: the row stays `pending` and is
   * checked with `findRefund` before it is ever sent again. Defaults to
   * "always refused", which is what a fake in a test means.
   */
  isDefiniteFailure?: (error: unknown) => boolean;
  /** Looks on Stripe for a refund already made for one of our rows (by `metadata.refundId`). */
  findRefund?: (i: { paymentIntentId: string; stripeAccountId: string; refundRowId: string }) => Promise<{ id: string } | null>;
  /** Told about every refund that didn't go through, so someone can act on it (Sentry, an alert). */
  onRefundProblem?: (i: { bookingId: string; refundId: string; status: "failed" | "pending"; error: unknown }) => void;
};

/** Stripe forgets idempotency keys after about a day; a retry key changes per window, after a lookup. */
const RETRY_KEY_WINDOW_MS = 20 * 3_600_000;

/**
 * A retry leaves a `pending` row alone until its last attempt is this old:
 * well past the Stripe client's timeout and network retries, so the original
 * send has finished one way or another.
 */
const RETRY_MIN_AGE_MS = 5 * 60_000;

/** `via: "admin"`: the dev dashboard acting as this guest or host; stamped on every event the action writes. */
export type Actor = { kind: "guest" | "host"; userId: string; via?: "admin" };

function eventActor(a: Actor): BookingEventActor {
  return { kind: a.kind, id: a.userId };
}

/** Event data, plus `via` when an admin acted. */
function eventData(a: Actor, data: Record<string, unknown>): Record<string, unknown> {
  return a.via ? { ...data, via: a.via } : data;
}

export type RefundStatus = "pending" | "succeeded" | "failed";

/** What a cancelRooms call itself cancelled, so a caller can tell the guest exactly that. */
export type CancelledRooms = {
  reservationIds: string[];
  /** What the cancellation refunds, cents. */
  refundTotalCents: number;
  /**
   * The part of `refundTotalCents` Stripe refused, cents: it is owed but has
   * not gone yet (a retry sends it). The rest went, or is on its way.
   */
  refundFailedCents: number;
  cancelsBooking: boolean;
};

/** What Stripe refused among `refunds`, cents. */
export function failedRefundTotalCents(refunds: { amountCents: number; status: RefundStatus }[]): number {
  return refunds.filter((r) => r.status === "failed").reduce((sum, r) => sum + r.amountCents, 0);
}

export type LifecycleResult =
  | {
      ok: true;
      /** One per refund row, `amountCents` as stored and as sent to Stripe. */
      refunds: { reservationId: string | null; amountCents: number; status: RefundStatus }[];
      /** Set by cancelRooms only. */
      cancelled?: CancelledRooms;
    }
  | { ok: false; error: PlanError | "refund_in_progress" };

const defaultDb: LifecycleDb = {
  query: (text, values) => getPool().query(text, values),
  transaction: (fn) => withTransaction((client) => fn(client)),
};

// ── Loading ───────────────────────────────────────────────────────────────────

type BookingRow = {
  id: string;
  status: BookingStatus;
  user_id: string;
  check_in_date: string;
  check_out_date: string;
  confirmed_at: Date | null;
  departed_early_on: string | null;
  stripe_payment_intent_id: string | null;
  timezone: string;
  check_in_time: string | null;
  check_out_time: string | null;
  check_in_until: string | null;
  /** The account the booking was charged on (its intent's), else the property's. */
  stripe_account_id: string | null;
  organization_id: string | null;
};

type ReservationRow = {
  id: string;
  cancellation_tier: CancellationTier | null;
  check_in_at: Date | null;
  full_refund_until: Date | null;
  policy_version: string | null;
  nights: NightValue[];
  cancelled_at: Date | null;
  refunded_cents: number;
};

export type BookingState = {
  booking: BookingRow;
  rooms: RoomState[];
  /** What may happen now. Empty for a booking without a policy snapshot (still pending). */
  actions: BookingAction[];
  /**
   * Refund rows on the whole booking so far, cents — failed and pending ones
   * included, until they are reconciled, so a cap never assumes money that
   * may already have left. Money the host refunded outside OpenBookings, or
   * lost in a dispute, is in here too (0053): Stripe would refuse to refund it
   * again.
   */
  refundedCents: number;
};

/**
 * Read a booking with its rooms and what `actor` may do to it at `now`.
 * `lock` = FOR UPDATE.
 */
export async function loadBookingState(
  db: Queryable,
  bookingId: string,
  now: Date,
  lock = false,
  actor: Actor["kind"] = "host",
): Promise<BookingState | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const { rows: bookings } = await db.query(
    `SELECT b.id, b.status, b.user_id, b.check_in_date::text AS check_in_date,
            b.check_out_date::text AS check_out_date, b.confirmed_at,
            b.departed_early_on::text AS departed_early_on, b.stripe_payment_intent_id,
            p.timezone, to_char(p.check_in_time, 'HH24:MI') AS check_in_time,
            to_char(p.check_out_time, 'HH24:MI') AS check_out_time,
            to_char(p.check_in_until, 'HH24:MI') AS check_in_until, p.organization_id,
            -- Refund on the account that was charged: the intent's, when the booking came
            -- from one (demo hotels charge on the platform's fallback and have none of their
            -- own; a host may switch accounts later), else the property's.
            COALESCE(
              (SELECT i.payment_account_id FROM booking_intents i
                WHERE i.booking_id = b.id AND i.payment_account_id IS NOT NULL
                ORDER BY i.created_at DESC LIMIT 1),
              p.stripe_account_id
            ) AS stripe_account_id
     FROM bookings b JOIN properties p ON p.id = b.hotel_id
     WHERE b.id = $1 ${lock ? "FOR UPDATE OF b" : ""}`,
    [bookingId],
  );
  const booking = bookings[0] as BookingRow | undefined;
  if (!booking) return null;

  const { rows } = await db.query(
    `SELECT res.id, res.cancellation_tier, res.check_in_at, res.full_refund_until,
            res.policy_version, res.nights, res.cancelled_at,
            -- float8, not int8 (which pg returns as a string); sums of cents stay exact in it.
            COALESCE((SELECT SUM(rf.amount_cents) FROM refunds rf WHERE rf.reservation_id = res.id), 0)::float8 AS refunded_cents
     FROM reservations res WHERE res.booking_id = $1
     ORDER BY res.created_at, res.id`,
    [bookingId],
  );
  const reservations = rows as ReservationRow[];

  const { rows: totals } = await db.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::float8 AS refunded_cents FROM refunds WHERE booking_id = $1`,
    [bookingId],
  );

  const snapshotted = reservations.length > 0 && reservations.every((r) => r.cancellation_tier && r.check_in_at);
  const rooms: RoomState[] = snapshotted
    ? reservations.map((r) => ({
        reservationId: r.id,
        snapshot: {
          tier: r.cancellation_tier as CancellationTier,
          confirmedAt: booking.confirmed_at ?? (r.check_in_at as Date),
          checkInAt: r.check_in_at as Date,
          fullRefundUntil: r.full_refund_until,
          policyVersion: r.policy_version ?? "",
        },
        nights: r.nights,
        cancelledAt: r.cancelled_at,
        refundedCents: Number(r.refunded_cents),
      }))
    : [];

  const actions = (snapshotted
    ? allowedActions({
        status: booking.status,
        checkInAt: rooms[0].snapshot.checkInAt,
        checkInClosesAt: checkInClosesAt({
          arrivalDate: booking.check_in_date,
          checkInTime: booking.check_in_time,
          checkInUntil: booking.check_in_until,
          timeZone: booking.timezone,
        }),
        checkOutDate: booking.check_out_date,
        timeZone: booking.timezone,
        now,
        actor,
        noShowUntil: hostNoShowDeadline({
          checkOutDate: booking.check_out_date,
          checkOutTime: booking.check_out_time,
          timeZone: booking.timezone,
        }),
      })
    : []
  ).filter((a) => !(a === "record_early_departure" && booking.departed_early_on));

  return { booking, rooms, actions, refundedCents: Number((totals[0] as { refunded_cents: number }).refunded_cents) };
}

// ── Writing ───────────────────────────────────────────────────────────────────

const SYSTEM: BookingEventActor = { kind: "system", id: null };

function refundData(actor: { via?: "admin" } | undefined, data: Record<string, unknown>) {
  return actor?.via ? { ...data, via: actor.via } : data;
}

/**
 * The event log is a diagnostic view: after the money moved, a failed event
 * insert must not change refund bookkeeping or stop the remaining refunds.
 */
async function recordEventSafely(db: Queryable, event: NewBookingEvent): Promise<void> {
  try {
    await recordBookingEvent(db, event);
  } catch (error) {
    console.error("booking event not recorded", event.kind, event.bookingId, error);
  }
}

/** Retry rows also carry `status` and `createdAt`, which decide the idempotency key. */
type RefundRow = {
  id: string;
  reservationId: string | null;
  amountCents: number;
  /** The room-price part of `amountCents`; the rest is tourist tax. */
  accommodationCents: number;
  key: string;
  status?: "pending" | "failed";
  createdAt?: Date;
};

async function insertRefund(
  tx: Queryable,
  bookingId: string,
  actor: Actor,
  r: {
    reservationId: string | null;
    reason: RefundReason;
    accommodationCents: number;
    touristTaxCents: number;
    key: string;
    breakdown: unknown;
  },
): Promise<RefundRow> {
  // Whole cents only: a fraction is a caller bug, never something to round away.
  if (!Number.isSafeInteger(r.accommodationCents) || !Number.isSafeInteger(r.touristTaxCents)) {
    throw new RangeError(`A refund must be whole cents (got ${r.accommodationCents} + ${r.touristTaxCents})`);
  }
  const { rows } = await tx.query(
    `INSERT INTO refunds
       (booking_id, reservation_id, reason, accommodation_cents, tourist_tax_cents, amount_cents,
        breakdown, idempotency_key, created_by)
     VALUES ($1, $2, $3::refund_reason, $4::bigint, $5::bigint, $4::bigint + $5::bigint, $6::jsonb, $7, $8)
     RETURNING id, amount_cents::float8 AS amount_cents, accommodation_cents::float8 AS accommodation_cents`,
    [bookingId, r.reservationId, r.reason, r.accommodationCents, r.touristTaxCents, JSON.stringify(r.breakdown), r.key, actor.userId],
  );
  const row = rows[0] as { id: string; amount_cents: number; accommodation_cents: number };
  return {
    id: row.id,
    reservationId: r.reservationId,
    amountCents: Number(row.amount_cents),
    accommodationCents: Number(row.accommodation_cents),
    key: r.key,
  };
}

async function insertPlanned(tx: Queryable, bookingId: string, actor: Actor, planned: PlannedRefund[]) {
  const out: RefundRow[] = [];
  for (const p of planned) {
    // Written so NaN is skipped too (NaN <= 0 is false).
    if (!(p.refund.totalCents > 0)) continue;
    out.push(
      await insertRefund(tx, bookingId, actor, {
        reservationId: p.reservationId,
        reason: p.reason,
        accommodationCents: p.refund.accommodationCents,
        touristTaxCents: p.refund.touristTaxCents,
        key: `refund:${p.reservationId}:${p.reason}`,
        breakdown: p.result satisfies RefundResult,
      }),
    );
  }
  return out;
}

/**
 * Send each refund row to Stripe and record the outcome.
 *
 * - No payment on the booking (a seeded one): the row stays `pending`, so
 *   nothing pretends money moved.
 * - Stripe refused it: `failed`, audited, reported.
 * - Anything else (timeout, dropped connection): it may have gone through, so
 *   the row stays `pending`, audited, reported. It is looked up on Stripe
 *   before it is ever sent again (`retry`).
 * - A status update never overwrites a row that already succeeded.
 *
 * `last_attempt_at` is stamped before every Stripe call. A retry keeps the
 * original key unless the lookup found nothing and the row either was refused
 * by Stripe (`failed`) or is older than Stripe's key retention.
 */
async function sendRefunds(
  deps: LifecycleDeps,
  db: Queryable,
  booking: BookingRow,
  /** The room price on the whole booking, cents; 0 when its nights are unknown. */
  roomsTotalCents: number,
  rows: RefundRow[],
  retry = false,
  actor?: { via?: "admin" },
) {
  const results: { reservationId: string | null; amountCents: number; status: RefundStatus }[] = [];
  for (const row of rows) {
    const pi = booking.stripe_payment_intent_id;
    const account = booking.stripe_account_id;
    if (!pi || !account) {
      results.push({ reservationId: row.reservationId, amountCents: row.amountCents, status: "pending" });
      continue;
    }
    // Its own statement, before Stripe hears of it, on the clock as this row is
    // reached (earlier rows may have taken a while): a retry reads it to leave
    // alone a row sent in the last few minutes.
    const now = deps.now?.() ?? new Date();
    await db.query(`UPDATE refunds SET last_attempt_at = $2::timestamptz WHERE id = $1`, [row.id, now]);
    let succeeded: { stripeRefundId: string } | null = null;
    try {
      const existing =
        retry && deps.findRefund
          ? await deps.findRefund({ paymentIntentId: pi, stripeAccountId: account, refundRowId: row.id })
          : null;
      // A `pending` row may still go through under its original key, so it keeps
      // that key while Stripe remembers it. A fresh key per window only after a
      // lookup found nothing, and only once the original can no longer land.
      const freshKey =
        retry &&
        !!deps.findRefund &&
        (row.status === "failed" ||
          (row.createdAt !== undefined && now.getTime() - row.createdAt.getTime() >= RETRY_KEY_WINDOW_MS));
      // The stored cents go to Stripe as they are.
      const amountCents = row.amountCents;
      const refund =
        existing ??
        (await deps.refund({
          paymentIntentId: pi,
          stripeAccountId: account,
          amountCents,
          idempotencyKey: freshKey ? `${row.key}:r${Math.floor(now.getTime() / RETRY_KEY_WINDOW_MS)}` : row.key,
          metadata: { bookingId: booking.id, refundId: row.id },
          ...(roomsTotalCents > 0
            ? {
                roomPrice: {
                  refundCents: Math.min(Math.max(row.accommodationCents, 0), amountCents),
                  totalCents: roomsTotalCents,
                },
              }
            : {}),
        }));
      await db.query(
        `UPDATE refunds SET status = 'succeeded', stripe_refund_id = $1 WHERE id = $2 AND status <> 'succeeded'`,
        [refund.id, row.id],
      );
      succeeded = { stripeRefundId: refund.id };
      results.push({ reservationId: row.reservationId, amountCents: row.amountCents, status: "succeeded" });
    } catch (error) {
      const status = (deps.isDefiniteFailure ?? (() => true))(error) ? "failed" : "pending";
      await db.query(`UPDATE refunds SET status = $1::payment_status WHERE id = $2 AND status <> 'succeeded'`, [
        status,
        row.id,
      ]);
      await db.query(
        `INSERT INTO audit_log (action, organization_id, detail) VALUES ($1, $2, $3::jsonb)`,
        [
          status === "failed" ? "refund.failed" : "refund.uncertain",
          booking.organization_id,
          JSON.stringify({ bookingId: booking.id, refundId: row.id, amountCents: row.amountCents, error: String(error) }),
        ],
      );
      await recordEventSafely(db, {
        bookingId: booking.id,
        reservationId: row.reservationId,
        kind: status === "failed" ? "refund_failed" : "refund_uncertain",
        actor: SYSTEM,
        data: refundData(actor, { refundId: row.id, amountCents: row.amountCents, error: String(error) }),
      });
      deps.onRefundProblem?.({ bookingId: booking.id, refundId: row.id, status, error });
      results.push({ reservationId: row.reservationId, amountCents: row.amountCents, status });
    }
    if (succeeded) {
      await recordEventSafely(db, {
        bookingId: booking.id,
        reservationId: row.reservationId,
        kind: "refund_succeeded",
        actor: SYSTEM,
        data: refundData(actor, { refundId: row.id, amountCents: row.amountCents, stripeRefundId: succeeded.stripeRefundId }),
      });
    }
  }
  return results;
}

/** What the guest paid for every room on the booking, cents. */
function bookingPaidCents(state: BookingState): number {
  return state.rooms.reduce((sum, r) => sum + roomPaidCents(r), 0);
}

/** What is left unrefunded on the whole booking, cents. */
const bookingLeftCents = (state: BookingState) => bookingPaidCents(state) - state.refundedCents;

/** The room price on the whole booking, tourist tax left out, cents: the commission's base. */
export function roomsTotalCents(rooms: Pick<RoomState, "nights">[]): number {
  return rooms.reduce((sum, r) => sum + r.nights.reduce((s, n) => s + n.priceCents, 0), 0);
}

function context(deps: LifecycleDeps) {
  return { db: deps.db ?? defaultDb, now: deps.now?.() ?? new Date() };
}

// ── Actions ───────────────────────────────────────────────────────────────────

/** What a refund would be right now, per active room, in cents. Read-only. */
export async function previewRefund(
  i: { bookingId: string; reservationIds: string[] | null; event?: RefundEvent },
  deps: Omit<LifecycleDeps, "refund"> = {},
): Promise<{ perRoom: { reservationId: string; result: RefundResult; refund: PlannedRefund["refund"] }[]; totalCents: number } | null> {
  const { db, now } = context({ ...deps, refund: async () => ({ id: "", status: "" }) });
  const event = i.event ?? { kind: "guest_cancellation", at: now };
  const actor = event.kind === "guest_cancellation" ? "guest" : "host";
  const state = await loadBookingState(db, i.bookingId, now, false, actor);
  if (!state || state.rooms.length === 0) return null;
  // Previewing what a guest can't do would promise a refund the cancel then refuses.
  if (actor === "guest" && !state.actions.includes("cancel")) return null;

  const left = bookingLeftCents(state);
  const plan =
    event.kind === "early_departure"
      ? planEarlyDeparture({ rooms: state.rooms, lastNightStayed: event.lastNightStayed, bookingLeftCents: left })
      : planCancellation({
          rooms: state.rooms,
          reservationIds: i.reservationIds,
          actor,
          now: event.kind === "guest_cancellation" ? event.at : now,
          bookingLeftCents: left,
        });
  if (!plan.ok) return null;
  return {
    perRoom: plan.rooms.map((r) => ({ reservationId: r.reservationId, result: r.result, refund: r.refund })),
    totalCents: plan.totalCents,
  };
}

/** Cancel some rooms, or every active one (`reservationIds: null`). */
export async function cancelRooms(
  deps: LifecycleDeps,
  i: { bookingId: string; actor: Actor; reservationIds: string[] | null },
): Promise<LifecycleResult> {
  const { db, now } = context(deps);
  const done = await db.transaction(async (tx) => {
    const state = await loadBookingState(tx, i.bookingId, now, true, i.actor.kind);
    if (!state) return { ok: false as const, error: "not_found" as const };
    if (!state.actions.includes("cancel")) return { ok: false as const, error: "not_allowed" as const };

    const plan = planCancellation({
      rooms: state.rooms,
      reservationIds: i.reservationIds,
      actor: i.actor.kind,
      now,
      bookingLeftCents: bookingLeftCents(state),
    });
    if (!plan.ok) return plan;

    await tx.query(`UPDATE reservations SET cancelled_at = $1 WHERE id = ANY($2::uuid[])`, [
      now,
      plan.rooms.map((r) => r.reservationId),
    ]);
    if (plan.cancelsBooking) {
      await tx.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = $2, cancellation_reason = $3, updated_at = NOW()
         WHERE id = $1`,
        [i.bookingId, now, i.actor.kind === "host" ? "Cancelled by the host" : "Cancelled by the guest"],
      );
    }
    const rows = await insertPlanned(tx, i.bookingId, i.actor, plan.rooms);
    const reservationIds = plan.rooms.map((r) => r.reservationId);
    await recordBookingEvent(tx, {
      bookingId: i.bookingId,
      reservationId: reservationIds.length === 1 ? reservationIds[0] : null,
      kind: "rooms_cancelled",
      actor: eventActor(i.actor),
      data: eventData(i.actor, {
        reservationIds,
        cancelsBooking: plan.cancelsBooking,
        refundTotalCents: plan.totalCents,
      }),
    });
    return {
      ok: true as const,
      booking: state.booking,
      roomsTotalCents: roomsTotalCents(state.rooms),
      rows,
      cancelled: { reservationIds, refundTotalCents: plan.totalCents, cancelsBooking: plan.cancelsBooking },
    };
  });
  if (!done.ok) return done;
  const refunds = await sendRefunds(deps, db, done.booking, done.roomsTotalCents, done.rows, false, i.actor);
  return { ok: true, refunds, cancelled: { ...done.cancelled, refundFailedCents: failedRefundTotalCents(refunds) } };
}

async function setStatus(
  deps: LifecycleDeps,
  i: { bookingId: string; actor: Actor },
  action: BookingAction,
  kind: BookingEventKind,
  update: string,
): Promise<LifecycleResult> {
  const { db, now } = context(deps);
  return db.transaction(async (tx) => {
    const state = await loadBookingState(tx, i.bookingId, now, true, i.actor.kind);
    if (!state) return { ok: false, error: "not_found" };
    if (!state.actions.includes(action)) return { ok: false, error: "not_allowed" };
    await tx.query(update, [i.bookingId, now]);
    await recordBookingEvent(tx, {
      bookingId: i.bookingId,
      kind,
      actor: eventActor(i.actor),
      data: eventData(i.actor, {}),
    });
    return { ok: true, refunds: [] };
  });
}

/** The guest arrived. */
export function markCheckedIn(deps: LifecycleDeps, i: { bookingId: string; actor: Actor }) {
  return setStatus(deps, i, "mark_checked_in", "checked_in", `UPDATE bookings SET status = 'checked_in', updated_at = $2 WHERE id = $1`);
}

/** The guest never came. Nothing is refunded, tourist tax included (decided 2026-10-30). */
export function markNoShow(deps: LifecycleDeps, i: { bookingId: string; actor: Actor }) {
  return setStatus(
    deps,
    i,
    "mark_no_show",
    "no_show",
    `UPDATE bookings SET status = 'no_show', no_show_reported_at = $2, updated_at = NOW() WHERE id = $1`,
  );
}

/** The guest left after `lastNightStayed`; each room is refunded by its tier's early-departure rule. */
export async function recordEarlyDeparture(
  deps: LifecycleDeps,
  i: { bookingId: string; actor: Actor; lastNightStayed: string },
): Promise<LifecycleResult> {
  const { db, now } = context(deps);
  const done = await db.transaction(async (tx) => {
    const state = await loadBookingState(tx, i.bookingId, now, true, i.actor.kind);
    if (!state) return { ok: false as const, error: "not_found" as const };
    if (!state.actions.includes("record_early_departure")) return { ok: false as const, error: "not_allowed" as const };

    const plan = planEarlyDeparture({
      rooms: state.rooms,
      lastNightStayed: i.lastNightStayed,
      bookingLeftCents: bookingLeftCents(state),
    });
    if (!plan.ok) return plan;

    await tx.query(
      `UPDATE bookings SET departed_early_on = $2::date, status = 'checked_in', updated_at = NOW() WHERE id = $1`,
      [i.bookingId, i.lastNightStayed],
    );
    const rows = await insertPlanned(tx, i.bookingId, i.actor, plan.rooms);
    await recordBookingEvent(tx, {
      bookingId: i.bookingId,
      kind: "early_departure",
      actor: eventActor(i.actor),
      data: eventData(i.actor, { lastNightStayed: i.lastNightStayed }),
    });
    return { ok: true as const, booking: state.booking, roomsTotalCents: roomsTotalCents(state.rooms), rows };
  });
  if (!done.ok) return done;
  return { ok: true, refunds: await sendRefunds(deps, db, done.booking, done.roomsTotalCents, done.rows, false, i.actor) };
}

/**
 * The host refunds an amount of their choosing, in cents, capped at what is
 * left unrefunded. Hosts only. Callers parse what the host typed with
 * `parseEuroInput` (@openbookings/pricing/money).
 */
export async function issueGoodwillRefund(
  deps: LifecycleDeps,
  i: { bookingId: string; actor: Actor; amountCents: number },
): Promise<LifecycleResult> {
  if (i.actor.kind !== "host") return { ok: false, error: "not_allowed" };
  // Before any query: NaN, Infinity, a fraction of a cent or a non-number here
  // is a caller bug or a tampered request, never something to plan around.
  if (typeof i.amountCents !== "number" || !Number.isSafeInteger(i.amountCents)) {
    throw new RangeError("Goodwill refund amount must be a whole number of cents");
  }
  const { db, now } = context(deps);
  const done = await db.transaction(async (tx) => {
    const state = await loadBookingState(tx, i.bookingId, now, true);
    if (!state) return { ok: false as const, error: "not_found" as const };
    if (!state.actions.includes("goodwill_refund")) return { ok: false as const, error: "not_allowed" as const };

    const plan = planGoodwill({ paidCents: bookingPaidCents(state), refundedCents: state.refundedCents, amountCents: i.amountCents });
    if (!plan.ok) return plan;

    const { rows: count } = await tx.query(
      `SELECT COUNT(*)::int AS n FROM refunds WHERE booking_id = $1 AND reason = 'goodwill'`,
      [i.bookingId],
    );
    const row = await insertRefund(tx, i.bookingId, i.actor, {
      reservationId: null,
      reason: "goodwill",
      accommodationCents: plan.amountCents,
      touristTaxCents: 0,
      key: `refund:${i.bookingId}:goodwill:${(count[0] as { n: number }).n}`,
      breakdown: { requestedCents: i.amountCents, cappedCents: plan.amountCents },
    });
    await recordBookingEvent(tx, {
      bookingId: i.bookingId,
      kind: "goodwill_refund",
      actor: eventActor(i.actor),
      data: eventData(i.actor, { requestedCents: i.amountCents, amountCents: plan.amountCents }),
    });
    return { ok: true as const, booking: state.booking, roomsTotalCents: roomsTotalCents(state.rooms), rows: [row] };
  });
  if (!done.ok) return done;
  return { ok: true, refunds: await sendRefunds(deps, db, done.booking, done.roomsTotalCents, done.rows, false, i.actor) };
}

/**
 * Send refunds that failed, or whose outcome is unknown, again. Only
 * OpenBookings' own: a row for money that left outside it is never sent. Each is first
 * looked up on Stripe (when `findRefund` is given), so one that did go through
 * is recorded rather than paid twice.
 *
 * Rows are claimed in a transaction: a `pending` row tried in the last
 * `RETRY_MIN_AGE_MS` is skipped (its send may still be in flight), and so is a
 * row another retry holds. When every open row was skipped, the answer is
 * `refund_in_progress`.
 */
export async function retryRefunds(
  deps: LifecycleDeps,
  i: { bookingId: string; via?: "admin" },
): Promise<LifecycleResult> {
  const { db, now } = context(deps);
  const state = await loadBookingState(db, i.bookingId, now);
  if (!state) return { ok: false, error: "not_found" };
  const claim = await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, reservation_id AS "reservationId", amount_cents::float8 AS "amountCents",
              accommodation_cents::float8 AS "accommodationCents", idempotency_key AS key,
              status, created_at AS "createdAt"
       FROM refunds
       WHERE booking_id = $1 AND status IN ('pending', 'failed') AND source = 'openbookings'
         AND (status = 'failed' OR COALESCE(last_attempt_at, created_at) <= $2::timestamptz - make_interval(secs => $3))
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED`,
      [i.bookingId, now, RETRY_MIN_AGE_MS / 1000],
    );
    const claimed = rows as RefundRow[];
    if (claimed.length > 0) {
      await tx.query(`UPDATE refunds SET last_attempt_at = $2::timestamptz WHERE id = ANY($1::uuid[])`, [
        claimed.map((r) => r.id),
        now,
      ]);
      return { claimed, open: true };
    }
    const { rows: open } = await tx.query(
      `SELECT 1 FROM refunds WHERE booking_id = $1 AND status IN ('pending', 'failed') AND source = 'openbookings' LIMIT 1`,
      [i.bookingId],
    );
    return { claimed, open: open.length > 0 };
  });
  if (claim.claimed.length === 0) return { ok: false, error: claim.open ? "refund_in_progress" : "nothing_to_refund" };
  return {
    ok: true,
    refunds: await sendRefunds(deps, db, state.booking, roomsTotalCents(state.rooms), claim.claimed, true, { via: i.via }),
  };
}

/**
 * The only code that changes a booking's state or records a refund.
 *
 * Every action runs the same way: lock the booking, check the action is allowed
 * right now (`allowedActions`), let `plan.ts` decide the money, write the new
 * state and a `pending` refund row per room, commit, then ask Stripe. A Stripe
 * failure never undoes the cancellation: the row is marked `failed`, and
 * `retryRefunds` sends it again with the same idempotency key, so a refund that
 * actually went through is never paid twice.
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
  roomPaid,
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
export type CancelledRooms = { reservationIds: string[]; refundTotal: number; cancelsBooking: boolean };

export type LifecycleResult =
  | {
      ok: true;
      refunds: { reservationId: string | null; amount: number; status: RefundStatus }[];
      /** Set by cancelRooms only. */
      cancelled?: CancelledRooms;
    }
  | { ok: false; error: PlanError };

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
  refunded: number;
};

export type BookingState = {
  booking: BookingRow;
  rooms: RoomState[];
  /** What may happen now. Empty for a booking without a policy snapshot (still pending). */
  actions: BookingAction[];
  /**
   * Refund rows on the whole booking so far, euros — failed and pending ones
   * included, until they are reconciled, so a cap never assumes money that
   * may already have left.
   */
  refunded: number;
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
            COALESCE((SELECT SUM(rf.amount) FROM refunds rf WHERE rf.reservation_id = res.id), 0)::float8 AS refunded
     FROM reservations res WHERE res.booking_id = $1
     ORDER BY res.created_at, res.id`,
    [bookingId],
  );
  const reservations = rows as ReservationRow[];

  const { rows: totals } = await db.query(
    `SELECT COALESCE(SUM(amount), 0)::float8 AS refunded FROM refunds WHERE booking_id = $1`,
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
        refunded: Number(r.refunded),
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

  return { booking, rooms, actions, refunded: Number((totals[0] as { refunded: number }).refunded) };
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

type RefundRow = { id: string; reservationId: string | null; amount: number; key: string };

async function insertRefund(
  tx: Queryable,
  bookingId: string,
  actor: Actor,
  r: { reservationId: string | null; reason: RefundReason; accommodation: number; touristTax: number; key: string; breakdown: unknown },
): Promise<RefundRow> {
  const { rows } = await tx.query(
    `INSERT INTO refunds
       (booking_id, reservation_id, reason, accommodation_amount, tourist_tax_amount, amount,
        breakdown, idempotency_key, created_by)
     VALUES ($1, $2, $3::refund_reason, $4, $5, $4::numeric + $5::numeric, $6::jsonb, $7, $8)
     RETURNING id, amount::float8 AS amount`,
    [bookingId, r.reservationId, r.reason, r.accommodation, r.touristTax, JSON.stringify(r.breakdown), r.key, actor.userId],
  );
  const row = rows[0] as { id: string; amount: number };
  return { id: row.id, reservationId: r.reservationId, amount: row.amount, key: r.key };
}

async function insertPlanned(tx: Queryable, bookingId: string, actor: Actor, planned: PlannedRefund[]) {
  const out: RefundRow[] = [];
  for (const p of planned) {
    // Written so NaN is skipped too (NaN <= 0 is false).
    if (!(p.refund.total > 0)) continue;
    out.push(
      await insertRefund(tx, bookingId, actor, {
        reservationId: p.reservationId,
        reason: p.reason,
        accommodation: p.refund.accommodation,
        touristTax: p.refund.touristTax,
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
 */
async function sendRefunds(
  deps: LifecycleDeps,
  db: Queryable,
  booking: BookingRow,
  rows: RefundRow[],
  retry = false,
  actor?: { via?: "admin" },
) {
  const now = deps.now?.() ?? new Date();
  const results: { reservationId: string | null; amount: number; status: RefundStatus }[] = [];
  for (const row of rows) {
    const pi = booking.stripe_payment_intent_id;
    const account = booking.stripe_account_id;
    if (!pi || !account) {
      results.push({ reservationId: row.reservationId, amount: row.amount, status: "pending" });
      continue;
    }
    let succeeded: { stripeRefundId: string } | null = null;
    try {
      const existing =
        retry && deps.findRefund
          ? await deps.findRefund({ paymentIntentId: pi, stripeAccountId: account, refundRowId: row.id })
          : null;
      const refund =
        existing ??
        (await deps.refund({
          paymentIntentId: pi,
          stripeAccountId: account,
          amountCents: Math.round(row.amount * 100),
          // After a lookup found nothing, a fresh key per window is safe; without
          // a lookup, only the original key is.
          idempotencyKey:
            retry && deps.findRefund ? `${row.key}:r${Math.floor(now.getTime() / RETRY_KEY_WINDOW_MS)}` : row.key,
          metadata: { bookingId: booking.id, refundId: row.id },
        }));
      await db.query(
        `UPDATE refunds SET status = 'succeeded', stripe_refund_id = $1 WHERE id = $2 AND status <> 'succeeded'`,
        [refund.id, row.id],
      );
      succeeded = { stripeRefundId: refund.id };
      results.push({ reservationId: row.reservationId, amount: row.amount, status: "succeeded" });
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
          JSON.stringify({ bookingId: booking.id, refundId: row.id, amount: row.amount, error: String(error) }),
        ],
      );
      await recordEventSafely(db, {
        bookingId: booking.id,
        reservationId: row.reservationId,
        kind: status === "failed" ? "refund_failed" : "refund_uncertain",
        actor: SYSTEM,
        data: refundData(actor, { refundId: row.id, amount: row.amount, error: String(error) }),
      });
      deps.onRefundProblem?.({ bookingId: booking.id, refundId: row.id, status, error });
      results.push({ reservationId: row.reservationId, amount: row.amount, status });
    }
    if (succeeded) {
      await recordEventSafely(db, {
        bookingId: booking.id,
        reservationId: row.reservationId,
        kind: "refund_succeeded",
        actor: SYSTEM,
        data: refundData(actor, { refundId: row.id, amount: row.amount, stripeRefundId: succeeded.stripeRefundId }),
      });
    }
  }
  return results;
}

/** What the guest paid for every room on the booking, euros. */
function bookingPaid(state: BookingState): number {
  return state.rooms.reduce((sum, r) => sum + Math.round(roomPaid(r) * 100), 0) / 100;
}

function context(deps: LifecycleDeps) {
  return { db: deps.db ?? defaultDb, now: deps.now?.() ?? new Date() };
}

// ── Actions ───────────────────────────────────────────────────────────────────

/** What a refund would be right now, per active room. Read-only. */
export async function previewRefund(
  i: { bookingId: string; reservationIds: string[] | null; event?: RefundEvent },
  deps: Omit<LifecycleDeps, "refund"> = {},
): Promise<{ perRoom: { reservationId: string; result: RefundResult; refund: PlannedRefund["refund"] }[]; total: number } | null> {
  const { db, now } = context({ ...deps, refund: async () => ({ id: "", status: "" }) });
  const event = i.event ?? { kind: "guest_cancellation", at: now };
  const actor = event.kind === "guest_cancellation" ? "guest" : "host";
  const state = await loadBookingState(db, i.bookingId, now, false, actor);
  if (!state || state.rooms.length === 0) return null;
  // Previewing what a guest can't do would promise a refund the cancel then refuses.
  if (actor === "guest" && !state.actions.includes("cancel")) return null;

  const bookingLeft = bookingPaid(state) - state.refunded;
  const plan =
    event.kind === "early_departure"
      ? planEarlyDeparture({ rooms: state.rooms, lastNightStayed: event.lastNightStayed, bookingLeft })
      : planCancellation({
          rooms: state.rooms,
          reservationIds: i.reservationIds,
          actor,
          now: event.kind === "guest_cancellation" ? event.at : now,
          bookingLeft,
        });
  if (!plan.ok) return null;
  return {
    perRoom: plan.rooms.map((r) => ({ reservationId: r.reservationId, result: r.result, refund: r.refund })),
    total: plan.totalCents / 100,
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
      bookingLeft: bookingPaid(state) - state.refunded,
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
        refundTotal: plan.totalCents / 100,
      }),
    });
    return {
      ok: true as const,
      booking: state.booking,
      rows,
      cancelled: { reservationIds, refundTotal: plan.totalCents / 100, cancelsBooking: plan.cancelsBooking },
    };
  });
  if (!done.ok) return done;
  return {
    ok: true,
    refunds: await sendRefunds(deps, db, done.booking, done.rows, false, i.actor),
    cancelled: done.cancelled,
  };
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
      bookingLeft: bookingPaid(state) - state.refunded,
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
    return { ok: true as const, booking: state.booking, rows };
  });
  if (!done.ok) return done;
  return { ok: true, refunds: await sendRefunds(deps, db, done.booking, done.rows, false, i.actor) };
}

/** The host refunds an amount of their choosing, capped at what is left unrefunded. Hosts only. */
export async function issueGoodwillRefund(
  deps: LifecycleDeps,
  i: { bookingId: string; actor: Actor; amount: number },
): Promise<LifecycleResult> {
  if (i.actor.kind !== "host") return { ok: false, error: "not_allowed" };
  // Before any query: a NaN/Infinity/non-number here is a caller bug or a
  // tampered request, never something to plan around (see planGoodwill).
  if (typeof i.amount !== "number" || !Number.isFinite(i.amount)) {
    throw new RangeError("Goodwill refund amount must be a finite number");
  }
  const { db, now } = context(deps);
  const done = await db.transaction(async (tx) => {
    const state = await loadBookingState(tx, i.bookingId, now, true);
    if (!state) return { ok: false as const, error: "not_found" as const };
    if (!state.actions.includes("goodwill_refund")) return { ok: false as const, error: "not_allowed" as const };

    const plan = planGoodwill({ paid: bookingPaid(state), refunded: state.refunded, amount: i.amount });
    if (!plan.ok) return plan;

    const { rows: count } = await tx.query(
      `SELECT COUNT(*)::int AS n FROM refunds WHERE booking_id = $1 AND reason = 'goodwill'`,
      [i.bookingId],
    );
    const row = await insertRefund(tx, i.bookingId, i.actor, {
      reservationId: null,
      reason: "goodwill",
      accommodation: plan.amount,
      touristTax: 0,
      key: `refund:${i.bookingId}:goodwill:${(count[0] as { n: number }).n}`,
      breakdown: { requested: i.amount, capped: plan.amount },
    });
    await recordBookingEvent(tx, {
      bookingId: i.bookingId,
      kind: "goodwill_refund",
      actor: eventActor(i.actor),
      data: eventData(i.actor, { requested: i.amount, amount: plan.amount }),
    });
    return { ok: true as const, booking: state.booking, rows: [row] };
  });
  if (!done.ok) return done;
  return { ok: true, refunds: await sendRefunds(deps, db, done.booking, done.rows, false, i.actor) };
}

/**
 * Send refunds that failed, or whose outcome is unknown, again. Each is first
 * looked up on Stripe (when `findRefund` is given), so one that did go through
 * is recorded rather than paid twice.
 */
export async function retryRefunds(
  deps: LifecycleDeps,
  i: { bookingId: string; via?: "admin" },
): Promise<LifecycleResult> {
  const { db, now } = context(deps);
  const state = await loadBookingState(db, i.bookingId, now);
  if (!state) return { ok: false, error: "not_found" };
  const { rows } = await db.query(
    `SELECT id, reservation_id AS "reservationId", amount::float8 AS amount, idempotency_key AS key
     FROM refunds WHERE booking_id = $1 AND status IN ('pending', 'failed') ORDER BY created_at`,
    [i.bookingId],
  );
  if (rows.length === 0) return { ok: false, error: "nothing_to_refund" };
  return { ok: true, refunds: await sendRefunds(deps, db, state.booking, rows as RefundRow[], true, { via: i.via }) };
}

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { loadBookingEvents, type BookingEventKind } from "../booking-events";
import { confirmBookingPolicy } from "../reservation-policy";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";
import {
  cancelRooms,
  issueGoodwillRefund,
  markCheckedIn,
  markNoShow,
  recordEarlyDeparture,
  retryRefunds,
  type LifecycleDb,
  type LifecycleDeps,
  type RefundFn,
} from "./index";

const DAY = 86_400_000;
/** Flex, check-in 2031-11-10 15:00 Amsterdam; "now" is ten days before. */
const CHECK_IN = "2031-11-10";
const CHECK_IN_AT = Date.parse("2031-11-10T14:00:00Z");
const TEN_DAYS_BEFORE = new Date(CHECK_IN_AT - 10 * DAY);

describeWithDb("booking lifecycle against Postgres", () => {
  let db: Client;
  let calls: Parameters<RefundFn>[0][];
  let refund: RefundFn;
  let bookingId: string;
  let reservationIds: string[];
  const guest = { kind: "guest" as const, userId: "test-guest" };
  const host = { kind: "host" as const, userId: "test-host" };

  const lifecycleDb = (): LifecycleDb => ({
    query: (text, values) => db.query(text, values as unknown[]),
    transaction: async (fn) => {
      await db.query("SAVEPOINT lifecycle");
      try {
        const out = await fn({ query: (text, values) => db.query(text, values as unknown[]) });
        await db.query("RELEASE SAVEPOINT lifecycle");
        return out;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT lifecycle");
        throw error;
      }
    },
  });
  const deps = (now = TEN_DAYS_BEFORE): LifecycleDeps => ({ refund, now: () => now, db: lifecycleDb() });
  const one = async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0] as T;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    calls = [];
    refund = async (i) => {
      calls.push(i);
      return { id: `re_${calls.length}`, status: "succeeded" };
    };
    // Two rooms, €100 × 3 nights each, €3 tourist tax a night: €309 a room.
    const ids = await seedProperty(db, { tier: "flex" });
    await db.query(`UPDATE properties SET stripe_account_id = $2 WHERE id = $1`, [ids.propertyId, `acct_${crypto.randomUUID()}`]);
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges) VALUES ($1, '2026-01-01', $2::jsonb)`,
      [ids.propertyId, JSON.stringify([{ kind: "fixed", amount: 3, perPerson: false, perNight: true, perRoom: true }])],
    );
    ({ bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 3, rooms: 2 }));
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date(CHECK_IN_AT - 40 * DAY) });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("a guest cancelling one room refunds that room and keeps the booking", async () => {
    const result = await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    expect(result).toEqual({
      ok: true,
      refunds: [{ reservationId: reservationIds[0], amount: 309, status: "succeeded" }],
      cancelled: { reservationIds: [reservationIds[0]], refundTotal: 309, cancelsBooking: false },
    });
    expect(calls.map((c) => c.amountCents)).toEqual([30_900]);

    const res = await one<{ cancelled_at: Date | null }>(`SELECT cancelled_at FROM reservations WHERE id = $1`, [reservationIds[0]]);
    expect(res.cancelled_at).not.toBeNull();
    expect((await one<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId])).status).toBe("confirmed");
    const row = await one<{ status: string; stripe_refund_id: string }>(
      `SELECT status, stripe_refund_id FROM refunds WHERE reservation_id = $1`,
      [reservationIds[0]],
    );
    expect(row).toEqual({ status: "succeeded", stripe_refund_id: "re_1" });
  });

  test("a booking converted from an intent is refunded on the account that was charged", async () => {
    // Demo hotels have no account of their own; they charge on the platform's fallback.
    const property = await one<{ hotel_id: string }>(`SELECT hotel_id FROM bookings WHERE id = $1`, [bookingId]);
    await db.query(`UPDATE properties SET stripe_account_id = NULL WHERE id = $1`, [property.hotel_id]);
    await db.query(
      `INSERT INTO booking_intents
         (user_id, property_id, check_in_date, check_out_date, status, hold_expires_at, snapshot,
          total_amount, payment_account_id, booking_id)
       SELECT b.user_id, b.hotel_id, b.check_in_date, b.check_out_date, 'paid', NOW(), '{}'::jsonb,
              618, 'acct_charged', b.id
         FROM bookings b WHERE b.id = $1`,
      [bookingId],
    );
    const result = await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    expect(result.ok && result.refunds.map((r) => r.status)).toEqual(["succeeded"]);
    expect(calls.map((c) => c.stripeAccountId)).toEqual(["acct_charged"]);
  });

  test("a booking without an intent is refunded on the property's account", async () => {
    const property = await one<{ stripe_account_id: string }>(
      `SELECT p.stripe_account_id FROM bookings b JOIN properties p ON p.id = b.hotel_id WHERE b.id = $1`,
      [bookingId],
    );
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    expect(calls.map((c) => c.stripeAccountId)).toEqual([property.stripe_account_id]);
  });

  test("cancelling the same room twice refunds once", async () => {
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    const again = await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    expect(again).toEqual({ ok: false, error: "already_cancelled" });
    expect(calls).toHaveLength(1);
    expect((await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM refunds WHERE booking_id = $1`, [bookingId])).n).toBe(1);
  });

  test("cancelling the last room cancels the booking", async () => {
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: null });
    expect((await one<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId])).status).toBe("cancelled");
  });

  test("a host cancellation refunds every room in full, one Stripe refund per room", async () => {
    const late = new Date(CHECK_IN_AT - 2 * 3_600_000);
    const result = await cancelRooms(deps(late), { bookingId, actor: host, reservationIds: null });
    expect(result.ok && result.refunds.map((r) => r.amount)).toEqual([309, 309]);
    expect(calls.map((c) => c.amountCents)).toEqual([30_900, 30_900]);
    expect(new Set(calls.map((c) => c.idempotencyKey)).size).toBe(2);
  });

  test("a no-show can't be marked before the arrival window closes, and moves no money after", async () => {
    expect(await markNoShow(deps(), { bookingId, actor: host })).toEqual({ ok: false, error: "not_allowed" });

    const afterWindow = new Date(CHECK_IN_AT + 12 * 3_600_000);
    expect(await markNoShow(deps(afterWindow), { bookingId, actor: host })).toEqual({ ok: true, refunds: [] });
    expect((await one<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [bookingId])).status).toBe("no_show");
    expect((await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM refunds WHERE booking_id = $1`, [bookingId])).n).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("goodwill is capped at what was paid, and a second one has nothing left", async () => {
    const first = await issueGoodwillRefund(deps(), { bookingId, actor: host, amount: 10_000 });
    expect(first.ok && first.refunds[0].amount).toBe(618);
    expect(await issueGoodwillRefund(deps(), { bookingId, actor: host, amount: 10 })).toEqual({
      ok: false,
      error: "nothing_to_refund",
    });
  });

  test("a guest can't give goodwill", async () => {
    expect(await issueGoodwillRefund(deps(), { bookingId, actor: guest, amount: 10 })).toEqual({
      ok: false,
      error: "not_allowed",
    });
  });

  test("a Stripe failure keeps the cancellation, marks the refund failed, and a retry sends the same key", async () => {
    refund = async (i) => {
      calls.push(i);
      throw new Error("card_declined");
    };
    const result = await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    expect(result.ok && result.refunds[0].status).toBe("failed");
    expect((await one<{ status: string }>(`SELECT status FROM refunds WHERE reservation_id = $1`, [reservationIds[0]])).status).toBe(
      "failed",
    );

    refund = async (i) => {
      calls.push(i);
      return { id: "re_retry", status: "succeeded" };
    };
    const retried = await retryRefunds(deps(), { bookingId });
    expect(retried.ok && retried.refunds[0].status).toBe("succeeded");
    expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
  });

  test("a retry while the original send is in flight reuses the original key", async () => {
    refund = async (i) => {
      calls.push(i);
      throw new Error("socket hang up");
    };
    await cancelRooms({ ...deps(), isDefiniteFailure: () => false }, { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    // Last tried ten minutes ago on the test's clock, so the retry is allowed.
    // created_at moves with it, so the row is still inside Stripe's key retention.
    await db.query(
      `UPDATE refunds
          SET last_attempt_at = $2::timestamptz - interval '10 minutes',
              created_at = $2::timestamptz - interval '10 minutes'
        WHERE reservation_id = $1`,
      [reservationIds[0], TEN_DAYS_BEFORE],
    );

    refund = async (i) => {
      calls.push(i);
      return { id: "re_retry", status: "succeeded" };
    };
    const retried = await retryRefunds({ ...deps(), findRefund: async () => null }, { bookingId });
    expect(retried.ok && retried.refunds[0].status).toBe("succeeded");
    expect(calls).toHaveLength(2);
    expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
  });

  test("a pending refund attempted moments ago is not re-sent", async () => {
    refund = async (i) => {
      calls.push(i);
      throw new Error("socket hang up");
    };
    await cancelRooms({ ...deps(), isDefiniteFailure: () => false }, { bookingId, actor: guest, reservationIds: [reservationIds[0]] });

    const retried = await retryRefunds({ ...deps(), findRefund: async () => null }, { bookingId });
    expect(retried).toEqual({ ok: false, error: "refund_in_progress" });
    expect(calls).toHaveLength(1);
  });

  test("a concurrent send on the same key leaves the refund pending, not failed", async () => {
    // Stripe's 409 when another request with the same key is still being processed.
    refund = async (i) => {
      calls.push(i);
      throw Object.assign(new Error("idempotency_key_in_use"), {
        type: "StripeIdempotencyError",
        code: "idempotency_key_in_use",
        statusCode: 409,
      });
    };
    // The classification @openbookings/stripe's isDefiniteRefundFailure makes
    // (packages/stripe/src/payments/refund.ts); this package does not depend on it.
    const isDefiniteFailure = (error: unknown) => {
      const e = error as { type?: string; code?: string };
      if (e.type === "StripeIdempotencyError" || e.code === "idempotency_key_in_use") return false;
      return ["StripeInvalidRequestError", "StripeCardError", "StripePermissionError", "StripeAuthenticationError"].includes(
        e.type ?? "",
      );
    };
    const result = await cancelRooms({ ...deps(), isDefiniteFailure }, { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    expect(result.ok && result.refunds[0].status).toBe("pending");
    expect((await one<{ status: string }>(`SELECT status FROM refunds WHERE reservation_id = $1`, [reservationIds[0]])).status).toBe(
      "pending",
    );
  });

  test("each refund row is stamped when its own Stripe call starts", async () => {
    // A clock that moves a minute every time it is read.
    let ticks = 0;
    const clock = () => new Date(TEN_DAYS_BEFORE.getTime() + ticks++ * 60_000);
    await cancelRooms({ ...deps(), now: clock }, { bookingId, actor: host, reservationIds: null });
    const stamps = (
      await db.query(`SELECT last_attempt_at FROM refunds WHERE booking_id = $1 ORDER BY last_attempt_at`, [bookingId])
    ).rows as { last_attempt_at: Date }[];
    expect(stamps).toHaveLength(2);
    expect(stamps[1].last_attempt_at.getTime()).toBeGreaterThan(stamps[0].last_attempt_at.getTime());
  });

  test("a definitively failed refund is re-sent under a fresh key after a lookup miss", async () => {
    refund = async (i) => {
      calls.push(i);
      throw new Error("card_declined");
    };
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });

    refund = async (i) => {
      calls.push(i);
      return { id: "re_retry", status: "succeeded" };
    };
    const retried = await retryRefunds({ ...deps(), findRefund: async () => null }, { bookingId });
    expect(retried.ok && retried.refunds[0].status).toBe("succeeded");
    expect(calls).toHaveLength(2);
    expect(calls[1].idempotencyKey).toMatch(/:r\d+$/);
  });

  test("goodwill first, then a host cancellation: never more than was paid in total", async () => {
    await issueGoodwillRefund(deps(), { bookingId, actor: host, amount: 500 });
    await cancelRooms(deps(), { bookingId, actor: host, reservationIds: null });
    const total = await one<{ total: number }>(
      `SELECT SUM(amount)::float8 AS total FROM refunds WHERE booking_id = $1`,
      [bookingId],
    );
    expect(total.total).toBe(618);
  });

  test("a timeout leaves the refund pending and audited; a retry finds it on Stripe instead of paying again", async () => {
    refund = async (i) => {
      calls.push(i);
      throw new Error("socket hang up");
    };
    const problems: unknown[] = [];
    const uncertain = { ...deps(), isDefiniteFailure: () => false, onRefundProblem: (p: unknown) => problems.push(p) };
    const result = await cancelRooms(uncertain, { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    expect(result.ok && result.refunds[0].status).toBe("pending");
    expect(problems).toHaveLength(1);
    const audit = await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'refund.uncertain' AND detail->>'bookingId' = $1`,
      [bookingId],
    );
    expect(audit.n).toBe(1);

    // Ten minutes later: a pending row tried moments ago is left to its original send.
    const retried = await retryRefunds(
      { ...deps(new Date(TEN_DAYS_BEFORE.getTime() + 10 * 60_000)), findRefund: async () => ({ id: "re_already" }) },
      { bookingId },
    );
    expect(retried.ok && retried.refunds[0].status).toBe("succeeded");
    expect(calls).toHaveLength(1);
    expect(
      (await one<{ stripe_refund_id: string }>(`SELECT stripe_refund_id FROM refunds WHERE reservation_id = $1`, [reservationIds[0]]))
        .stripe_refund_id,
    ).toBe("re_already");
  });

  test("a guest can't cancel once check-in time has passed", async () => {
    const afterCheckIn = new Date(CHECK_IN_AT + 3_600_000);
    expect(await cancelRooms(deps(afterCheckIn), { bookingId, actor: guest, reservationIds: null })).toEqual({
      ok: false,
      error: "not_allowed",
    });
  });
  test("cancel writes rooms_cancelled and refund_succeeded", async () => {
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: null });
    const events = (await loadBookingEvents(db, bookingId)).filter((e) => e.kind !== "confirmed");
    expect(events.map((e) => e.kind)).toEqual(["rooms_cancelled", ...reservationIds.map(() => "refund_succeeded")] as BookingEventKind[]);
    expect(events[0].actorKind).toBe("guest");
    expect(events[0].actorId).toBe("test-guest");
    expect(events[0].data.cancelsBooking).toBe(true);
    expect(events[1].actorKind).toBe("system");
    expect(events.slice(1).map((e) => e.reservationId).sort()).toEqual([...reservationIds].sort());
  });

  test("no-show writes no_show with via admin", async () => {
    const afterWindow = new Date(CHECK_IN_AT + 12 * 3_600_000);
    await markNoShow(deps(afterWindow), { bookingId, actor: { ...host, via: "admin" } });
    const events = (await loadBookingEvents(db, bookingId)).filter((e) => e.kind === "no_show");
    expect(events).toHaveLength(1);
    expect(events[0].actorKind).toBe("host");
    expect(events[0].data.via).toBe("admin");
  });

  test("check-in writes checked_in", async () => {
    const during = new Date(CHECK_IN_AT + 3_600_000);
    expect(await markCheckedIn(deps(during), { bookingId, actor: host })).toEqual({ ok: true, refunds: [] });
    const events = (await loadBookingEvents(db, bookingId)).filter((e) => e.kind === "checked_in");
    expect(events).toHaveLength(1);
    expect(events[0].actorKind).toBe("host");
  });

  test("early departure writes early_departure with the last night stayed", async () => {
    const during = new Date(CHECK_IN_AT + 3_600_000);
    await markCheckedIn(deps(during), { bookingId, actor: host });
    const result = await recordEarlyDeparture(deps(during), { bookingId, actor: host, lastNightStayed: "2031-11-10" });
    expect(result.ok).toBe(true);
    const events = (await loadBookingEvents(db, bookingId)).filter((e) => e.kind === "early_departure");
    expect(events).toHaveLength(1);
    expect(events[0].data.lastNightStayed).toBe("2031-11-10");
  });

  test("goodwill writes goodwill_refund with the requested and capped amount", async () => {
    await issueGoodwillRefund(deps(), { bookingId, actor: host, amount: 10_000 });
    const events = (await loadBookingEvents(db, bookingId)).filter((e) => e.kind === "goodwill_refund");
    expect(events).toHaveLength(1);
    expect(events[0].data.requested).toBe(10_000);
    expect(events[0].data.amount).toBe(618);
  });

  test("a refund Stripe refuses writes refund_failed as the system", async () => {
    refund = async () => {
      throw new Error("card_declined");
    };
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    const events = (await loadBookingEvents(db, bookingId)).filter((e) => e.kind === "refund_failed");
    expect(events).toHaveLength(1);
    expect(events[0].actorKind).toBe("system");
    expect(events[0].reservationId).toBe(reservationIds[0]);
    expect(String(events[0].data.error)).toContain("card_declined");
  });

  test("an admin retry stamps via admin on the refund outcome event", async () => {
    refund = async () => {
      throw new Error("card_declined");
    };
    await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]] });
    refund = async () => ({ id: "re_retry", status: "succeeded" });
    await retryRefunds(deps(), { bookingId, via: "admin" });
    const events = (await loadBookingEvents(db, bookingId)).filter((e) => e.kind === "refund_succeeded");
    expect(events).toHaveLength(1);
    expect(events[0].data.via).toBe("admin");
  });

  test("a refused action writes nothing", async () => {
    const afterWindow = new Date(CHECK_IN_AT + 12 * 3_600_000);
    expect(await markNoShow(deps(afterWindow), { bookingId, actor: guest })).toEqual({ ok: false, error: "not_allowed" });
    expect((await loadBookingEvents(db, bookingId)).filter((e) => e.kind !== "confirmed")).toEqual([]);
  });

  test("confirming writes confirmed once", async () => {
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date(CHECK_IN_AT - 40 * DAY) });
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date(CHECK_IN_AT - 40 * DAY) });
    expect((await loadBookingEvents(db, bookingId)).filter((e) => e.kind === "confirmed")).toHaveLength(1);
  });

  test("a failing event insert after the refund never changes the refund outcome", async () => {
    const base = lifecycleDb();
    const failing: LifecycleDb = {
      ...base,
      query: (text, values) =>
        text.includes("INSERT INTO booking_events") ? Promise.reject(new Error("events down")) : base.query(text, values),
    };
    const errors = console.error;
    console.error = () => {};
    try {
      const result = await cancelRooms({ ...deps(), db: failing }, { bookingId, actor: guest, reservationIds: null });
      expect(result.ok && result.refunds.map((r) => r.status)).toEqual(reservationIds.map(() => "succeeded"));
    } finally {
      console.error = errors;
    }
    expect(calls).toHaveLength(reservationIds.length);
    const statuses = (await db.query(`SELECT status FROM refunds WHERE booking_id = $1`, [bookingId])).rows as { status: string }[];
    expect(statuses.map((r) => r.status)).toEqual(reservationIds.map(() => "succeeded"));
    const audit = await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE action IN ('refund.failed', 'refund.uncertain') AND detail->>'bookingId' = $1`,
      [bookingId],
    );
    expect(audit.n).toBe(0);
  });
});

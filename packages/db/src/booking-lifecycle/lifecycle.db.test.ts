import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { confirmBookingPolicy } from "../reservation-policy";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";
import {
  cancelRooms,
  issueGoodwillRefund,
  markNoShow,
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
    expect(result).toEqual({ ok: true, refunds: [{ reservationId: reservationIds[0], amount: 309, status: "succeeded" }] });
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
});

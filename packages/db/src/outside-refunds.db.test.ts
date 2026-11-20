import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { loadBookingEvents } from "./booking-events";
import { cancelRooms, issueGoodwillRefund, retryRefunds, type LifecycleDb, type RefundFn } from "./booking-lifecycle";
import { loadOutsideRefunds, recordOutsideRefund, type OutsideRefundInput } from "./outside-refunds";
import { confirmBookingPolicy } from "./reservation-policy";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "./testing/db-harness";

const DAY = 86_400_000;
const CHECK_IN = "2031-11-10";
const CHECK_IN_AT = Date.parse("2031-11-10T14:00:00Z");
const TEN_DAYS_BEFORE = new Date(CHECK_IN_AT - 10 * DAY);

describeWithDb("outside refunds on the booking", () => {
  let db: Client;
  let calls: Parameters<RefundFn>[0][];
  let bookingId: string;
  let reservationIds: string[];
  let pi: string;

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
  const refund: RefundFn = async (i) => {
    calls.push(i);
    return { id: `re_ob_${calls.length}`, status: "succeeded" };
  };
  const deps = () => ({ refund, now: () => TEN_DAYS_BEFORE, db: lifecycleDb() });
  const outside = (over: Partial<OutsideRefundInput> = {}): OutsideRefundInput => ({
    source: "stripe_dashboard",
    stripeId: "re_dash_1",
    paymentIntentId: pi,
    chargeId: "ch_1",
    stripeAccountId: "acct_1",
    amountCents: 10_000,
    occurredAt: new Date("2031-10-20T09:00:00Z"),
    reason: "requested_by_customer",
    ...over,
  });

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
    // Two Flex rooms, €100 × 3 nights each, €3 tourist tax a night: €309 a room, €618 paid.
    const ids = await seedProperty(db, { tier: "flex" });
    await db.query(`UPDATE properties SET stripe_account_id = $2 WHERE id = $1`, [ids.propertyId, `acct_${crypto.randomUUID()}`]);
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges) VALUES ($1, '2026-01-01', $2::jsonb)`,
      [ids.propertyId, JSON.stringify([{ kind: "fixed", amount: 3, perPerson: false, perNight: true, perRoom: true }])],
    );
    ({ bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 3, rooms: 2 }));
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date(CHECK_IN_AT - 40 * DAY) });
    pi = `pi_${crypto.randomUUID()}`;
    await db.query(`UPDATE bookings SET stripe_payment_intent_id = $2 WHERE id = $1`, [bookingId, pi]);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("a Dashboard refund is written once onto the booking, however often the webhook comes", async () => {
    const first = await recordOutsideRefund(db, outside());
    expect(first).toMatchObject({ recorded: true, bookingId, amountCents: 10_000 });
    expect(await recordOutsideRefund(db, outside())).toEqual({ recorded: false, why: "duplicate" });

    const { rows } = await db.query(
      `SELECT source, reason, status, amount::float8 AS amount, accommodation_amount::float8 AS accommodation,
              tourist_tax_amount::float8 AS tourist_tax, stripe_refund_id, idempotency_key, created_at, split_explained_at
         FROM refunds WHERE booking_id = $1`,
      [bookingId],
    );
    expect(rows).toEqual([
      {
        source: "stripe_dashboard",
        reason: null,
        status: "succeeded",
        amount: 100,
        // Unexplained: all of it counts against the room price for now.
        accommodation: 100,
        tourist_tax: 0,
        stripe_refund_id: "re_dash_1",
        idempotency_key: "stripe_dashboard:re_dash_1",
        created_at: new Date("2031-10-20T09:00:00Z"),
        split_explained_at: null,
      },
    ]);
    const events = await loadBookingEvents(db, bookingId);
    expect(events.filter((e) => e.kind === "outside_refund")).toHaveLength(1);
    expect(await loadOutsideRefunds(db, bookingId)).toEqual([
      { id: (first as { refundId: string }).refundId, source: "stripe_dashboard", amount: 100, at: new Date("2031-10-20T09:00:00Z"), split: null },
    ]);
  });

  test("a payment that paid no booking is left as a flag only", async () => {
    expect(await recordOutsideRefund(db, outside({ paymentIntentId: `pi_${crypto.randomUUID()}` }))).toEqual({
      recorded: false,
      why: "no_booking",
    });
    expect(await recordOutsideRefund(db, outside({ paymentIntentId: null }))).toEqual({ recorded: false, why: "no_booking" });
  });

  test("a lost dispute takes only what was still on the booking", async () => {
    await recordOutsideRefund(db, outside({ amountCents: 50_000 }));
    const dispute = await recordOutsideRefund(db, outside({ source: "dispute", stripeId: "dp_1", amountCents: 61_800 }));
    expect(dispute).toMatchObject({ recorded: true, amountCents: 11_800 });
    const row = (
      await db.query(`SELECT stripe_refund_id, breakdown FROM refunds WHERE idempotency_key = 'dispute:dp_1'`)
    ).rows[0] as { stripe_refund_id: string | null; breakdown: { stripeAmount: number } };
    expect(row.stripe_refund_id).toBeNull();
    expect(row.breakdown.stripeAmount).toBe(61_800);
    // Nothing left: a further one is not written.
    expect(await recordOutsideRefund(db, outside({ source: "dispute", stripeId: "dp_2" }))).toEqual({
      recorded: false,
      why: "nothing_left",
    });
  });

  test("OpenBookings' own refunds afterwards are capped at what the host did not already give back", async () => {
    await recordOutsideRefund(db, outside({ amountCents: 50_000 }));
    const result = await cancelRooms(deps(), { bookingId, actor: { kind: "host", userId: "h" }, reservationIds: null });
    // €618 paid, €500 refunded in the Dashboard: €118 is all Stripe still holds.
    expect(result.ok && result.cancelled?.refundTotal).toBe(118);
    expect(calls.map((c) => c.amountCents)).toEqual([11_800]);

    const goodwill = await issueGoodwillRefund(deps(), { bookingId, actor: { kind: "host", userId: "h" }, amount: 10 });
    expect(goodwill).toEqual({ ok: false, error: "nothing_to_refund" });
  });

  test("a goodwill refund after a Dashboard refund is capped too", async () => {
    await recordOutsideRefund(db, outside({ amountCents: 60_000 }));
    const result = await issueGoodwillRefund(deps(), { bookingId, actor: { kind: "host", userId: "h" }, amount: 100 });
    expect(result.ok && result.refunds.map((r) => r.amount)).toEqual([18]);
  });

  test("a retry never sends an outside row to Stripe", async () => {
    await recordOutsideRefund(db, outside());
    // Even one forced to failed by hand.
    await db.query(`UPDATE refunds SET status = 'failed' WHERE booking_id = $1`, [bookingId]);
    expect(await retryRefunds(deps(), { bookingId })).toEqual({ ok: false, error: "nothing_to_refund" });
    expect(calls).toEqual([]);
  });

  test("the database refuses an outside row with a reason", async () => {
    await expect(
      db.query(
        `INSERT INTO refunds (booking_id, reason, source, accommodation_amount, tourist_tax_amount, amount, idempotency_key)
         VALUES ($1, 'goodwill', 'dispute', 1, 0, 1, 'x:1')`,
        [bookingId],
      ),
    ).rejects.toThrow("refunds_reason_by_source");
  });
});

/**
 * One payable session per intent. Stripe is faked; the intent rows are real.
 * Every test runs in a transaction that is rolled back; skipped locally
 * without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { Client } from "pg";
import { createBookingIntent, type IntentRoomInput, type Queryable } from "@openbookings/db";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedGuest,
  seedProperty,
} from "@openbookings/db/testing";
import { openIntentSession, type IntentSessionDeps, type PaymentSession } from "./intent-session";

const NOW = new Date("2031-10-01T10:00:00Z");
const MINUTE = 60_000;

describeWithDb("payment session of a booking intent", () => {
  let db: Client;
  let guest: string;
  let intentId: string;

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
    const ids = await seedProperty(db);
    guest = await seedGuest(db);
    const room: IntentRoomInput = {
      roomId: ids.roomId,
      ratePlanId: ids.ratePlanId,
      adults: 2,
      children: 0,
      infants: 0,
      cots: 0,
      extraBeds: 0,
      payAtProperty: 0,
      discount: null,
      rateNights: [{ date: "2031-11-10", price: 100 }],
      extraGuests: [],
      payAtPropertyLines: [],
      nights: [{ date: "2031-11-10", price: 100 }],
      stayTotal: 100,
      touristTax: 0,
      touristTaxLines: [],
      vatSplit: null,
    };
    const query = (text: string, values?: unknown[]) => db.query(text, values);
    const created = await createBookingIntent(
      {
        query,
        transaction: async (fn) => {
          await db.query("SAVEPOINT intent");
          const out = await fn({ query });
          await db.query("RELEASE SAVEPOINT intent");
          return out;
        },
      },
      {
        userId: guest,
        propertyId: ids.propertyId,
        checkIn: "2031-11-10",
        checkOut: "2031-11-11",
        rooms: [room],
        snapshot: {
          roomsTotal: 100,
          touristTaxTotal: 0,
          total: 100,
          commissionCents: 0,
          commissionRate: 0.1,
          commissionVatTreatment: null,
          commissionNetCents: null,
          commissionVatCents: null,
          currency: "EUR",
          rooms: [
            { roomId: ids.roomId, ratePlanId: ids.ratePlanId, roomName: "Double", ratePlanName: "Room only", isRefundable: true, freeCancellationUntil: null },
          ],
        },
        now: NOW,
      },
    );
    if (!created.ok) throw new Error("intent not created");
    intentId = created.intentId;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const NEW: PaymentSession & { amountTotal: number } = {
    id: "cs_new",
    clientSecret: "cs_new_secret",
    expiresAt: 1_900_000_000,
    amountTotal: 10000,
  };

  /** Fake Stripe around the test's own connection; `create` may run SQL first, as a racing request would. */
  function deps(over: { retrieved?: string | null; noSecret?: boolean; beforeCreate?: string } = {}) {
    const retrieve = mock<IntentSessionDeps["retrieve"]>(async () => ({
      status: over.retrieved ?? null,
      clientSecret: over.retrieved === "open" && !over.noSecret ? "cs_old_secret" : null,
      expiresAt: 1_800_000_000,
    }));
    const create = mock(async () => {
      if (over.beforeCreate) await db.query(over.beforeCreate, [intentId]);
      return NEW;
    });
    const expire = mock<IntentSessionDeps["expire"]>(async () => {});
    const report = mock<IntentSessionDeps["report"]>(() => {});
    const tx: Queryable = { query: (text, values) => db.query(text, values) };
    const d: IntentSessionDeps = { transaction: (fn) => fn(tx), retrieve, create, expire, report };
    return { d, retrieve, create, expire, report };
  }

  const open = (d: IntentSessionDeps, over: { userId?: string; now?: Date } = {}) =>
    openIntentSession(d, { intentId, userId: over.userId ?? guest, accountId: "acct_host", now: over.now ?? NOW });

  async function stored() {
    const { rows } = await db.query(`SELECT payment_session_id, payment_account_id FROM booking_intents WHERE id = $1`, [
      intentId,
    ]);
    return rows[0] as { payment_session_id: string | null; payment_account_id: string | null };
  }

  const attachOld = () =>
    db.query(`UPDATE booking_intents SET payment_session_id = 'cs_old', payment_account_id = 'acct_old' WHERE id = $1`, [
      intentId,
    ]);

  test("an intent without a session gets a new one, recorded on the intent", async () => {
    const { d, create, retrieve } = deps();
    expect(await open(d)).toEqual({ ok: true, reused: false, session: NEW });
    expect(create).toHaveBeenCalledTimes(1);
    expect(retrieve).not.toHaveBeenCalled();
    expect(await stored()).toEqual({ payment_session_id: "cs_new", payment_account_id: "acct_host" });
  });

  test("a session Stripe still has open is handed back instead of making a second", async () => {
    await attachOld();
    const { d, create, retrieve } = deps({ retrieved: "open" });
    expect(await open(d)).toEqual({
      ok: true,
      reused: true,
      session: { id: "cs_old", clientSecret: "cs_old_secret", expiresAt: 1_800_000_000 },
    });
    expect(retrieve.mock.calls[0]).toEqual(["cs_old", "acct_old"]);
    expect(create).not.toHaveBeenCalled();
  });

  test("an expired session is replaced", async () => {
    await attachOld();
    const { d, create } = deps({ retrieved: "expired" });
    expect(await open(d)).toMatchObject({ ok: true, reused: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect((await stored()).payment_session_id).toBe("cs_new");
  });

  test("a completed session is never followed by another", async () => {
    await attachOld();
    const { d, create } = deps({ retrieved: "complete" });
    expect(await open(d)).toEqual({ ok: false, code: "already_paid" });
    expect(create).not.toHaveBeenCalled();
  });

  test("an open session without a client secret is expired before another is made", async () => {
    await attachOld();
    const { d, create, expire } = deps({ retrieved: "open", noSecret: true });
    const order: string[] = [];
    expire.mockImplementation(async (id) => void order.push(`expire ${id}`));
    create.mockImplementation(async () => (order.push("create"), NEW));
    expect(await open(d)).toEqual({ ok: true, reused: false, session: NEW });
    expect(expire.mock.calls).toEqual([["cs_old", "acct_old"]]);
    expect(order).toEqual(["expire cs_old", "create"]);
    expect((await stored()).payment_session_id).toBe("cs_new");
  });

  test("when that old session cannot be expired, no second one is made", async () => {
    await attachOld();
    const { d, create, expire } = deps({ retrieved: "open", noSecret: true });
    expire.mockImplementation(async () => {
      throw new Error("socket hang up");
    });
    await expect(open(d)).rejects.toThrow("socket hang up");
    expect(create).not.toHaveBeenCalled();
    expect((await stored()).payment_session_id).toBe("cs_old");
  });

  test("a paid intent is answered as paid, never as a lapsed hold", async () => {
    await db.query(`UPDATE booking_intents SET status = 'paid' WHERE id = $1`, [intentId]);
    const { d, create, retrieve } = deps();
    expect(await open(d)).toEqual({ ok: false, code: "already_paid" });
    expect(create).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  test("an oversold intent is answered as oversold, before or after its refund", async () => {
    for (const status of ["oversold", "refunded_oversold"]) {
      await db.query(`UPDATE booking_intents SET status = $2 WHERE id = $1`, [intentId, status]);
      const { d, create } = deps();
      expect(await open(d)).toEqual({ ok: false, code: "oversold" });
      expect(create).not.toHaveBeenCalled();
    }
  });

  test("a hold that has run out gets no session", async () => {
    const { d, create } = deps();
    expect(await open(d, { now: new Date(NOW.getTime() + 15 * MINUTE) })).toEqual({ ok: false, code: "hold_expired" });
    expect(create).not.toHaveBeenCalled();
  });

  test("an intent that is no longer open gets no session", async () => {
    await db.query(`UPDATE booking_intents SET status = 'abandoned' WHERE id = $1`, [intentId]);
    const { d, create } = deps();
    expect(await open(d)).toEqual({ ok: false, code: "hold_expired" });
    expect(create).not.toHaveBeenCalled();
  });

  test("an intent abandoned while its session was being made: that session is expired", async () => {
    const { d, expire } = deps({ beforeCreate: `UPDATE booking_intents SET status = 'abandoned' WHERE id = $1` });
    expect(await open(d)).toEqual({ ok: false, code: "hold_expired" });
    expect(expire.mock.calls).toEqual([["cs_new", "acct_host"]]);
    expect((await stored()).payment_session_id).toBeNull();
  });

  test("the guest still hears the hold lapsed when expiring that session fails; the failure is reported", async () => {
    const { d, expire, report } = deps({ beforeCreate: `UPDATE booking_intents SET status = 'abandoned' WHERE id = $1` });
    const failure = new Error("socket hang up");
    expire.mockImplementation(async () => {
      throw failure;
    });
    expect(await open(d)).toEqual({ ok: false, code: "hold_expired" });
    expect(report.mock.calls).toEqual([[failure, { sessionId: "cs_new" }]]);
  });

  test("another guest's intent is not found", async () => {
    const { d, create } = deps();
    expect(await open(d, { userId: await seedGuest(db) })).toEqual({ ok: false, code: "not_found" });
    expect(create).not.toHaveBeenCalled();
  });
});

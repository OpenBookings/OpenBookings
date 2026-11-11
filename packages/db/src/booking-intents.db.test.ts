import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { loadStayAvailability } from "./availability";
import type { LifecycleDb } from "./booking-lifecycle";
import {
  attachPaymentSession,
  createBookingIntent,
  expireIntent,
  HOLD_MINUTES,
  IntentNotOpenError,
  isCurrentPaymentSession,
  listUnsettledPayments,
  loadIntent,
  loadIntentBySession,
  markIntentFailed,
  type IntentRoomInput,
  type IntentSnapshot,
} from "./booking-intents";
import { applyPendingMigrations, connectionString, describeWithDb, seedProperty } from "./testing/db-harness";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-12"; // 2 nights
const NOW = new Date("2031-10-01T10:00:00Z");
const MINUTE = 60_000;

const room = (roomId: string, ratePlanId: string): IntentRoomInput => ({
  roomId,
  ratePlanId,
  adults: 2,
  children: 0,
  infants: 0,
  cots: 0,
  extraBeds: 0,
  payAtProperty: 0,
  discount: null,
  nights: [
    { date: "2031-11-10", price: 100 },
    { date: "2031-11-11", price: 100 },
  ],
  stayTotal: 200,
  touristTax: 6.5,
  touristTaxLines: [],
});

const snapshot = (rooms: IntentRoomInput[]): IntentSnapshot => ({
  roomsTotal: 200 * rooms.length,
  touristTaxTotal: 6.5 * rooms.length,
  total: 206.5 * rooms.length,
  commissionCents: 0,
  commissionRate: 0.1,
  commissionVatTreatment: null,
  commissionNetCents: null,
  commissionVatCents: null,
  currency: "EUR",
  rooms: rooms.map((r) => ({
    roomId: r.roomId,
    ratePlanId: r.ratePlanId,
    roomName: "Double",
    ratePlanName: "Room only",
    isRefundable: true,
    freeCancellationUntil: null,
  })),
});

/** A transaction on `client`: a savepoint inside the test's own transaction, or a real one. */
function lifecycleDb(client: Client, mode: "savepoint" | "commit"): LifecycleDb {
  const query = (text: string, values?: unknown[]) => client.query(text, values);
  const [begin, commit, rollback] =
    mode === "savepoint"
      ? ["SAVEPOINT intent", "RELEASE SAVEPOINT intent", "ROLLBACK TO SAVEPOINT intent"]
      : ["BEGIN", "COMMIT", "ROLLBACK"];
  return {
    query,
    transaction: async (fn) => {
      await client.query(begin);
      try {
        const out = await fn({ query });
        await client.query(commit);
        return out;
      } catch (error) {
        await client.query(rollback);
        throw error;
      }
    },
  };
}

describeWithDb("booking intents against Postgres", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  const guest = `test-guest-${crypto.randomUUID()}`;

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
    ids = await seedProperty(db);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const create = (userId: string, rooms = [room(ids.roomId, ids.ratePlanId)], now = NOW) =>
    createBookingIntent(lifecycleDb(db, "savepoint"), {
      userId,
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms,
      snapshot: snapshot(rooms),
      now,
    });

  const created = async (...args: Parameters<typeof create>) => {
    const result = await create(...args);
    if (!result.ok) throw new Error(`expected an intent, got ${result.error}`);
    return result;
  };

  const status = async (intentId: string) =>
    ((await db.query(`SELECT status FROM booking_intents WHERE id = $1`, [intentId])).rows[0] as { status: string }).status;

  const held = async () =>
    (await loadStayAvailability(db, { propertyId: ids.propertyId, checkIn: CHECK_IN, checkOut: CHECK_OUT, now: NOW }))[0]
      .nights.map((n) => n.held);

  describe("payments the webhook may have missed", () => {
    const realNow = new Date();
    let n = 0;
    /** An intent with a session, `ageMinutes` old, in `status`. Spaced in time so earlier holds never block later ones. */
    const intent = async (status: string, ageMinutes: number, withSession = true) => {
      const { intentId } = await created(`${guest}-${n}`, undefined, new Date(NOW.getTime() + n++ * 20 * MINUTE));
      if (withSession) await attachPaymentSession(db, { intentId, sessionId: `cs_test_${intentId}`, accountId: "acct_test" });
      await db.query(`UPDATE booking_intents SET status = $2, created_at = $3 WHERE id = $1`, [
        intentId,
        status,
        new Date(realNow.getTime() - ageMinutes * MINUTE),
      ]);
      return intentId;
    };
    const list = async (ours: string[]) =>
      (await listUnsettledPayments(db, { now: realNow, graceMinutes: 10, windowMinutes: 120, limit: 1000 }))
        .filter((p) => ours.includes(p.intentId))
        .map((p) => p.intentId);

    test("open sessions until settled; expired and abandoned ones only while recent; oldest first", async () => {
      const openOld = await intent("open", 600);
      const open = await intent("open", 60);
      const expired = await intent("expired", 30);
      const abandoned = await intent("abandoned", 40);
      const ours = [
        openOld,
        open,
        expired,
        abandoned,
        await intent("open", 2), // the webhook still has time
        await intent("expired", 300), // past anything Stripe could still do
        await intent("failed", 30),
        await intent("open", 60, false), // never reached checkout
      ];
      expect(await list(ours)).toEqual([openOld, open, abandoned, expired]);
    });

    test("each entry carries the session and the account to ask Stripe on", async () => {
      const id = await intent("open", 60);
      const [found] = (await listUnsettledPayments(db, { now: realNow, graceMinutes: 10, windowMinutes: 120, limit: 1000 }))
        .filter((p) => p.intentId === id);
      expect(found).toEqual({ intentId: id, sessionId: `cs_test_${id}`, accountId: "acct_test" });
    });

    test("only the session an intent is paying with is its current one", async () => {
      const id = await intent("open", 60);
      expect(await isCurrentPaymentSession(db, { intentId: id, sessionId: `cs_test_${id}` })).toBe(true);
      expect(await isCurrentPaymentSession(db, { intentId: id, sessionId: "cs_test_replaced" })).toBe(false);
      expect(await isCurrentPaymentSession(db, { intentId: "not-a-uuid", sessionId: `cs_test_${id}` })).toBe(false);
    });
  });

  test("hold length", async () => {
    const intent = await created(guest);
    expect(HOLD_MINUTES).toBe(15);
    expect(intent.holdExpiresAt.getTime() - NOW.getTime()).toBe(15 * MINUTE);
    const row = (await db.query(`SELECT hold_expires_at FROM booking_intents WHERE id = $1`, [intent.intentId])).rows[0];
    expect((row.hold_expires_at as Date).getTime()).toBe(intent.holdExpiresAt.getTime());
  });

  test("the intent stores what was quoted, room by room", async () => {
    const rooms = [
      room(ids.roomId, ids.ratePlanId),
      {
        ...room(ids.roomId, ids.ratePlanId),
        adults: 1,
        children: 1,
        infants: 1,
        cots: 1,
        extraBeds: 1,
        payAtProperty: 70,
        discount: { label: "Weekly discount", amount: 22.5 },
      },
    ];
    const { intentId } = await created(guest, rooms);
    const intent = await loadIntent(db, { intentId, userId: guest });
    expect(intent).not.toBeNull();
    expect(intent!.status).toBe("open");
    expect(intent!.userId).toBe(guest);
    expect(intent!.propertyId).toBe(ids.propertyId);
    expect(intent!.propertySlug).toStartWith("test-property-");
    expect(intent!.checkIn).toBe(CHECK_IN);
    expect(intent!.checkOut).toBe(CHECK_OUT);
    expect(intent!.snapshot).toEqual(snapshot(rooms));
    expect(intent!.paymentSessionId).toBeNull();
    expect(intent!.bookingId).toBeNull();
    expect(intent!.rooms.map(({ id: _id, ...r }) => r)).toEqual(rooms);
    expect(await held()).toEqual([2, 2]);
  });

  test("new intent abandons the previous open one", async () => {
    const first = await created(guest);
    await attachPaymentSession(db, { intentId: first.intentId, sessionId: "cs_a", accountId: "acct_a" });
    // Another guest's open intent is none of this guest's business.
    const other = await created(`test-guest-${crypto.randomUUID()}`);

    const second = await created(guest);
    expect(second.abandoned).toEqual([{ intentId: first.intentId, sessionId: "cs_a", accountId: "acct_a" }]);
    expect(await status(first.intentId)).toBe("abandoned");
    expect(await status(other.intentId)).toBe("open");
    expect(await status(second.intentId)).toBe("open");
    // The other guest's hold and the second one; the first no longer counts.
    expect(await held()).toEqual([2, 2]);
  });

  test("an abandoned intent without a session has nothing to expire", async () => {
    await created(guest);
    const second = await created(guest);
    expect(second.abandoned).toEqual([]);
  });

  test("short on stock: unavailable, and the previous intent is kept", async () => {
    await db.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    await created(`test-guest-${crypto.randomUUID()}`);
    const second = await db.query(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active)
       VALUES ($1, 'Single', 1, 1, 3, true) RETURNING id`,
      [ids.propertyId],
    );
    const secondRoom = (second.rows[0] as { id: string }).id;
    const plan = await db.query(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active) VALUES ($1, 'Room only', 80, true, true) RETURNING id`,
      [secondRoom],
    );
    const secondPlan = (plan.rows[0] as { id: string }).id;
    const previous = await created(guest, [room(secondRoom, secondPlan)]);

    const result = await create(guest, [room(ids.roomId, ids.ratePlanId), room(secondRoom, secondPlan)]);
    expect(result).toEqual({ ok: false, error: "unavailable", roomIds: [ids.roomId] });
    // Rolled back whole: the guest's earlier hold is still theirs.
    expect(await status(previous.intentId)).toBe("open");
    expect((await db.query(`SELECT count(*)::int AS n FROM booking_intents WHERE user_id = $1`, [guest])).rows[0].n).toBe(1);
  });

  test("two units of a one-unit room are unavailable", async () => {
    await db.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    const result = await create(guest, [room(ids.roomId, ids.ratePlanId), room(ids.roomId, ids.ratePlanId)]);
    expect(result).toEqual({ ok: false, error: "unavailable", roomIds: [ids.roomId] });
  });

  test("a room of another property is unavailable", async () => {
    const elsewhere = await seedProperty(db);
    const result = await create(guest, [room(elsewhere.roomId, elsewhere.ratePlanId)]);
    expect(result).toEqual({ ok: false, error: "unavailable", roomIds: [elsewhere.roomId] });
  });

  test("intent owner only", async () => {
    const { intentId } = await created(guest);
    await attachPaymentSession(db, { intentId, sessionId: "cs_owner", accountId: "acct_a" });
    expect(await loadIntent(db, { intentId, userId: `test-guest-${crypto.randomUUID()}` })).toBeNull();
    expect(await loadIntent(db, { intentId: "not-a-uuid", userId: guest })).toBeNull();
    expect((await loadIntent(db, { intentId, userId: guest }))?.id).toBe(intentId);

    expect(await loadIntentBySession(db, { sessionId: "cs_owner", userId: `test-guest-${crypto.randomUUID()}` })).toBeNull();
    const bySession = await loadIntentBySession(db, { sessionId: "cs_owner", userId: guest });
    expect(bySession?.id).toBe(intentId);
    expect(bySession?.paymentSessionId).toBe("cs_owner");
    expect(bySession?.paymentAccountId).toBe("acct_a");
  });

  test("a session attaches only to an open intent", async () => {
    const first = await created(guest);
    await created(guest); // abandons the first
    await expect(
      attachPaymentSession(db, { intentId: first.intentId, sessionId: "cs_late", accountId: "acct_a" }),
    ).rejects.toBeInstanceOf(IntentNotOpenError);
    expect((await loadIntent(db, { intentId: first.intentId, userId: guest }))?.paymentSessionId).toBeNull();
  });

  test("expireIntent only once the hold has ended, and only an open intent", async () => {
    const { intentId, holdExpiresAt } = await created(guest);
    await attachPaymentSession(db, { intentId, sessionId: "cs_exp", accountId: "acct_a" });

    expect(await expireIntent(db, { intentId, now: new Date(holdExpiresAt.getTime() - 1000) })).toBeNull();
    expect(await status(intentId)).toBe("open");

    expect(await expireIntent(db, { intentId, now: holdExpiresAt })).toEqual({ sessionId: "cs_exp", accountId: "acct_a" });
    expect(await status(intentId)).toBe("expired");
    // Already expired: nothing more to do.
    expect(await expireIntent(db, { intentId, now: holdExpiresAt, force: true })).toBeNull();
  });

  test("expireIntent with force ends the hold early", async () => {
    const { intentId } = await created(guest);
    expect(await expireIntent(db, { intentId, now: NOW, force: true })).toEqual({ sessionId: null, accountId: null });
    expect(await status(intentId)).toBe("expired");
  });

  test("expireIntent leaves a paid intent alone", async () => {
    const { intentId, holdExpiresAt } = await created(guest);
    await db.query(`UPDATE booking_intents SET status = 'paid' WHERE id = $1`, [intentId]);
    expect(await expireIntent(db, { intentId, now: new Date(holdExpiresAt.getTime() + MINUTE) })).toBeNull();
    expect(await expireIntent(db, { intentId, now: NOW, force: true })).toBeNull();
    expect(await status(intentId)).toBe("paid");
  });

  test("markIntentFailed fails an open intent and never a paid one", async () => {
    const open = await created(guest);
    await markIntentFailed(db, { intentId: open.intentId });
    expect(await status(open.intentId)).toBe("failed");

    const paid = await created(guest);
    await db.query(`UPDATE booking_intents SET status = 'paid' WHERE id = $1`, [paid.intentId]);
    await markIntentFailed(db, { intentId: paid.intentId });
    expect(await status(paid.intentId)).toBe("paid");
  });
});

/**
 * Two connections racing, so the fixture has to be committed: neither could
 * see the other's uncommitted rows. Everything made here is deleted in afterAll.
 */
describeWithDb("booking intents under concurrency", () => {
  let setup: Client;
  let a: Client;
  let b: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  /** A second room with plenty of stock, so only the per-guest rule decides. */
  let roomy: { roomId: string; ratePlanId: string };

  beforeAll(async () => {
    [setup, a, b] = [new Client({ connectionString }), new Client({ connectionString }), new Client({ connectionString })];
    await Promise.all([setup.connect(), a.connect(), b.connect()]);
    // Idempotent, and a no-op where the migration is already in.
    await applyPendingMigrations(setup);
    ids = await seedProperty(setup);
    await setup.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    const r = await setup.query(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active)
       VALUES ($1, 'Family', 2, 2, 5, true) RETURNING id`,
      [ids.propertyId],
    );
    const roomId = (r.rows[0] as { id: string }).id;
    const p = await setup.query(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active) VALUES ($1, 'Room only', 120, true, true) RETURNING id`,
      [roomId],
    );
    roomy = { roomId, ratePlanId: (p.rows[0] as { id: string }).id };
  });

  afterEach(async () => {
    await setup.query(`DELETE FROM booking_intents WHERE property_id = $1`, [ids.propertyId]);
  });

  afterAll(async () => {
    if (ids) {
      await setup.query(`DELETE FROM booking_intents WHERE property_id = $1`, [ids.propertyId]);
      await setup.query(`DELETE FROM rate_plans WHERE room_id IN (SELECT id FROM rooms WHERE property_id = $1)`, [ids.propertyId]);
      await setup.query(`DELETE FROM rooms WHERE property_id = $1`, [ids.propertyId]);
      await setup.query(`DELETE FROM properties WHERE id = $1`, [ids.propertyId]);
    }
    await Promise.all([setup.end(), a.end(), b.end()]);
  });

  const race = (userA: string, userB: string, r: { roomId: string; ratePlanId: string }) => {
    const rooms = [room(r.roomId, r.ratePlanId)];
    const input = (userId: string) => ({
      userId,
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms,
      snapshot: snapshot(rooms),
      // Real time: a hold made "in 2031" would never have expired by then anyway.
      now: new Date(),
    });
    return Promise.all([
      createBookingIntent(lifecycleDb(a, "commit"), input(userA)),
      createBookingIntent(lifecycleDb(b, "commit"), input(userB)),
    ]);
  };

  test("concurrent intents on the last unit", async () => {
    const results = await race(`test-guest-${crypto.randomUUID()}`, `test-guest-${crypto.randomUUID()}`, ids);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "unavailable", roomIds: [ids.roomId] }]);
    const open = await setup.query(`SELECT count(*)::int AS n FROM booking_intents WHERE property_id = $1 AND status = 'open'`, [
      ids.propertyId,
    ]);
    expect(open.rows[0].n).toBe(1);
  });

  test("concurrent intents for one guest leave one open", async () => {
    const guest = `test-guest-${crypto.randomUUID()}`;
    const results = await race(guest, guest, roomy);
    expect(results.every((r) => r.ok)).toBe(true);
    const rows = await setup.query(`SELECT status FROM booking_intents WHERE user_id = $1`, [guest]);
    expect(rows.rows.map((r) => r.status).sort()).toEqual(["abandoned", "open"]);
  });
});

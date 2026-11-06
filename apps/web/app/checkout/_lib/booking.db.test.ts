/**
 * The checkout summary of a booking intent. Every test runs in a transaction
 * that is rolled back; skipped locally without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { createBookingIntent, type IntentRoomInput, type IntentSnapshot } from "@openbookings/db";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedGuest,
  seedProperty,
} from "@openbookings/db/testing";
import { BookingNotFoundError, getBookingSummary, totalCents } from "./booking";
import { toCents } from "./booking-lines";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-12"; // 2 nights
const NOW = new Date("2031-10-01T10:00:00Z");
const NIGHTS = ["2031-11-10", "2031-11-11"];

/** `createBookingIntent`'s transaction as a savepoint inside the test's own. */
function savepointDb(client: Client): LifecycleDb {
  const query = (text: string, values?: unknown[]) => client.query(text, values);
  return {
    query,
    transaction: async (fn) => {
      await client.query("SAVEPOINT intent");
      try {
        const out = await fn({ query });
        await client.query("RELEASE SAVEPOINT intent");
        return out;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT intent");
        throw error;
      }
    },
  };
}

describeWithDb("checkout summary of a booking intent", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let suiteId: string;
  let nrPlanId: string;
  let guest: string;
  const fallback = process.env.STRIPE_CONNECT_ACCOUNT_ID;

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
    guest = await seedGuest(db);
    const suite = await db.query(
      `INSERT INTO rooms (property_id, name, room_type, bed_type, size_sqm, base_occupancy, max_adults, total_units, is_active)
       VALUES ($1, 'Garden', 'Suite', 'King', 32, 2, 2, 3, true) RETURNING id`,
      [ids.propertyId],
    );
    suiteId = (suite.rows[0] as { id: string }).id;
    const nr = await db.query(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active)
       VALUES ($1, 'Non-refundable', 140, false, true) RETURNING id`,
      [suiteId],
    );
    nrPlanId = (nr.rows[0] as { id: string }).id;
    await db.query(`INSERT INTO room_images (room_id, url, sort_order) VALUES ($1, 'https://img.test/garden.jpg', 0)`, [
      suiteId,
    ]);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
    if (fallback === undefined) delete process.env.STRIPE_CONNECT_ACCOUNT_ID;
    else process.env.STRIPE_CONNECT_ACCOUNT_ID = fallback;
  });

  const room = (roomId: string, ratePlanId: string, price: number, tax: number): IntentRoomInput => ({
    roomId,
    ratePlanId,
    adults: 2,
    children: 0,
    nights: NIGHTS.map((date) => ({ date, price })),
    stayTotal: price * NIGHTS.length,
    touristTax: tax,
    touristTaxLines: [{ label: "€3.25 per person per night", amount: tax, effectiveFrom: "2031-01-01" }],
  });

  /** A Double on "Room only" and a Garden Suite on "Non-refundable", in that order. */
  async function twoRoomIntent(userId = guest): Promise<{ intentId: string; snapshot: IntentSnapshot }> {
    const rooms = [room(ids.roomId, ids.ratePlanId, 100, 13), room(suiteId, nrPlanId, 140, 13)];
    const snapshot: IntentSnapshot = {
      roomsTotal: 480,
      touristTaxTotal: 26,
      total: 506,
      commissionCents: 0,
      currency: "EUR",
      rooms: [
        { roomId: ids.roomId, ratePlanId: ids.ratePlanId, roomName: "Double", ratePlanName: "Room only", isRefundable: true, freeCancellationUntil: null },
        { roomId: suiteId, ratePlanId: nrPlanId, roomName: "Garden", ratePlanName: "Non-refundable", isRefundable: false, freeCancellationUntil: null },
      ],
    };
    const created = await createBookingIntent(savepointDb(db), {
      userId,
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms,
      snapshot,
      now: NOW,
    });
    if (!created.ok) throw new Error(`intent not created: ${created.roomIds.join(", ")}`);
    return { intentId: created.intentId, snapshot };
  }

  const summary = (intentId: string, userId = guest, testing = false) =>
    getBookingSummary({ intentId, userId, testing }, db);

  test("another guest's intent is not found", async () => {
    const { intentId } = await twoRoomIntent();
    const stranger = await seedGuest(db);
    await expect(summary(intentId, stranger)).rejects.toBeInstanceOf(BookingNotFoundError);
  });

  test("a two-room intent lists both rooms and charges exactly the snapshot total", async () => {
    const { intentId, snapshot } = await twoRoomIntent();
    const s = await summary(intentId);

    expect(s.intentId).toBe(intentId);
    expect(s.status).toBe("open");
    expect(s.rooms.length).toBe(2);
    expect(s.rooms.map((r) => [r.roomName, r.roomType, r.ratePlanName, r.isRefundable, r.nights, r.stayTotal])).toEqual([
      ["Double", null, "Room only", true, 2, 200],
      ["Garden", "Suite", "Non-refundable", false, 2, 280],
    ]);
    expect(s.rooms[1]).toMatchObject({ bedType: "King", sizeSqm: 32, roomImageUrl: "https://img.test/garden.jpg" });
    expect(s.rooms[0]!.cancellation.requiresNonRefundableConsent).toBe(false);
    expect(s.rooms[1]!.cancellation.requiresNonRefundableConsent).toBe(true);
    expect(s.nights).toBe(2);
    expect(s.lines.length).toBe(4);
    expect(totalCents(s.lines)).toBe(toCents(snapshot.total));
    expect(s.currency).toBe("eur");
  });

  test("the host's own connected account is the one charged", async () => {
    await db.query(`UPDATE properties SET stripe_account_id = 'acct_host_own' WHERE id = $1`, [ids.propertyId]);
    process.env.STRIPE_CONNECT_ACCOUNT_ID = "acct_dev_fallback";
    const { intentId } = await twoRoomIntent();
    expect((await summary(intentId)).stripeAccountId).toBe("acct_host_own");
  });

  test("a demo hotel without an account gets the development fallback account in testing mode", async () => {
    await db.query(`UPDATE properties SET is_demo = true, stripe_account_id = NULL WHERE id = $1`, [ids.propertyId]);
    process.env.STRIPE_CONNECT_ACCOUNT_ID = "acct_dev_fallback";
    const { intentId } = await twoRoomIntent();
    expect(process.env.NODE_ENV).not.toBe("production");
    expect((await summary(intentId, guest, true)).stripeAccountId).toBe("acct_dev_fallback");
  });

  test("a demo hotel's intent is not found outside testing mode", async () => {
    await db.query(`UPDATE properties SET is_demo = true WHERE id = $1`, [ids.propertyId]);
    const { intentId } = await twoRoomIntent();
    await expect(summary(intentId, guest, false)).rejects.toBeInstanceOf(BookingNotFoundError);
  });
});

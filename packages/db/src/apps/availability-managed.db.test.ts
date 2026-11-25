/**
 * Availability on a property a connected app manages (spec §3, §4): the app's
 * units left replace our own stock, and our bookings come off it only until
 * the app has settled them. Fixtures sit in 2031+ so dev data cannot interfere.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { AriBatch } from "@openbookings/apps-contract";
import { loadSearchAvailability, loadStayAvailability } from "../availability";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedGuest,
  seedProperty,
} from "../testing/db-harness";
import { applyAriBatch } from "./ari";
import { connectApp, disconnectApp, type Installation } from "./installations";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-12"; // 2 nights
const NOW = new Date("2031-10-01T10:00:00Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

describeWithDb("availability on an app-managed property", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let installation: Installation;
  let codes: { room: string; plan: string };

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
    installation = (
      await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId: "test-host-user", sendUpcoming: true, now: ago(120) })
    ).installation;
    codes = (
      await db.query(
        `SELECT r.channel_code AS room, p.channel_code AS plan FROM rooms r JOIN rate_plans p ON p.room_id = r.id WHERE r.id = $1`,
        [ids.roomId],
      )
    ).rows[0] as { room: string; plan: string };
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const stay = (i: { checkIn?: string; checkOut?: string } = {}) =>
    loadStayAvailability(db, { propertyId: ids.propertyId, checkIn: i.checkIn ?? CHECK_IN, checkOut: i.checkOut ?? CHECK_OUT, now: NOW }).then(
      (rooms) => rooms[0]!,
    );

  /** The app's numbers: units left on every night of the stay, and a price on each. */
  async function push(i: { unitsLeft?: number; receivedAt: Date; from?: string; to?: string; rates?: boolean }) {
    const from = i.from ?? CHECK_IN;
    const to = i.to ?? "2031-11-11";
    const batch: AriBatch = {
      inventory: i.unitsLeft === undefined ? [] : [{ roomCode: codes.room, from, to, unitsLeft: i.unitsLeft }],
      rates:
        i.rates === false
          ? []
          : [{ ratePlanCode: codes.plan, from, to, priceCents: 12000, extraAdultCents: null, extraChildCents: null }],
      restrictions: [],
    };
    expect((await applyAriBatch(db, installation, batch, i.receivedAt)).ok).toBe(true);
  }

  async function restrict(change: Omit<AriBatch["restrictions"][number], "ratePlanCode">) {
    const batch: AriBatch = { inventory: [], rates: [], restrictions: [{ ratePlanCode: codes.plan, ...change }] };
    expect((await applyAriBatch(db, installation, batch, ago(10))).ok).toBe(true);
  }

  async function confirmedBooking(status = "confirmed") {
    const booking = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    await db.query(`UPDATE bookings SET status = $2::booking_status WHERE id = $1`, [booking.bookingId, status]);
    return booking.bookingId;
  }

  async function delivery(bookingId: string, status: string, acknowledgedAt: Date | null) {
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at) VALUES ($1, $2, $3, $4)`,
      [installation.id, bookingId, status, acknowledgedAt],
    );
  }

  test("an unacknowledged booking still comes off the app's limit", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    await delivery(await confirmedBooking(), "pending", null);
    const room = await stay();
    expect(room.nights.map((n) => n.bookable)).toEqual([1, 1]);
    expect(room.unitsLeft).toBe(1);
  });

  test("a booking with no delivery row yet still counts", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    await confirmedBooking();
    expect((await stay()).unitsLeft).toBe(1);
  });

  test("acknowledged a minute ago, limit received after it: still counted", async () => {
    await delivery(await confirmedBooking(), "delivered", ago(1));
    await push({ unitsLeft: 2, receivedAt: ago(0.5) });
    expect((await stay()).unitsLeft).toBe(1);
  });

  test("acknowledged 4 minutes ago, limit received 3.5 minutes after it: settled", async () => {
    await delivery(await confirmedBooking(), "delivered", ago(4));
    await push({ unitsLeft: 2, receivedAt: ago(0.5) });
    const room = await stay();
    expect(room.nights.map((n) => n.bookable)).toEqual([2, 2]);
    expect(room.nights[0]).toMatchObject({ total: 3, booked: 1 });
  });

  test("the 3-minute rule is per night: a newer limit on one night settles only that night", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(20) });
    await delivery(await confirmedBooking(), "delivered", ago(4));
    await push({ unitsLeft: 2, receivedAt: ago(0.5), from: "2031-11-11", to: "2031-11-11" });
    expect((await stay()).nights.map((n) => n.bookable)).toEqual([1, 2]);
  });

  test("acknowledged 31 minutes ago with no newer limit: settled", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(60) });
    await delivery(await confirmedBooking(), "delivered", ago(31));
    expect((await stay()).unitsLeft).toBe(2);
  });

  test("acknowledged 29 minutes ago with no newer limit: still counted", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(60) });
    await delivery(await confirmedBooking(), "delivered", ago(29));
    expect((await stay()).unitsLeft).toBe(1);
  });

  test("acknowledged 31 minutes ago but changed since (needs attention): still counted", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(60) });
    await delivery(await confirmedBooking(), "needs_attention", ago(31));
    expect((await stay()).unitsLeft).toBe(1);
  });

  test("acknowledged 31 minutes ago but changed since (pending again): still counted", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(60) });
    await delivery(await confirmedBooking(), "pending", ago(31));
    expect((await stay()).unitsLeft).toBe(1);
  });

  test("a booking marked not_sent never counts", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    await delivery(await confirmedBooking(), "not_sent", null);
    expect((await stay()).unitsLeft).toBe(2);
  });

  test("a cancelled booking does not count, settled or not", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    await delivery(await confirmedBooking("cancelled"), "delivered", ago(31));
    await confirmedBooking("cancelled");
    expect((await stay()).unitsLeft).toBe(2);
  });

  test("open holds still come off", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    const intent = (
      await db.query(
        `INSERT INTO booking_intents (user_id, property_id, check_in_date, check_out_date, hold_expires_at, snapshot, total_cents, status)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 24000, 'open') RETURNING id`,
        [await seedGuest(db), ids.propertyId, CHECK_IN, CHECK_OUT, new Date(NOW.getTime() + 10 * MINUTE)],
      )
    ).rows[0] as { id: string };
    await db.query(
      `INSERT INTO booking_intent_rooms (intent_id, room_id, rate_plan_id, adults, nights, stay_total_cents)
       VALUES ($1, $2, $3, 2, '[12000,12000]'::jsonb, 24000)`,
      [intent.id, ids.roomId, ids.ratePlanId],
    );
    expect((await stay()).unitsLeft).toBe(1);
  });

  test("a night the app never sent has no units, so the room is sold out", async () => {
    await push({ unitsLeft: 3, receivedAt: ago(5), from: CHECK_IN, to: CHECK_IN });
    await push({ receivedAt: ago(5), from: "2031-11-11", to: "2031-11-11" });
    const room = await stay();
    expect(room.nights.map((n) => n.bookable)).toEqual([3, 0]);
    expect(room.unitsLeft).toBe(0);
    const search = await loadSearchAvailability(db, {
      propertyIds: [ids.propertyId],
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      adults: 2,
      children: 0,
      rooms: 1,
      now: NOW,
    });
    expect(search.get(ids.propertyId)).toMatchObject({ bookable: false, reason: "sold_out" });
  });

  test("a night without an app price closes the rate plan", async () => {
    await push({ unitsLeft: 3, receivedAt: ago(5), from: CHECK_IN, to: CHECK_IN });
    await push({ unitsLeft: 3, receivedAt: ago(5), from: "2031-11-11", to: "2031-11-11", rates: false });
    const room = await stay();
    expect(room.unitsLeft).toBe(3);
    expect(room.ratePlans[0]!.reasons).toEqual(["rate_closed"]);
  });

  test("a price on the departure date only is not needed", async () => {
    await push({ unitsLeft: 3, receivedAt: ago(5) });
    expect((await stay()).ratePlans[0]!.reasons).toEqual([]);
  });

  test("our own stock, closures, restrictions and plan stay limits are ignored", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    await db.query(`INSERT INTO room_inventory (room_id, date, available_override, blocked_rooms) VALUES ($1, $2, 0, 5)`, [
      ids.roomId,
      CHECK_IN,
    ]);
    await db.query(
      `INSERT INTO room_closures (room_id, start_date, end_date, is_active) VALUES ($1, $2, $3, true)`,
      [ids.roomId, CHECK_IN, CHECK_OUT],
    );
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, is_closed, is_active) VALUES ($1, $2, $3, true, true)`,
      [ids.ratePlanId, CHECK_IN, CHECK_OUT],
    );
    await db.query(`UPDATE rate_plans SET min_stay = 5 WHERE id = $1`, [ids.ratePlanId]);
    const room = await stay();
    expect(room.roomClosed).toBe(false);
    expect(room.unitsLeft).toBe(2);
    expect(room.ratePlans[0]!.reasons).toEqual([]);
  });

  test("app restrictions apply: arrival rules on the arrival night, through rules on any night", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5), to: "2031-11-12" });
    await restrict({ from: "2031-11-11", to: "2031-11-11", minStayThrough: 3, minStayArrival: 4 });
    expect((await stay()).ratePlans[0]!.reasons).toEqual(["min_stay"]);
    // Arriving on the 11th: its arrival minimum is 4.
    expect((await stay({ checkIn: "2031-11-11", checkOut: "2031-11-13" })).ratePlans[0]!.reasons).toEqual(["min_stay"]);
    await restrict({ from: "2031-11-11", to: "2031-11-11", minStayArrival: null });
    expect((await stay({ checkIn: "2031-11-11", checkOut: "2031-11-13" })).ratePlans[0]!.reasons).toEqual(["min_stay"]);
    expect((await stay({ checkIn: CHECK_IN, checkOut: "2031-11-13" })).ratePlans[0]!.reasons).toEqual([]);
  });

  test("app stop-sell, closed to arrival and closed to departure apply", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    await restrict({ from: CHECK_IN, to: CHECK_IN, closedToArrival: true });
    await restrict({ from: CHECK_OUT, to: CHECK_OUT, closedToDeparture: true });
    await restrict({ from: "2031-11-11", to: "2031-11-11", closed: true });
    expect((await stay()).ratePlans[0]!.reasons).toEqual(["rate_closed", "closed_to_arrival", "closed_to_departure"]);
  });

  test("after disconnecting, the app's last numbers stay; after them our own count again", async () => {
    await push({ unitsLeft: 1, receivedAt: ago(5) });
    await confirmedBooking();
    expect((await stay()).unitsLeft).toBe(0);
    await disconnectApp(db, { installationId: installation.id, now: ago(1) });
    const room = await stay();
    expect(room.unitsLeft).toBe(0);
    expect(room.ratePlans[0]!.reasons).toEqual([]);
    // Past the last night the app sent, the room's own 5 units.
    const later = await stay({ checkIn: "2031-11-20", checkOut: "2031-11-21" });
    expect(later.unitsLeft).toBe(5);
    expect(later.ratePlans[0]!.reasons).toEqual([]);
  });

  test("the host dashboard role (ob_app, row-level security on) reads the app's stock", async () => {
    const hostId = `test-host-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, first_name, last_name, email, "emailVerified", account_type)
       VALUES ($1, 'Test', 'Host', $2, true, 'business'::account_type)`,
      [hostId, `${hostId}@example.test`],
    );
    await db.query(`UPDATE properties SET owner_user_id = $2 WHERE id = $1`, [ids.propertyId, hostId]);
    await push({ unitsLeft: 2, receivedAt: ago(5) });
    await delivery(await confirmedBooking(), "pending", null);
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [hostId]);
    await db.query(`SET LOCAL ROLE ob_business`);
    try {
      const room = await stay();
      expect(room.unitsLeft).toBe(1);
      expect(room.ratePlans[0]!.reasons).toEqual([]);
    } finally {
      await db.query("RESET ROLE");
    }
  });

  test("a delivery row of another installation does not settle a booking", async () => {
    await push({ unitsLeft: 2, receivedAt: ago(60) });
    const bookingId = await confirmedBooking();
    const other = await seedProperty(db);
    const otherInstallation = (
      await connectApp(db, { propertyId: other.propertyId, appKey: "siteminder", userId: "test-host-user", sendUpcoming: true, now: ago(120) })
    ).installation;
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at) VALUES ($1, $2, 'not_sent', NULL)`,
      [otherInstallation.id, bookingId],
    );
    expect((await stay()).unitsLeft).toBe(1);
  });
});

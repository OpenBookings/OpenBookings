/**
 * Disconnect keeps the app's last values (spec §7): what guests can book and
 * what they pay on the nights after disconnecting is what it was just before.
 * Fixtures sit in 2031+ so dev data cannot interfere.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { AriBatch } from "@openbookings/apps-contract";
import { loadStayAvailability } from "../availability";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";
import { applyAriBatch } from "./ari";
import { connectApp, disconnectApp, type Installation } from "./installations";
import { MANAGED_PROPERTY_SQL } from "./managed-sql";
import { MANAGED_NIGHT_PRICE_SQL } from "./managed-price-sql";

// 11:00 in Amsterdam: today is 2031-11-09 in property time.
const NOW = new Date("2031-11-09T10:00:00Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

const STAYS: [string, string][] = [
  ["2031-11-10", "2031-11-11"], // closed to arrival
  ["2031-11-11", "2031-11-12"], // closed
  ["2031-11-12", "2031-11-13"], // min stay 2 (through)
  ["2031-11-12", "2031-11-14"], // runs into an unpriced night
  ["2031-11-09", "2031-11-10"], // open, today
  ["2031-11-10", "2031-11-13"], // across all
];

describeWithDb("disconnect keeps the app's last values", () => {
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
      await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId: "test-host-user", sendUpcoming: true, now: ago(600) })
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

  async function push(batch: Partial<AriBatch>, receivedAt = ago(60)) {
    const full: AriBatch = { inventory: [], rates: [], restrictions: [], ...batch };
    expect((await applyAriBatch(db, installation, full, receivedAt)).ok).toBe(true);
  }

  /** The app's last values for 2031-11-09 … 2031-11-13. */
  async function pushNights() {
    await push({
      inventory: [
        { roomCode: codes.room, from: "2031-11-09", to: "2031-11-10", unitsLeft: 3 },
        { roomCode: codes.room, from: "2031-11-11", to: "2031-11-12", unitsLeft: 2 },
        { roomCode: codes.room, from: "2031-11-13", to: "2031-11-13", unitsLeft: 1 },
      ],
      rates: [
        { ratePlanCode: codes.plan, from: "2031-11-09", to: "2031-11-10", priceCents: 18650, extraAdultCents: 2500, extraChildCents: null },
        { ratePlanCode: codes.plan, from: "2031-11-11", to: "2031-11-11", priceCents: 20000, extraAdultCents: null, extraChildCents: null },
        { ratePlanCode: codes.plan, from: "2031-11-12", to: "2031-11-12", priceCents: 18650, extraAdultCents: null, extraChildCents: null },
        // 2031-11-13: no price, so not for sale.
      ],
      restrictions: [
        { ratePlanCode: codes.plan, from: "2031-11-10", to: "2031-11-10", closedToArrival: true },
        { ratePlanCode: codes.plan, from: "2031-11-11", to: "2031-11-11", closed: true },
        { ratePlanCode: codes.plan, from: "2031-11-12", to: "2031-11-12", minStayThrough: 2 },
      ],
    });
  }

  /** A booking on 2031-11-12 the app counted 40 minutes ago (settled). */
  async function settledBooking() {
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-11-12", nights: 1 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at) VALUES ($1, $2, 'delivered', $3)`,
      [installation.id, bookingId, ago(40)],
    );
  }

  async function snapshot() {
    const out: Record<string, { bookable: number[]; reasons: string[]; roomClosed: boolean }> = {};
    for (const [checkIn, checkOut] of STAYS) {
      const room = (await loadStayAvailability(db, { propertyId: ids.propertyId, checkIn, checkOut, now: NOW }))[0]!;
      out[`${checkIn}→${checkOut}`] = {
        bookable: room.nights.map((n) => n.bookable),
        reasons: room.ratePlans[0]!.reasons,
        roomClosed: room.roomClosed,
      };
    }
    return out;
  }

  /** The nightly price search, the quote and the grid all take (MANAGED_NIGHT_PRICE_SQL). */
  async function prices(from: string, to: string) {
    const { rows } = await db.query(
      `SELECT g.day::date::text AS date, price.base_price_cents::int AS price
         FROM rate_plans rp JOIN rooms r ON r.id = rp.room_id
        CROSS JOIN generate_series($2::date, $3::date, INTERVAL '1 day') g(day)
        CROSS JOIN LATERAL (
          SELECT rp.id AS rate_plan_id, rp.bar_cents, ${MANAGED_PROPERTY_SQL} AS managed, g.day::date AS date
        ) plan_night
        CROSS JOIN LATERAL (${MANAGED_NIGHT_PRICE_SQL}) price
        WHERE rp.id = $1
        ORDER BY g.day`,
      [ids.ratePlanId, from, to],
    );
    return rows as { date: string; price: number }[];
  }

  test("availability, closures, restrictions and open-night prices are what they were while managed", async () => {
    // The hotel's own values, which the app's must win over after disconnecting.
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night_cents, priority)
       VALUES ($1, '2031-11-01', '2031-12-31', 9999, 5)`,
      [ids.ratePlanId],
    );
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, is_closed, priority)
       VALUES ($1, '2031-11-09', '2031-11-09', true, 0)`,
      [ids.ratePlanId],
    );
    await db.query(
      `INSERT INTO room_closures (room_id, start_date, end_date) VALUES ($1, '2031-11-12', '2031-11-20')`,
      [ids.roomId],
    );
    await db.query(`INSERT INTO room_inventory (room_id, date, available_override) VALUES ($1, '2031-11-10', 9)`, [
      ids.roomId,
    ]);
    await pushNights();
    await settledBooking();

    const managed = await snapshot();
    const managedPrices = await prices("2031-11-09", "2031-11-12");
    // Sanity: the managed picture is what the app sent (the settled booking
    // comes back on top of the 2 units left, then off again as booked).
    expect(managed["2031-11-10→2031-11-11"]!.reasons).toEqual(["closed_to_arrival"]);
    expect(managed["2031-11-11→2031-11-12"]!.reasons).toEqual(["rate_closed"]);
    expect(managed["2031-11-12→2031-11-13"]).toEqual({ bookable: [2], reasons: ["min_stay"], roomClosed: false });
    expect(managed["2031-11-12→2031-11-14"]!.reasons).toEqual(["rate_closed"]);
    expect(managed["2031-11-09→2031-11-10"]).toEqual({ bookable: [3], reasons: [], roomClosed: false });

    await disconnectApp(db, { installationId: installation.id, now: NOW });

    expect(await snapshot()).toEqual(managed);
    expect((await prices("2031-11-09", "2031-11-12")).filter((p) => p.date !== "2031-11-13")).toEqual(managedPrices);

    // The hotel's price around the window survives, cut back to the nights outside it.
    const hostRows = (
      await db.query(
        `SELECT start_date::text AS start, end_date::text AS "end", price_per_night_cents::int AS price
           FROM rate_overrides WHERE rate_plan_id = $1 AND is_active AND label IS NULL ORDER BY start_date`,
        [ids.ratePlanId],
      )
    ).rows;
    expect(hostRows).toEqual([
      { start: "2031-11-01", end: "2031-11-08", price: 9999 },
      { start: "2031-11-14", end: "2031-12-31", price: 9999 },
    ]);
    // The room closure starting inside the window now starts after it.
    const closure = (
      await db.query(`SELECT start_date::text AS start FROM room_closures WHERE room_id = $1 AND is_active`, [ids.roomId])
    ).rows;
    expect(closure).toEqual([{ start: "2031-11-14" }]);
    expect(await prices("2031-11-14", "2031-11-14")).toEqual([{ date: "2031-11-14", price: 9999 }]);
  });

  test("runs of equal prices become one row, not one per night", async () => {
    await push({
      rates: [
        { ratePlanCode: codes.plan, from: "2031-11-09", to: "2033-11-27", priceCents: 15000, extraAdultCents: null, extraChildCents: null },
      ],
      inventory: [{ roomCode: codes.room, from: "2031-11-09", to: "2033-11-27", unitsLeft: 4 }],
    });
    await disconnectApp(db, { installationId: installation.id, now: NOW });

    const overrides = (
      await db.query(
        `SELECT start_date::text AS start, end_date::text AS "end", price_per_night_cents::int AS price
           FROM rate_overrides WHERE rate_plan_id = $1 AND is_active`,
        [ids.ratePlanId],
      )
    ).rows;
    expect(overrides).toEqual([{ start: "2031-11-09", end: "2033-11-27", price: 15000 }]);
    const closures = await db.query(`SELECT 1 FROM rate_plan_restrictions WHERE rate_plan_id = $1 AND is_active`, [
      ids.ratePlanId,
    ]);
    expect(closures.rows).toHaveLength(0);
  });

  test("nothing sent for today or later: nothing carried, the installation is still switched off", async () => {
    await push({
      rates: [
        { ratePlanCode: codes.plan, from: "2031-11-01", to: "2031-11-08", priceCents: 15000, extraAdultCents: null, extraChildCents: null },
      ],
    });
    await disconnectApp(db, { installationId: installation.id, now: NOW });
    const status = (await db.query(`SELECT status FROM app_installations WHERE id = $1`, [installation.id])).rows[0];
    expect(status).toEqual({ status: "disconnected" });
    expect((await db.query(`SELECT 1 FROM rate_overrides WHERE rate_plan_id = $1`, [ids.ratePlanId])).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM room_inventory WHERE room_id = $1`, [ids.roomId])).rows).toHaveLength(0);
  });

  test("disconnecting twice carries once", async () => {
    await pushNights();
    await disconnectApp(db, { installationId: installation.id, now: NOW });
    const count = async () =>
      ((await db.query(`SELECT count(*)::int AS n FROM rate_overrides WHERE rate_plan_id = $1`, [ids.ratePlanId])).rows[0] as { n: number }).n;
    const first = await count();
    await disconnectApp(db, { installationId: installation.id, now: NOW });
    expect(await count()).toBe(first);
  });
});

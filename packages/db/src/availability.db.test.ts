import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { loadSearchAvailability, loadStayAvailability } from "./availability";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedGuest,
  seedProperty,
} from "./testing/db-harness";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-13"; // 3 nights
const NOW = new Date("2031-10-01T10:00:00Z");
const MINUTE = 60_000;

describeWithDb("availability against Postgres", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };

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

  const stay = (extra: { excludeIntentId?: string | null } = {}) =>
    loadStayAvailability(db, { propertyId: ids.propertyId, checkIn: CHECK_IN, checkOut: CHECK_OUT, now: NOW, ...extra });

  const search = (party: { adults?: number; children?: number; rooms?: number } = {}) =>
    loadSearchAvailability(db, {
      propertyIds: [ids.propertyId],
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      adults: party.adults ?? 2,
      children: party.children ?? 0,
      rooms: party.rooms ?? 1,
      now: NOW,
    }).then((m) => m.get(ids.propertyId));

  async function confirmedBooking(opts: { checkIn?: string; nights?: number } = {}) {
    const booking = await seedBooking(db, ids, { checkIn: opts.checkIn ?? CHECK_IN, nights: opts.nights ?? 3 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [booking.bookingId]);
    return booking;
  }

  async function intent(opts: { holdExpiresAt: Date; status?: string; checkIn?: string; checkOut?: string }) {
    const userId = await seedGuest(db);
    const row = (
      await db.query(
        `INSERT INTO booking_intents
           (user_id, property_id, check_in_date, check_out_date, hold_expires_at, snapshot, total_amount, status)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 300.00, $6) RETURNING id`,
        [
          userId,
          ids.propertyId,
          opts.checkIn ?? CHECK_IN,
          opts.checkOut ?? CHECK_OUT,
          opts.holdExpiresAt,
          opts.status ?? "open",
        ],
      )
    ).rows[0] as { id: string };
    await db.query(
      `INSERT INTO booking_intent_rooms (intent_id, room_id, rate_plan_id, adults, nights, stay_total)
       VALUES ($1, $2, $3, 2, '[100,100,100]'::jsonb, 300.00)`,
      [row.id, ids.roomId, ids.ratePlanId],
    );
    return row.id;
  }

  test("host number is the total", async () => {
    await db.query(`UPDATE rooms SET total_units = 10 WHERE id = $1`, [ids.roomId]);
    await db.query(
      `INSERT INTO room_inventory (room_id, date, available_override, blocked_rooms) VALUES ($1, $2, 8, 2)`,
      [ids.roomId, CHECK_IN],
    );
    await confirmedBooking({ nights: 1 });

    const [room] = await stay();
    expect(room.nights.map((n) => n.date)).toEqual(["2031-11-10", "2031-11-11", "2031-11-12"]);
    expect(room.nights[0]).toEqual({ date: CHECK_IN, total: 8, booked: 1, held: 0, bookable: 7 });
    expect(room.nights[1]).toEqual({ date: "2031-11-11", total: 10, booked: 0, held: 0, bookable: 10 });
    expect(room.total).toBe(8);
    expect(room.unitsLeft).toBe(7);
  });

  test("blocked only without a host number", async () => {
    await db.query(`INSERT INTO room_inventory (room_id, date, blocked_rooms) VALUES ($1, $2, 2)`, [
      ids.roomId,
      CHECK_IN,
    ]);
    const [room] = await stay();
    expect(room.nights[0].total).toBe(3);
    expect(room.nights[0].bookable).toBe(3);
    expect(room.total).toBe(3);
    expect(room.unitsLeft).toBe(3);
  });

  test("open hold counts, expired hold does not", async () => {
    const live = await intent({ holdExpiresAt: new Date(NOW.getTime() + 5 * MINUTE) });
    await intent({ holdExpiresAt: new Date(NOW.getTime() - MINUTE) });
    await intent({ holdExpiresAt: new Date(NOW.getTime() + 5 * MINUTE), status: "abandoned" });

    const [room] = await stay();
    expect(room.nights.map((n) => n.held)).toEqual([1, 1, 1]);
    expect(room.unitsLeft).toBe(4);

    const [excluded] = await stay({ excludeIntentId: live });
    expect(excluded.nights.map((n) => n.held)).toEqual([0, 0, 0]);
    expect(excluded.unitsLeft).toBe(5);
  });

  test("a hold covers only the nights of its own stay", async () => {
    await intent({ holdExpiresAt: new Date(NOW.getTime() + 5 * MINUTE), checkIn: "2031-11-11", checkOut: "2031-11-12" });
    const [room] = await stay();
    expect(room.nights.map((n) => n.held)).toEqual([0, 1, 0]);
  });

  test("cancelled room and early departure free stock", async () => {
    const cancelled = await confirmedBooking();
    await db.query(`UPDATE reservations SET cancelled_at = now() WHERE id = $1`, [cancelled.reservationIds[0]]);
    const early = await confirmedBooking();
    // Stayed the first night only: the second and third are free again.
    await db.query(`UPDATE bookings SET departed_early_on = $2 WHERE id = $1`, [early.bookingId, CHECK_IN]);

    const [room] = await stay();
    expect(room.nights.map((n) => n.booked)).toEqual([1, 0, 0]);
  });

  test("pending booking does not hold stock", async () => {
    await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 3 });
    const [room] = await stay();
    expect(room.nights.map((n) => n.booked)).toEqual([0, 0, 0]);
    expect(room.unitsLeft).toBe(5);
  });

  test("rate rules: min stay", async () => {
    await db.query(`UPDATE rate_plans SET min_stay = 5 WHERE id = $1`, [ids.ratePlanId]);
    const [room] = await stay();
    expect(room.ratePlans).toEqual([{ ratePlanId: ids.ratePlanId, isRefundable: true, reasons: ["min_stay"] }]);
  });

  test("rate rules: closed to arrival on check-in", async () => {
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, closed_to_arrival)
       VALUES ($1, $2, $2, true)`,
      [ids.ratePlanId, CHECK_IN],
    );
    const [room] = await stay();
    expect(room.ratePlans[0].reasons).toEqual(["closed_to_arrival"]);
  });

  test("rate rules: the highest-priority active restriction wins", async () => {
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, min_stay, priority, is_active)
       VALUES ($1, $2, $2, 7, 0, true), ($1, $2, $2, 2, 5, true), ($1, $2, $2, 9, 9, false)`,
      [ids.ratePlanId, CHECK_IN],
    );
    const [room] = await stay();
    expect(room.ratePlans[0].reasons).toEqual([]);
  });

  test("rate rules: closed on the departure date checks closed to departure only", async () => {
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, is_closed)
       VALUES ($1, $2, $2, true)`,
      [ids.ratePlanId, CHECK_OUT],
    );
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, closed_to_departure)
       VALUES ($1, $2, $2, true)`,
      [ids.ratePlanId, CHECK_OUT],
    );
    const [room] = await stay();
    expect(room.ratePlans[0].reasons).toEqual(["closed_to_departure"]);
  });

  test("rate rules: a closed night closes the rate", async () => {
    await db.query(
      `INSERT INTO rate_plan_restrictions (rate_plan_id, start_date, end_date, is_closed)
       VALUES ($1, '2031-11-11', '2031-11-11', true)`,
      [ids.ratePlanId],
    );
    const [room] = await stay();
    expect(room.ratePlans[0].reasons).toEqual(["rate_closed"]);
  });

  test("rate rules: room closure over a night", async () => {
    await db.query(
      `INSERT INTO room_closures (room_id, start_date, end_date) VALUES ($1, '2031-11-11', '2031-11-11')`,
      [ids.roomId],
    );
    const [room] = await stay();
    expect(room.roomClosed).toBe(true);
    expect(room.ratePlans[0].reasons).toEqual([]);
  });

  test("only active plans on non-archived rooms; drafts are listed as not on sale", async () => {
    const inactive = (
      await db.query(
        `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active) VALUES ($1, 'Off', 90, true, false) RETURNING id`,
        [ids.roomId],
      )
    ).rows[0] as { id: string };
    await db.query(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active, archived_at)
       VALUES ($1, 'Gone', 2, 2, 3, false, now())`,
      [ids.propertyId],
    );
    const draft = (
      await db.query(
        `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, max_children, total_units, is_active)
         VALUES ($1, 'Attic', 2, 3, 1, 2, false) RETURNING id`,
        [ids.propertyId],
      )
    ).rows[0] as { id: string };

    const rooms = await stay();
    expect(rooms.map((r) => r.roomId)).toEqual([draft.id, ids.roomId]); // by name: Attic, Double
    expect(rooms[0]).toMatchObject({ onSale: false, maxAdults: 3, maxChildren: 1, total: 2, ratePlans: [] });
    expect(rooms[1].ratePlans.map((p) => p.ratePlanId)).toEqual([ids.ratePlanId]);
    expect(rooms[1].ratePlans.map((p) => p.ratePlanId)).not.toContain(inactive.id);
  });

  test("search reason: sold out", async () => {
    await db.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    await confirmedBooking({ nights: 1 });
    expect(await search()).toEqual({ propertyId: ids.propertyId, bookable: false, reason: "sold_out" });
  });

  test("search reason: too many guests, unless spread over rooms", async () => {
    await db.query(`UPDATE rooms SET max_adults = 1, total_units = 2 WHERE id = $1`, [ids.roomId]);
    expect(await search({ adults: 2, rooms: 1 })).toEqual({
      propertyId: ids.propertyId,
      bookable: false,
      reason: "too_many_guests",
    });
    expect(await search({ adults: 2, rooms: 2 })).toEqual({ propertyId: ids.propertyId, bookable: true, reason: null });
  });

  test("search reason: plan rules surface when nothing qualifies", async () => {
    await db.query(`UPDATE rate_plans SET min_stay = 5 WHERE id = $1`, [ids.ratePlanId]);
    expect(await search()).toEqual({ propertyId: ids.propertyId, bookable: false, reason: "min_stay" });
  });

  test("search: mixed room types add up", async () => {
    await db.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    const twin = (
      await db.query(
        `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active)
         VALUES ($1, 'Twin', 2, 2, 1, true) RETURNING id`,
        [ids.propertyId],
      )
    ).rows[0] as { id: string };
    await db.query(`INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active) VALUES ($1, 'Room only', 90, true, true)`, [
      twin.id,
    ]);

    expect(await search({ adults: 2, rooms: 2 })).toEqual({ propertyId: ids.propertyId, bookable: true, reason: null });
    expect(await search({ adults: 3, rooms: 3 })).toEqual({ propertyId: ids.propertyId, bookable: false, reason: "sold_out" });
  });

  test("search: every requested property gets an answer", async () => {
    const other = await seedProperty(db);
    await db.query(`UPDATE rooms SET is_active = false WHERE id = $1`, [other.roomId]);
    const result = await loadSearchAvailability(db, {
      propertyIds: [ids.propertyId, other.propertyId],
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      adults: 2,
      children: 0,
      rooms: 1,
      now: NOW,
    });
    expect(result.get(ids.propertyId)).toEqual({ propertyId: ids.propertyId, bookable: true, reason: null });
    expect(result.get(other.propertyId)).toEqual({ propertyId: other.propertyId, bookable: false, reason: "not_on_sale" });
  });
});

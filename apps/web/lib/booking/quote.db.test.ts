/**
 * The stay quote and the server-side re-pricing of a selection. Every test
 * runs in a transaction that is rolled back; skipped locally without
 * DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedProperty,
} from "@openbookings/db/testing";
import { applicationFeeCents } from "@openbookings/stripe/fees";
import { priceSelection, quoteStay, type SelectedRoom } from "./quote";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-13"; // 3 nights
const NOW = new Date("2031-10-01T10:00:00Z");
const STAY = { checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0, rooms: 1 };

describeWithDb("stay quote against Postgres", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  const feeFlag = process.env.STRIPE_APPLICATION_FEE_ENABLED;

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
    if (feeFlag === undefined) delete process.env.STRIPE_APPLICATION_FEE_ENABLED;
    else process.env.STRIPE_APPLICATION_FEE_ENABLED = feeFlag;
  });

  const quote = (testing = false) => quoteStay(db, { propertyId: ids.propertyId, stay: STAY, now: NOW, testing });
  const select = (selection: SelectedRoom[], propertyId = ids.propertyId) =>
    priceSelection(db, { propertyId, checkIn: CHECK_IN, checkOut: CHECK_OUT, selection, now: NOW, testing: false });
  const double = (over: Partial<SelectedRoom> = {}): SelectedRoom => ({
    roomId: ids.roomId,
    ratePlanId: ids.ratePlanId,
    adults: 2,
    children: 0,
    ...over,
  });

  async function nrPlan(bar: number): Promise<string> {
    const { rows } = await db.query(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active) VALUES ($1, $2, $3, false, true) RETURNING id`,
      [ids.roomId, `Non-refundable ${bar}`, bar],
    );
    return (rows[0] as { id: string }).id;
  }

  test("an override of 2 and one confirmed booking leave one unit", async () => {
    await db.query(
      `INSERT INTO room_inventory (room_id, date, available_override)
       SELECT $1, d::date, 2 FROM generate_series($2::date, $3::date - 1, INTERVAL '1 day') d`,
      [ids.roomId, CHECK_IN, CHECK_OUT],
    );
    const booking = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 3 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [booking.bookingId]);

    const q = await quote();
    expect(q).not.toBeNull();
    const room = q!.rooms.find((r) => r.roomId === ids.roomId)!;
    expect(room).toMatchObject({ total: 2, unitsLeft: 1, reasons: [] });
    expect(q!.currency).toBe("EUR");
    expect(q!.stay).toEqual(STAY);
  });

  test("prices every night and the tourist tax for the per-room party", async () => {
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges, children_exempt)
       VALUES ($1, '2031-01-01', '[{"kind":"fixed","amount":2.5,"perPerson":true,"perNight":true,"perRoom":false}]'::jsonb, true)`,
      [ids.propertyId],
    );
    const plan = (await quote())!.rooms[0].ratePlans[0];
    expect(plan).toMatchObject({
      ratePlanId: ids.ratePlanId,
      name: "Room only",
      isRefundable: true,
      mealPlan: null,
      stayTotal: 300,
      reasons: [],
    });
    expect(plan.nights).toEqual([
      { date: "2031-11-10", price: 100 },
      { date: "2031-11-11", price: 100 },
      { date: "2031-11-12", price: 100 },
    ]);
    expect(plan.touristTax.total).toBe(15); // 2 adults × 3 nights × €2.50
    expect(plan.freeCancellationUntil).not.toBeNull();
  });

  test("a Non-refundable rate not at least 10% cheaper is left out", async () => {
    const tooDear = await nrPlan(95);
    const cheapEnough = await nrPlan(90);
    const plans = (await quote())!.rooms[0].ratePlans.map((p) => p.ratePlanId);
    expect(plans).toContain(ids.ratePlanId);
    expect(plans).toContain(cheapEnough);
    expect(plans).not.toContain(tooDear);
  });

  test("rate restrictions come back as reasons, not as missing rates", async () => {
    await db.query(`UPDATE rate_plans SET min_stay = 5 WHERE id = $1`, [ids.ratePlanId]);
    const plan = (await quote())!.rooms[0].ratePlans[0];
    expect(plan.reasons).toEqual(["min_stay"]);
  });

  test("a demo hotel is quoted only in testing mode", async () => {
    await db.query(`UPDATE properties SET is_demo = true WHERE id = $1`, [ids.propertyId]);
    expect(await quote(false)).toBeNull();
    expect((await quote(true))?.propertyId).toBe(ids.propertyId);
  });

  test("selection: a room of another property is invalid", async () => {
    const other = await seedProperty(db);
    const r = await select([double({ roomId: other.roomId, ratePlanId: other.ratePlanId })]);
    expect(r).toMatchObject({ ok: false, error: "invalid_selection" });
  });

  test("selection: a hidden Non-refundable rate is invalid", async () => {
    const tooDear = await nrPlan(95);
    expect(await select([double({ ratePlanId: tooDear })])).toMatchObject({ ok: false, error: "invalid_selection" });
  });

  test("selection: a demo hotel is invalid with testing off", async () => {
    await db.query(`UPDATE properties SET is_demo = true WHERE id = $1`, [ids.propertyId]);
    expect(await select([double()])).toMatchObject({ ok: false, error: "invalid_selection" });
  });

  test("selection: three adults in a two-adult room is too many guests", async () => {
    const r = await select([double({ adults: 3 })]);
    expect(r).toMatchObject({ ok: false, error: "too_many_guests" });
    if (!r.ok) expect(r.detail).toContain("Double");
  });

  test("selection: two units of a room with one left is unavailable", async () => {
    await db.query(
      `INSERT INTO room_inventory (room_id, date, available_override)
       SELECT $1, d::date, 1 FROM generate_series($2::date, $3::date - 1, INTERVAL '1 day') d`,
      [ids.roomId, CHECK_IN, CHECK_OUT],
    );
    const r = await select([double(), double()]);
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    if (!r.ok) expect(r.detail).toContain("Double");
  });

  test("selection: a rate with a reason is unavailable", async () => {
    await db.query(`UPDATE rate_plans SET min_stay = 5 WHERE id = $1`, [ids.ratePlanId]);
    expect(await select([double()])).toMatchObject({ ok: false, error: "unavailable" });
  });

  test("selection: two rooms add up, with commission only when the fee is on", async () => {
    process.env.STRIPE_APPLICATION_FEE_ENABLED = "true";
    const r = await select([double(), double({ adults: 1 })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rooms).toHaveLength(2);
    expect(r.rooms.map((x) => x.adults)).toEqual([2, 1]);
    expect(r.rooms[0].nights).toHaveLength(3);
    const sum = r.rooms.reduce((s, x) => s + x.stayTotal, 0);
    expect(r.snapshot.roomsTotal).toBe(sum);
    expect(r.snapshot.total).toBe(r.snapshot.roomsTotal + r.snapshot.touristTaxTotal);
    expect(r.snapshot.currency).toBe("EUR");
    const rate = Number(
      ((await db.query(`SELECT commission_rate FROM properties WHERE id = $1`, [ids.propertyId])).rows[0] as {
        commission_rate: string;
      }).commission_rate,
    );
    expect(r.snapshot.commissionCents).toBe(applicationFeeCents(Math.round(r.snapshot.roomsTotal * 100), rate));
    expect(r.snapshot.commissionCents).toBeGreaterThan(0);
    expect(r.snapshot.rooms[0]).toMatchObject({
      roomId: ids.roomId,
      ratePlanId: ids.ratePlanId,
      roomName: "Double",
      ratePlanName: "Room only",
      isRefundable: true,
    });

    process.env.STRIPE_APPLICATION_FEE_ENABLED = "false";
    const off = await select([double(), double({ adults: 1 })]);
    expect(off.ok && off.snapshot.commissionCents).toBe(0);
  });
});

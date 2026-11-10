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
    cots: 0,
    extraBeds: 0,
    ...over,
  });

  async function nrPlan(bar: number): Promise<string> {
    const { rows } = await db.query(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable, is_active) VALUES ($1, $2, $3, false, true) RETURNING id`,
      [ids.roomId, `Non-refundable ${bar}`, bar],
    );
    return (rows[0] as { id: string }).id;
  }

  test("a guest above base occupancy pays the room's extra-adult fee every night", async () => {
    await db.query(`UPDATE rooms SET max_adults = 3, extra_adult_fee = 20 WHERE id = $1`, [ids.roomId]);
    const q = await quoteStay(db, { propertyId: ids.propertyId, stay: { ...STAY, adults: 3 }, now: NOW, testing: false });
    const plan = q!.rooms[0].ratePlans[0];
    expect(plan.stayTotal).toBe(3 * (100 + 20));
    expect(plan.nights.map((n) => n.price)).toEqual([120, 120, 120]);
  });

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

  test("a Non-refundable rate is left out when the refundable one beside it is restricted", async () => {
    await db.query(`UPDATE rate_plans SET min_stay = 5 WHERE id = $1`, [ids.ratePlanId]);
    const nr = await nrPlan(85);
    const plans = (await quote())!.rooms[0].ratePlans;
    expect(plans.map((p) => p.ratePlanId)).toEqual([ids.ratePlanId]);
    expect(plans[0].reasons).toEqual(["min_stay"]);
    expect(await select([double({ ratePlanId: nr })])).toMatchObject({ ok: false, error: "invalid_selection" });
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

  test("selection: stays outside the quote's bounds are invalid", async () => {
    const at = (checkIn: string, checkOut: string, selection = [double()]) =>
      priceSelection(db, { propertyId: ids.propertyId, checkIn, checkOut, selection, now: NOW, testing: false });
    // NOW is 2031-10-01 in Europe/Amsterdam.
    expect(await at("2031-09-30", "2031-10-02")).toMatchObject({ ok: false, error: "invalid_selection" });
    expect(await at("2031-11-10", "2031-12-11")).toMatchObject({ ok: false, error: "invalid_selection" }); // 31 nights
    expect(await at("2031-02-30", "2031-03-02")).toMatchObject({ ok: false, error: "invalid_selection" });
    expect(await at("2031-11-13", "2031-11-10")).toMatchObject({ ok: false, error: "invalid_selection" });
    const ten = Array.from({ length: 10 }, () => double({ adults: 1 }));
    expect(await at(CHECK_IN, CHECK_OUT, ten)).toMatchObject({ ok: false, error: "invalid_selection" });
    // Today itself and 30 nights are fine.
    expect((await at("2031-10-01", "2031-10-31")).ok).toBe(true);
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

  test("selection: more cots or extra beds than the room takes are invalid", async () => {
    await db.query(`UPDATE rooms SET cots_max = 1, cot_fee = 0, extra_beds_max = 0 WHERE id = $1`, [ids.roomId]);
    const tooManyCots = await select([double({ cots: 2 })]);
    expect(tooManyCots).toMatchObject({ ok: false, error: "invalid_selection", detail: "Double: at most 1 cot" });
    const noBeds = await select([double({ extraBeds: 1 })]);
    expect(noBeds).toMatchObject({ ok: false, error: "invalid_selection", detail: "Double: no extra beds" });
  });

  test("selection: a cot and an extra bed together only where the room allows it", async () => {
    await db.query(
      `UPDATE rooms SET cots_max = 1, cot_fee = 0, extra_beds_max = 1, extra_bed_fee = 25,
                        cot_and_extra_bed_together = false WHERE id = $1`,
      [ids.roomId],
    );
    const both = await select([double({ cots: 1, extraBeds: 1 })]);
    expect(both).toMatchObject({
      ok: false,
      error: "invalid_selection",
      detail: "Double: a cot and an extra bed cannot be combined",
    });
  });

  test("selection: an extra bed is priced into every night and kept on the intent room", async () => {
    await db.query(`UPDATE rooms SET extra_beds_max = 1, extra_bed_fee = 25 WHERE id = $1`, [ids.roomId]);
    const r = await select([double({ extraBeds: 1 })]);
    if (!r.ok) throw new Error(r.detail);
    expect(r.rooms[0]).toMatchObject({ cots: 0, extraBeds: 1, stayTotal: 3 * 125 });
    expect(r.rooms[0].nights.map((n) => n.price)).toEqual([125, 125, 125]);
    expect(r.snapshot.roomsTotal).toBe(375);
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
  test("selection: the commission split follows the host's billing profile, never refusing without one", async () => {
    process.env.STRIPE_APPLICATION_FEE_ENABLED = "true";
    const none = await select([double()]);
    expect(none.ok).toBe(true);
    if (!none.ok) return;
    expect(none.snapshot.commissionVatTreatment).toBeNull();
    expect(none.snapshot.commissionNetCents).toBeNull();
    expect(none.snapshot.commissionVatCents).toBeNull();
    expect(none.snapshot.commissionRate).toBeGreaterThan(0);

    const org = { organization_id: `org-${crypto.randomUUID()}` };
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [
      org.organization_id,
    ]);
    await db.query(`UPDATE properties SET organization_id = $2 WHERE id = $1`, [ids.propertyId, org.organization_id]);
    await db.query(`INSERT INTO billing_profiles (organization_id, country_code) VALUES ($1, 'NL')`, [org.organization_id]);
    const nl = await select([double()]);
    if (!nl.ok) throw new Error(nl.error);
    expect(nl.snapshot.commissionVatTreatment).toBe("NL_DOMESTIC");
    expect(nl.snapshot.commissionNetCents! + nl.snapshot.commissionVatCents!).toBe(nl.snapshot.commissionCents);
    expect(nl.snapshot.commissionVatCents).toBeGreaterThan(0);

    await db.query(`UPDATE billing_profiles SET country_code = 'DE' WHERE organization_id = $1`, [org.organization_id]);
    const de = await select([double()]);
    if (!de.ok) throw new Error(de.error);
    expect(de.snapshot.commissionVatTreatment).toBe("EU_REVERSE_CHARGE");
    expect(de.snapshot.commissionNetCents).toBe(de.snapshot.commissionCents);
    expect(de.snapshot.commissionVatCents).toBe(0);
  });
});

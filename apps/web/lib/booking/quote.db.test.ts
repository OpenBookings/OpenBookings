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
import { priceSelection, priceTonight, quoteStay, type SelectedRoom } from "./quote";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-13"; // 3 nights
const NOW = new Date("2031-10-01T10:00:00Z");
const STAY = { checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0, infants: 0, rooms: 1 };

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
    infants: 0,
    cots: 0,
    extraBeds: 0,
    ...over,
  });

  async function nrPlan(barCents: number): Promise<string> {
    const { rows } = await db.query(
      `INSERT INTO rate_plans (room_id, name, bar_cents, is_refundable, is_active) VALUES ($1, $2, $3, false, true) RETURNING id`,
      [ids.roomId, `Non-refundable ${barCents}`, barCents],
    );
    return (rows[0] as { id: string }).id;
  }

  test("a guest above base occupancy pays the room's extra-adult fee every night", async () => {
    await db.query(`UPDATE rooms SET max_adults = 3, extra_adult_fee_cents = 2000 WHERE id = $1`, [ids.roomId]);
    const q = await quoteStay(db, { propertyId: ids.propertyId, stay: { ...STAY, adults: 3 }, now: NOW, testing: false });
    const plan = q!.rooms[0].ratePlans[0];
    expect(plan.stayTotalCents).toBe(3 * (10000 + 2000));
    expect(plan.nights.map((n) => n.priceCents)).toEqual([12000, 12000, 12000]);
  });

  test("a plan priced at €186.50 quotes 18650 cents for one night, to the cent", async () => {
    await db.query(`UPDATE rate_plans SET bar_cents = 18650 WHERE id = $1`, [ids.ratePlanId]);
    const stay = { ...STAY, checkOut: "2031-11-11" };
    const plan = (await quoteStay(db, { propertyId: ids.propertyId, stay, now: NOW, testing: false }))!.rooms[0].ratePlans[0];
    expect(plan.nights).toEqual([{ date: "2031-11-10", priceCents: 18650 }]);
    expect(plan.stayTotalCents).toBe(18650);
    expect(plan.totalCents).toBe(18650);
    expect(Number.isInteger(plan.totalCents)).toBe(true);
  });

  test("tourist tax of 6.5% on a €186.50 night is 1212 cents, in the quote's tax lines", async () => {
    await db.query(`UPDATE rate_plans SET bar_cents = 18650 WHERE id = $1`, [ids.ratePlanId]);
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges, children_exempt)
       VALUES ($1, '2031-01-01', '[{"kind":"percent","percent":6.5,"perPerson":false,"perNight":true,"perRoom":false}]'::jsonb, true)`,
      [ids.propertyId],
    );
    const stay = { ...STAY, checkOut: "2031-11-11" };
    const plan = (await quoteStay(db, { propertyId: ids.propertyId, stay, now: NOW, testing: false }))!.rooms[0].ratePlans[0];
    expect(plan.touristTax.totalCents).toBe(1212);
    expect(plan.touristTax.lines.map((l) => l.amountCents)).toEqual([1212]);
    expect(plan.totalCents).toBe(18650 + 1212);
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

  test("another guest's hold counts as held by others; the viewer's own does not", async () => {
    // An open, unexpired hold on one unit for the first night only.
    const hold = async (userId: string) => {
      const { rows } = await db.query(
        `INSERT INTO booking_intents
           (user_id, property_id, check_in_date, check_out_date, status, hold_expires_at, snapshot, total_cents)
         VALUES ($1, $2, $3::date, $3::date + 1, 'open', $4::timestamptz + INTERVAL '10 minutes', '{}'::jsonb, 10000)
         RETURNING id`,
        [userId, ids.propertyId, CHECK_IN, NOW],
      );
      const intentId = (rows[0] as { id: string }).id;
      await db.query(
        `INSERT INTO booking_intent_rooms (intent_id, room_id, rate_plan_id, adults, nights, stay_total_cents)
         VALUES ($1, $2, $3, 2, '[]'::jsonb, 10000)`,
        [intentId, ids.roomId, ids.ratePlanId],
      );
      return intentId;
    };
    const room = async (viewerIntentId: string | null = null) =>
      (await quoteStay(db, { propertyId: ids.propertyId, stay: STAY, now: NOW, testing: false, viewerIntentId }))!.rooms.find(
        (r) => r.roomId === ids.roomId,
      )!;

    expect(await room()).toMatchObject({ unitsLeft: 5, heldByOthers: 0 });

    const mine = await hold(`test-guest-${crypto.randomUUID()}`);
    await hold(`test-guest-${crypto.randomUUID()}`);
    // Seen by a stranger: both holds, on the stay's busiest night.
    expect(await room()).toMatchObject({ unitsLeft: 3, heldByOthers: 2 });
    // Seen by the guest behind one of them: only the other one.
    expect(await room(mine)).toMatchObject({ unitsLeft: 4, heldByOthers: 1 });
  });

  test("prices every night and the tourist tax for the per-room party", async () => {
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges, children_exempt)
       VALUES ($1, '2031-01-01', '[{"kind":"fixed","amountCents":250,"perPerson":true,"perNight":true,"perRoom":false}]'::jsonb, true)`,
      [ids.propertyId],
    );
    const plan = (await quote())!.rooms[0].ratePlans[0];
    expect(plan).toMatchObject({
      ratePlanId: ids.ratePlanId,
      name: "Room only",
      isRefundable: true,
      mealPlan: null,
      stayTotalCents: 30000,
      reasons: [],
    });
    expect(plan.nights).toEqual([
      { date: "2031-11-10", priceCents: 10000 },
      { date: "2031-11-11", priceCents: 10000 },
      { date: "2031-11-12", priceCents: 10000 },
    ]);
    expect(plan.touristTax.totalCents).toBe(1500); // 2 adults × 3 nights × €2.50
    expect(plan.totalCents).toBe(31500);
    expect(plan.freeCancellationUntil).not.toBeNull();
  });

  test("an uneven party: the quote prices each share, and they add up to what the selection charges", async () => {
    // 3 adults in 2 rooms: one room gets 2, the other 1. Base occupancy 1 with
    // an extra-adult fee and a per-person tourist tax, so the shares differ.
    await db.query(`UPDATE rooms SET base_occupancy = 1, max_adults = 2, extra_adult_fee_cents = 2000 WHERE id = $1`, [ids.roomId]);
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges, children_exempt)
       VALUES ($1, '2031-01-01', '[{"kind":"fixed","amountCents":250,"perPerson":true,"perNight":true,"perRoom":false}]'::jsonb, true)`,
      [ids.propertyId],
    );
    const stay = { ...STAY, adults: 3, rooms: 2 };
    const plan = (await quoteStay(db, { propertyId: ids.propertyId, stay, now: NOW, testing: false }))!.rooms[0].ratePlans[0];
    // The rate row is for the larger share.
    expect(plan.totalCents).toBe(3 * 12000 + 2 * 3 * 250);
    expect(plan.partyTotals["2/0/0"]).toBe(37500);
    expect(plan.partyTotals["1/0/0"]).toBe(30750);

    const priced = await select([double({ adults: 2 }), double({ adults: 1 })]);
    expect(priced.ok && priced.snapshot.totalCents).toBe(37500 + 30750);
  });

  test("tonight's listing price is the quote's: an override and the tourist tax count", async () => {
    const today = "2031-10-01"; // NOW in Europe/Amsterdam
    await db.query(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night_cents) VALUES ($1, $2, $2, 14000)`,
      [ids.ratePlanId, today],
    );
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges, children_exempt)
       VALUES ($1, '2031-01-01', '[{"kind":"fixed","amountCents":250,"perPerson":true,"perNight":true,"perRoom":false}]'::jsonb, true)`,
      [ids.propertyId],
    );
    const tonight = await priceTonight(db, { id: ids.propertyId, timezone: "Europe/Amsterdam" }, NOW);
    // 140 for the night, plus 2 adults (base occupancy) × €2.50.
    expect(tonight[ids.ratePlanId]).toEqual({ priceCents: 14500, sellable: true });
  });

  test("tonight's listing price: a rate that can't be sold for one night says so", async () => {
    await db.query(`UPDATE rate_plans SET min_stay = 2 WHERE id = $1`, [ids.ratePlanId]);
    await db.query(`UPDATE rate_plans SET is_active = false, archived_at = now() WHERE id = $1`, [await nrPlan(8000)]);
    const tonight = await priceTonight(db, { id: ids.propertyId, timezone: "Europe/Amsterdam" }, NOW);
    expect(tonight[ids.ratePlanId]).toEqual({ priceCents: 10000, sellable: false });
    // An archived rate is not priced at all.
    expect(Object.keys(tonight)).toEqual([ids.ratePlanId]);
  });

  test("a Non-refundable rate not at least 10% cheaper is left out", async () => {
    const tooDear = await nrPlan(9500);
    const cheapEnough = await nrPlan(9000);
    const plans = (await quote())!.rooms[0].ratePlans.map((p) => p.ratePlanId);
    expect(plans).toContain(ids.ratePlanId);
    expect(plans).toContain(cheapEnough);
    expect(plans).not.toContain(tooDear);
  });

  test("a Non-refundable rate is left out when the refundable one beside it is restricted", async () => {
    await db.query(`UPDATE rate_plans SET min_stay = 5 WHERE id = $1`, [ids.ratePlanId]);
    const nr = await nrPlan(8500);
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
    const tooDear = await nrPlan(9500);
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
    await db.query(`UPDATE rooms SET cots_max = 1, cot_fee_cents = 0, extra_beds_max = 0 WHERE id = $1`, [ids.roomId]);
    const tooManyCots = await select([double({ cots: 2 })]);
    expect(tooManyCots).toMatchObject({ ok: false, error: "invalid_selection", detail: "Double: at most 1 cot" });
    const noBeds = await select([double({ extraBeds: 1 })]);
    expect(noBeds).toMatchObject({ ok: false, error: "invalid_selection", detail: "Double: no extra beds" });
  });

  test("selection: a cot and an extra bed together only where the room allows it", async () => {
    await db.query(
      `UPDATE rooms SET cots_max = 1, cot_fee_cents = 0, extra_beds_max = 1, extra_bed_fee_cents = 2500,
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

  test("selection: an extra bed is kept on the intent room and paid at the property, not charged", async () => {
    await db.query(`UPDATE rooms SET extra_beds_max = 1, extra_bed_fee_cents = 2500 WHERE id = $1`, [ids.roomId]);
    const r = await select([double({ extraBeds: 1 })]);
    if (!r.ok) throw new Error(r.detail);
    expect(r.rooms[0]).toMatchObject({ cots: 0, extraBeds: 1, stayTotalCents: 30000, payAtPropertyCents: 7500 });
    expect(r.rooms[0].nights.map((n) => n.priceCents)).toEqual([10000, 10000, 10000]);
    expect(r.snapshot.roomsTotalCents).toBe(30000);
    expect(r.snapshot.totalCents).toBe(30000);
  });

  test("selection: an infant needs no free place and pays nothing", async () => {
    const r = await select([double({ infants: 1 })]);
    if (!r.ok) throw new Error(r.detail);
    expect(r.rooms[0]).toMatchObject({ adults: 2, infants: 1, stayTotalCents: 30000 });
  });

  test("selection: stores a VAT split for an NL breakfast rate", async () => {
    await db.query(`UPDATE properties SET breakfast_value_cents = 1800 WHERE id = $1`, [ids.propertyId]);
    await db.query(`UPDATE rooms SET max_children = 1 WHERE id = $1`, [ids.roomId]);
    await db.query(`UPDATE rate_plans SET includes_breakfast = true WHERE id = $1`, [ids.ratePlanId]);
    const r = await select([double({ children: 1, infants: 1 })]);
    if (!r.ok) throw new Error(r.detail);
    const split = r.rooms[0].vatSplit;
    expect(split).not.toBeNull();
    expect(split!.nights).toHaveLength(3);
    // 3 people (infants don't count) x EUR 18 = 54 of the night's price goes to breakfast.
    expect(split!.nights[0].breakfast!.grossCents).toBe(5400);
    expect(split!.breakfastValueMissing).toBe(false);
  });

  test("selection: a property in an unlisted country books fine with vat_split null", async () => {
    await db.query(`UPDATE properties SET country = 'CH' WHERE id = $1`, [ids.propertyId]);
    const r = await select([double()]);
    if (!r.ok) throw new Error(r.detail);
    expect(r.rooms[0].vatSplit).toBeNull();
  });

  test("quote: each rate says which discount applied", async () => {
    await db.query(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
       VALUES ($1, 'length_of_stay', '{"min_nights": 3}'::jsonb, 'percent', -10, true, 0)`,
      [ids.ratePlanId],
    );
    const plan = (await quote())!.rooms[0].ratePlans[0];
    expect(plan.discount).toEqual({ label: "3+ night discount", percent: 10, amountCents: 3000 });
  });

  test("selection: the discount that applied is kept for checkout", async () => {
    await db.query(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value, is_active, sort_order)
       VALUES ($1, 'length_of_stay', '{"min_nights": 3}'::jsonb, 'percent', -10, true, 0)`,
      [ids.ratePlanId],
    );
    const r = await select([double()]);
    if (!r.ok) throw new Error(r.detail);
    expect(r.rooms[0]).toMatchObject({ stayTotalCents: 27000, discount: { label: "3+ night discount", amountCents: 3000 } });
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
    const sum = r.rooms.reduce((s, x) => s + x.stayTotalCents, 0);
    expect(r.snapshot.roomsTotalCents).toBe(sum);
    expect(r.snapshot.totalCents).toBe(r.snapshot.roomsTotalCents + r.snapshot.touristTaxTotalCents);
    expect(r.snapshot.currency).toBe("EUR");
    const rate = Number(
      ((await db.query(`SELECT commission_rate FROM properties WHERE id = $1`, [ids.propertyId])).rows[0] as {
        commission_rate: string;
      }).commission_rate,
    );
    expect(r.snapshot.commissionCents).toBe(applicationFeeCents(r.snapshot.roomsTotalCents, rate));
    expect(r.snapshot.commissionCents).toBeGreaterThan(0);
    expect(r.snapshot.rooms[0]).toMatchObject({
      roomId: ids.roomId,
      ratePlanId: ids.ratePlanId,
      roomName: "Double",
      ratePlanName: "Room only",
      isRefundable: true,
      // Kept so the booking is confirmed under the tier the guest was shown.
      cancellationTier: "flex",
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

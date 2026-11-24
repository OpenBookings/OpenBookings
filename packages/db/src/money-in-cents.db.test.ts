/**
 * drizzle/0058_money_in_cents.sql: every money amount moves from euros to
 * integer cents, under a `_cents` / `Cents` name. Rows are written in the old
 * shape (the schema just before 0058), then the migration runs on them.
 *
 * Runs locally only: CI applies every pending migration before the tests, so
 * the old shape is gone there (see canReplayPendingMigrations).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import {
  applyPendingMigrationsBefore,
  connectionString,
  seedGuest,
} from "./testing/db-harness";
import { pendingMigrationSql } from "./testing/pending-migrations";

const MIGRATION = "0058_money_in_cents.sql";

type Fixture = {
  propertyId: string;
  roomId: string;
  ratePlanId: string;
  flatModifierId: string;
  percentModifierId: string;
  overrideId: string;
  bookingId: string;
  legacyBookingId: string;
  reservationId: string;
  refundId: string;
  goodwillRefundId: string;
  intentId: string;
  intentRoomId: string;
  chargeId: string;
  legacyChargeId: string;
};

// 0058 is on the dev database; this verified the conversion before it was applied.
describe.skip("0058 money in cents", () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrationsBefore(db, MIGRATION);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const one = async (sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0];
  const id = async (sql: string, values: unknown[] = []) => (await one(sql, values)).id as string;
  const migrate = () => db.query(pendingMigrationSql(MIGRATION));

  /** One of everything that holds money, in the shape before 0058. */
  async function seedOldShape(): Promise<Fixture> {
    const userId = await seedGuest(db);
    const propertyId = await id(
      `INSERT INTO properties
         (name, slug, address_line_1, city, country, timezone, location, check_in_time, check_out_time, breakfast_value)
       VALUES ('Cents Hotel', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326), '15:00', '11:00', 12.50)
       RETURNING id`,
      [`cents-hotel-${crypto.randomUUID()}`],
    );
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges)
       VALUES ($1, '2031-01-01', $2::jsonb), ($1, '2032-01-01', $3::jsonb)`,
      [
        propertyId,
        JSON.stringify([{ kind: "fixed", amount: 3.5, perPerson: true, perNight: true, perRoom: false }]),
        JSON.stringify([
          { kind: "percent", amount: 6.5, perPerson: false, perNight: false, perRoom: false, vatIncludedPercent: 9 },
        ]),
      ],
    );
    const roomId = await id(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, max_children, total_units,
                          extra_adult_fee, extra_child_fee, cots_max, cot_fee, extra_beds_max, extra_bed_fee)
       VALUES ($1, 'Double', 2, 3, 1, 4, 25, 15, 1, 0, 1, 30) RETURNING id`,
      [propertyId],
    );
    const ratePlanId = await id(
      `INSERT INTO rate_plans (room_id, name, bar, is_refundable) VALUES ($1, 'Room only', 100, true) RETURNING id`,
      [roomId],
    );
    const overrideId = await id(
      `INSERT INTO rate_overrides (rate_plan_id, start_date, end_date, price_per_night)
       VALUES ($1, '2031-03-01', '2031-03-07', 120) RETURNING id`,
      [ratePlanId],
    );
    const flatModifierId = await id(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value)
       VALUES ($1, 'day_of_week', '{"days_of_week":[5,6]}', 'flat', 15) RETURNING id`,
      [ratePlanId],
    );
    const percentModifierId = await id(
      `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value)
       VALUES ($1, 'length_of_stay', '{"min_nights":7}', 'percent', -10) RETURNING id`,
      [ratePlanId],
    );

    // A booking written before 0035 filled total_cents: only whole-euro totals.
    const bookingId = await id(
      `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, total_amount, booking_fee_amount)
       VALUES ($1, $2, '2031-03-02', '2031-03-03', 'confirmed', 190, 0) RETURNING id`,
      [propertyId, userId],
    );
    const reservationId = await id(
      `INSERT INTO reservations
         (booking_id, room_id, rate_plan_id, adults, total_nights, price_per_night, total_amount,
          tourist_tax_amount, pay_at_property_amount, nights, tourist_tax_lines, vat_split)
       VALUES ($1, $2, $3, 2, 1, 187, 187, 7.35, 20.50, $4::jsonb, $5::jsonb, $6::jsonb) RETURNING id`,
      [
        bookingId,
        roomId,
        ratePlanId,
        JSON.stringify([{ date: "2031-03-02", price: 186.5, touristTax: 3.5 }]),
        JSON.stringify([{ label: "€3.50 per person per night", amount: 7.35, effectiveFrom: "2031-01-01" }]),
        JSON.stringify({
          nights: [
            {
              date: "2031-03-02",
              room: { gross: 161.5, rate: 9, vat: 13.33 },
              breakfast: { gross: 25, rate: 9, vat: 2.06 },
            },
          ],
          totals: [
            { part: "accommodation", gross: 161.5, rate: 9, vat: 13.33 },
            { part: "breakfast", gross: 25, rate: 9, vat: 2.06 },
          ],
          breakfastValueMissing: false,
        }),
      ],
    );
    // No reservations, no total_cents: its whole-euro total is all there is.
    const legacyBookingId = await id(
      `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, total_amount)
       VALUES ($1, $2, '2031-04-01', '2031-04-03', 'confirmed', 240) RETURNING id`,
      [propertyId, userId],
    );

    const refundId = await id(
      `INSERT INTO refunds (booking_id, reservation_id, reason, accommodation_amount, tourist_tax_amount, amount,
                            breakdown, status, idempotency_key)
       VALUES ($1, $2, 'guest_cancellation', 93.25, 1.75, 95.00, $3::jsonb, 'succeeded', $4) RETURNING id`,
      [
        bookingId,
        reservationId,
        JSON.stringify({
          rule: "early_departure",
          refund: { accommodation: 93.25, touristTax: 1.75, total: 95 },
          retained: { accommodation: 93.25, touristTax: 1.75, total: 95 },
          nightsRefunded: [{ date: "2031-03-02", share: 0.5 }],
        }),
        `cents-test:${crypto.randomUUID()}`,
      ],
    );
    const goodwillRefundId = await id(
      `INSERT INTO refunds (booking_id, reason, accommodation_amount, tourist_tax_amount, amount, breakdown, idempotency_key)
       VALUES ($1, 'goodwill', 12.5, 0, 12.5, '{"requested": 20, "capped": 12.5}', $2) RETURNING id`,
      [bookingId, `cents-test:${crypto.randomUUID()}`],
    );

    const events: [string, Record<string, unknown>][] = [
      ["confirmed", { intentId: "x", paymentIntentId: "pi_x", amountCents: 38650, snapshotTotal: 386.5 }],
      ["refund_succeeded", { refundId, amount: "95.00", stripeRefundId: "re_x" }],
      ["refund_failed", { refundId, amount: 95, error: "boom" }],
      ["goodwill_refund", { requested: 20, amount: 12.5, via: "admin" }],
      ["rooms_cancelled", { reservationIds: [reservationId], cancelsBooking: true, refundTotal: 95 }],
      ["outside_refund", { refundId, source: "dispute", stripeId: "dp_x", amount: 10.1 }],
      ["outside_refund_explained", { refundId, roomPrice: 8.1, touristTax: 2 }],
      [
        "forced_refund_deleted",
        {
          refund: {
            id: refundId,
            accommodation_amount: "93.25",
            tourist_tax_amount: "1.75",
            amount: "95.00",
            breakdown: { requested: 20, capped: 12.5 },
          },
        },
      ],
      ["checked_in", {}],
    ];
    for (const [kind, data] of events) {
      await db.query(
        `INSERT INTO booking_events (booking_id, kind, actor_kind, data) VALUES ($1, $2, 'system', $3::jsonb)`,
        [bookingId, kind, JSON.stringify(data)],
      );
    }

    // An intent created before the deploy, still open: paid after it (Review Focus 3).
    const intentId = await id(
      `INSERT INTO booking_intents
         (user_id, property_id, check_in_date, check_out_date, hold_expires_at, snapshot,
          total_amount, tourist_tax_amount, commission_cents)
       VALUES ($1, $2, '2031-03-02', '2031-03-04', now() + interval '15 minutes', $3::jsonb, 386.5, 13.5, 1679)
       RETURNING id`,
      [
        userId,
        propertyId,
        JSON.stringify({
          roomsTotal: 373,
          touristTaxTotal: 13.5,
          total: 386.5,
          commissionCents: 1679,
          commissionRate: 0.045,
          commissionVatTreatment: "NL_DOMESTIC",
          commissionNetCents: 1388,
          commissionVatCents: 291,
          currency: "EUR",
          rooms: [
            {
              roomId,
              ratePlanId,
              roomName: "Double",
              ratePlanName: "Room only",
              isRefundable: true,
              cancellationTier: "flex",
              freeCancellationUntil: null,
            },
          ],
        }),
      ],
    );
    const intentRoomId = await id(
      `INSERT INTO booking_intent_rooms
         (intent_id, room_id, rate_plan_id, adults, children, cots, pay_at_property_amount, discount_label,
          discount_amount, nights, rate_nights, extra_guests, pay_at_property_lines, vat_split, stay_total,
          tourist_tax_amount, tourist_tax_lines)
       VALUES ($1, $2, $3, 3, 0, 1, 20, 'Weekly discount', 41.45, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb,
               $8::jsonb, 373, 13.5, $9::jsonb)
       RETURNING id`,
      [
        intentId,
        roomId,
        ratePlanId,
        JSON.stringify([
          { date: "2031-03-02", price: 186.5 },
          { date: "2031-03-03", price: 186.5 },
        ]),
        JSON.stringify([
          { date: "2031-03-02", price: 182.25 },
          { date: "2031-03-03", price: 182.25 },
        ]),
        JSON.stringify([{ kind: "adult", count: 1, per_night: 25, nights: 2, amount: 50 }]),
        JSON.stringify([{ label: "Cots", count: 1, fee_per_night: 10, nights: 2, amount: 20 }]),
        JSON.stringify({
          nights: [{ date: "2031-03-02", room: { gross: 186.5, rate: 9, vat: 15.4 }, breakfast: null }],
          totals: [{ part: "accommodation", gross: 373, rate: 9, vat: 30.8 }],
          breakfastValueMissing: false,
        }),
        JSON.stringify([{ label: "€3.50 per person per night", amount: 13.5, effectiveFrom: "2031-01-01" }]),
      ],
    );

    const chargeId = await id(
      `INSERT INTO transactions (booking_id, type, provider_payment_id, amount, status, metadata)
       VALUES ($1, 'charge', 'pi_cents_test', 387, 'succeeded', '{"amountCents": 38650}') RETURNING id`,
      [bookingId],
    );
    const legacyChargeId = await id(
      `INSERT INTO transactions (booking_id, type, provider_payment_id, amount, status)
       VALUES ($1, 'charge', 'pi_cents_legacy', 240, 'succeeded') RETURNING id`,
      [legacyBookingId],
    );

    return {
      propertyId,
      roomId,
      ratePlanId,
      flatModifierId,
      percentModifierId,
      overrideId,
      bookingId,
      legacyBookingId,
      reservationId,
      refundId,
      goodwillRefundId,
      intentId,
      intentRoomId,
      chargeId,
      legacyChargeId,
    };
  }

  /** Every fixture row, as JSON, to compare before and after a second run. */
  async function fixtureRows(f: Fixture) {
    const rows = async (table: string, where: string, value: string) =>
      (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${where} = $1 ORDER BY t.id`, [value])).rows;
    return {
      properties: await rows("properties", "id", f.propertyId),
      touristTaxRules: await rows("tourist_tax_rules", "property_id", f.propertyId),
      rooms: await rows("rooms", "id", f.roomId),
      ratePlans: await rows("rate_plans", "id", f.ratePlanId),
      overrides: await rows("rate_overrides", "rate_plan_id", f.ratePlanId),
      modifiers: await rows("rate_modifiers", "rate_plan_id", f.ratePlanId),
      bookings: await rows("bookings", "hotel_id", f.propertyId),
      reservations: await rows("reservations", "booking_id", f.bookingId),
      refunds: await rows("refunds", "booking_id", f.bookingId),
      events: (
        await db.query(`SELECT kind, data FROM booking_events WHERE booking_id = $1 ORDER BY kind`, [f.bookingId])
      ).rows,
      intents: await rows("booking_intents", "id", f.intentId),
      intentRooms: await rows("booking_intent_rooms", "intent_id", f.intentId),
      transactions: (
        await db.query(`SELECT to_jsonb(t) AS row FROM transactions t WHERE id = ANY($1::uuid[]) ORDER BY id`, [
          [f.chargeId, f.legacyChargeId],
        ])
      ).rows,
    };
  }

  test("plan prices, room fees, breakfast value and flat modifiers become cents", async () => {
    const f = await seedOldShape();
    await migrate();

    expect(await one(`SELECT bar_cents FROM rate_plans WHERE id = $1`, [f.ratePlanId])).toEqual({ bar_cents: "10000" });
    expect(await one(`SELECT price_per_night_cents FROM rate_overrides WHERE id = $1`, [f.overrideId])).toEqual({
      price_per_night_cents: "12000",
    });
    expect(
      await one(
        `SELECT extra_adult_fee_cents, extra_child_fee_cents, cot_fee_cents, extra_bed_fee_cents FROM rooms WHERE id = $1`,
        [f.roomId],
      ),
    ).toEqual({ extra_adult_fee_cents: "2500", extra_child_fee_cents: "1500", cot_fee_cents: "0", extra_bed_fee_cents: "3000" });
    expect(await one(`SELECT breakfast_value_cents FROM properties WHERE id = $1`, [f.propertyId])).toEqual({
      breakfast_value_cents: "1250",
    });
    // A flat surcharge is money; a percentage is not.
    expect(await one(`SELECT adjustment_value FROM rate_modifiers WHERE id = $1`, [f.flatModifierId])).toEqual({
      adjustment_value: "1500",
    });
    expect(await one(`SELECT adjustment_value FROM rate_modifiers WHERE id = $1`, [f.percentModifierId])).toEqual({
      adjustment_value: "-10",
    });
  });

  test("tourist tax charges: fixed amounts become amountCents, percentages become percent", async () => {
    const f = await seedOldShape();
    await migrate();

    const { rows } = await db.query(
      `SELECT charges FROM tourist_tax_rules WHERE property_id = $1 ORDER BY effective_from`,
      [f.propertyId],
    );
    expect(rows.map((r) => r.charges)).toEqual([
      [{ kind: "fixed", amountCents: 350, perPerson: true, perNight: true, perRoom: false }],
      [{ kind: "percent", percent: 6.5, perPerson: false, perNight: false, perRoom: false, vatIncludedPercent: 9 }],
    ]);
  });

  test("reservations: columns and night, tax and VAT lines become cents", async () => {
    const f = await seedOldShape();
    await migrate();

    const r = await one(
      `SELECT price_per_night_cents, total_cents, tourist_tax_cents, pay_at_property_cents,
              nights, tourist_tax_lines, vat_split
         FROM reservations WHERE id = $1`,
      [f.reservationId],
    );
    // price_per_night and total_amount were rounded to whole euros; the nights keep the exact price.
    expect(r.price_per_night_cents).toBe("18650");
    expect(r.total_cents).toBe("18650");
    expect(r.tourist_tax_cents).toBe("735");
    expect(r.pay_at_property_cents).toBe("2050");
    expect(r.nights).toEqual([{ date: "2031-03-02", priceCents: 18650, touristTaxCents: 350 }]);
    // Labels keep the text they were shown with.
    expect(r.tourist_tax_lines).toEqual([
      { label: "€3.50 per person per night", amountCents: 735, effectiveFrom: "2031-01-01" },
    ]);
    expect(r.vat_split).toEqual({
      nights: [
        {
          date: "2031-03-02",
          room: { grossCents: 16150, rate: 9, vatCents: 1333 },
          breakfast: { grossCents: 2500, rate: 9, vatCents: 206 },
        },
      ],
      totals: [
        { part: "accommodation", grossCents: 16150, rate: 9, vatCents: 1333 },
        { part: "breakfast", grossCents: 2500, rate: 9, vatCents: 206 },
      ],
      breakfastValueMissing: false,
    });
  });

  test("bookings lose their whole-euro columns, keeping the cents split", async () => {
    const f = await seedOldShape();
    await migrate();

    const cols = (
      await db.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name IN ('total_amount', 'booking_fee_amount')`,
      )
    ).rows;
    expect(cols).toEqual([]);
    // Backfilled from its room's nights and tourist tax, like 0035 did.
    expect(
      await one(`SELECT rooms_total_cents, tourist_tax_cents, total_cents FROM bookings WHERE id = $1`, [f.bookingId]),
    ).toEqual({ rooms_total_cents: "18650", tourist_tax_cents: "735", total_cents: "19385" });
    // Nothing but the whole-euro total to go on.
    expect(
      await one(`SELECT rooms_total_cents, tourist_tax_cents, total_cents FROM bookings WHERE id = $1`, [
        f.legacyBookingId,
      ]),
    ).toEqual({ rooms_total_cents: "24000", tourist_tax_cents: "0", total_cents: "24000" });
  });

  test("refunds: columns and breakdowns become cents, the sum check holds on the new columns", async () => {
    const f = await seedOldShape();
    await migrate();

    const r = await one(
      `SELECT accommodation_cents, tourist_tax_cents, amount_cents, breakdown FROM refunds WHERE id = $1`,
      [f.refundId],
    );
    expect(r).toEqual({
      accommodation_cents: "9325",
      tourist_tax_cents: "175",
      amount_cents: "9500",
      breakdown: {
        rule: "early_departure",
        refund: { accommodationCents: 9325, touristTaxCents: 175, totalCents: 9500 },
        retained: { accommodationCents: 9325, touristTaxCents: 175, totalCents: 9500 },
        nightsRefunded: [{ date: "2031-03-02", share: 0.5 }],
      },
    });
    expect((await one(`SELECT breakdown FROM refunds WHERE id = $1`, [f.goodwillRefundId])).breakdown).toEqual({
      requestedCents: 2000,
      cappedCents: 1250,
    });

    await db.query("SAVEPOINT bad_sum");
    const error = await db
      .query(
        `INSERT INTO refunds (booking_id, reason, accommodation_cents, tourist_tax_cents, amount_cents, idempotency_key)
         VALUES ($1, 'goodwill', 100, 0, 101, $2)`,
        [f.bookingId, `cents-test:${crypto.randomUUID()}`],
      )
      .catch((e: { constraint?: string }) => e);
    await db.query("ROLLBACK TO SAVEPOINT bad_sum");
    expect((error as { constraint?: string }).constraint).toBe("refunds_amount_sum");

    // The admin console keeps its column grants (0054) under the new names.
    const grants = (
      await db.query(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_name = 'refunds' AND grantee = 'ob_admin_write' AND privilege_type = 'UPDATE'
            AND column_name IN ('accommodation_cents', 'tourist_tax_cents') ORDER BY 1`,
      )
    ).rows.map((g) => g.column_name);
    expect(grants).toEqual(["accommodation_cents", "tourist_tax_cents"]);
  });

  test("booking events: amounts become …Cents", async () => {
    const f = await seedOldShape();
    await migrate();

    const { rows } = await db.query(`SELECT kind, data FROM booking_events WHERE booking_id = $1 ORDER BY kind`, [
      f.bookingId,
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.kind, r.data]))).toEqual({
      checked_in: {},
      confirmed: { intentId: "x", paymentIntentId: "pi_x", amountCents: 38650, snapshotTotalCents: 38650 },
      forced_refund_deleted: {
        refund: {
          id: f.refundId,
          accommodation_cents: 9325,
          tourist_tax_cents: 175,
          amount_cents: 9500,
          breakdown: { requestedCents: 2000, cappedCents: 1250 },
        },
      },
      goodwill_refund: { requestedCents: 2000, amountCents: 1250, via: "admin" },
      outside_refund: { refundId: f.refundId, source: "dispute", stripeId: "dp_x", amountCents: 1010 },
      outside_refund_explained: { refundId: f.refundId, roomPriceCents: 810, touristTaxCents: 200 },
      refund_failed: { refundId: f.refundId, amountCents: 9500, error: "boom" },
      refund_succeeded: { refundId: f.refundId, amountCents: 9500, stripeRefundId: "re_x" },
      rooms_cancelled: { reservationIds: [f.reservationId], cancelsBooking: true, refundTotalCents: 9500 },
    });
  });

  test("an open intent's snapshot becomes cents, so a payment after the deploy still matches (Review Focus 3)", async () => {
    const f = await seedOldShape();
    await migrate();

    const intent = await one(
      `SELECT snapshot, total_cents, tourist_tax_cents, commission_cents, pg_typeof(commission_cents)::text AS commission_type
         FROM booking_intents WHERE id = $1`,
      [f.intentId],
    );
    expect(intent.snapshot.totalCents).toBe(38650);
    expect(intent.snapshot.roomsTotalCents).toBe(37300);
    expect(intent.snapshot.touristTaxTotalCents).toBe(1350);
    expect(intent.snapshot.commissionCents).toBe(1679);
    expect(intent.snapshot.commissionNetCents).toBe(1388);
    for (const old of ["total", "roomsTotal", "touristTaxTotal"]) expect(intent.snapshot).not.toHaveProperty(old);
    expect(intent.snapshot.rooms[0].roomName).toBe("Double");
    expect(intent.total_cents).toBe("38650");
    expect(intent.tourist_tax_cents).toBe("1350");
    expect(intent.commission_cents).toBe("1679");
    expect(intent.commission_type).toBe("bigint");

    const room = await one(
      `SELECT pay_at_property_cents, discount_cents, stay_total_cents, tourist_tax_cents, nights, rate_nights,
              extra_guests, pay_at_property_lines, vat_split, tourist_tax_lines
         FROM booking_intent_rooms WHERE id = $1`,
      [f.intentRoomId],
    );
    expect(room).toEqual({
      pay_at_property_cents: "2000",
      discount_cents: "4145",
      stay_total_cents: "37300",
      tourist_tax_cents: "1350",
      nights: [
        { date: "2031-03-02", priceCents: 18650 },
        { date: "2031-03-03", priceCents: 18650 },
      ],
      rate_nights: [
        { date: "2031-03-02", priceCents: 18225 },
        { date: "2031-03-03", priceCents: 18225 },
      ],
      extra_guests: [{ kind: "adult", count: 1, perNightCents: 2500, nights: 2, amountCents: 5000 }],
      pay_at_property_lines: [{ label: "Cots", count: 1, feePerNightCents: 1000, nights: 2, amountCents: 2000 }],
      vat_split: {
        nights: [{ date: "2031-03-02", room: { grossCents: 18650, rate: 9, vatCents: 1540 }, breakfast: null }],
        totals: [{ part: "accommodation", grossCents: 37300, rate: 9, vatCents: 3080 }],
        breakfastValueMissing: false,
      },
      tourist_tax_lines: [{ label: "€3.50 per person per night", amountCents: 1350, effectiveFrom: "2031-01-01" }],
    });
  });

  test("transactions get amount_cents from the exact charge, else the whole-euro amount", async () => {
    const f = await seedOldShape();
    await migrate();

    const { rows } = await db.query(`SELECT id, amount_cents FROM transactions WHERE id = ANY($1::uuid[])`, [
      [f.chargeId, f.legacyChargeId],
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.amount_cents]))).toEqual({
      [f.chargeId]: "38650",
      [f.legacyChargeId]: "24000",
    });
    const amount = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'amount'`,
    );
    expect(amount.rows).toEqual([]);
  });

  test("old columns are gone, new ones are bigint, checks and the refunds trigger follow", async () => {
    await migrate();

    const columns = (
      await db.query(
        `SELECT table_name || '.' || column_name AS col, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND (table_name, column_name) IN (
            ('rate_plans', 'bar'), ('rate_plans', 'bar_cents'),
            ('rate_overrides', 'price_per_night'), ('rate_overrides', 'price_per_night_cents'),
            ('rooms', 'cot_fee'), ('rooms', 'cot_fee_cents'),
            ('properties', 'breakfast_value'), ('properties', 'breakfast_value_cents'),
            ('reservations', 'total_amount'), ('reservations', 'total_cents'),
            ('reservations', 'tourist_tax_amount'), ('reservations', 'tourist_tax_cents'),
            ('refunds', 'amount'), ('refunds', 'amount_cents'),
            ('booking_intents', 'total_amount'), ('booking_intents', 'total_cents'),
            ('booking_intent_rooms', 'discount_amount'), ('booking_intent_rooms', 'discount_cents'),
            ('transactions', 'amount'), ('transactions', 'amount_cents'))
          ORDER BY 1`,
      )
    ).rows;
    expect(columns).toEqual(
      [
        "booking_intent_rooms.discount_cents",
        "booking_intents.total_cents",
        "properties.breakfast_value_cents",
        "rate_overrides.price_per_night_cents",
        "rate_plans.bar_cents",
        "refunds.amount_cents",
        "reservations.total_cents",
        "reservations.tourist_tax_cents",
        "rooms.cot_fee_cents",
        "transactions.amount_cents",
      ].map((col) => ({ col, data_type: "bigint" })),
    );

    const checks = Object.fromEntries(
      (
        await db.query(
          `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE contype = 'c' AND conname = ANY($1::text[])`,
          [
            [
              "rate_plans_base_price_positive",
              "rooms_cot_fee_cents_check",
              "rooms_cot_fee_check",
              "properties_breakfast_value_cents_check",
              "reservations_pay_at_property_cents_check",
              "booking_intent_rooms_discount_cents_check",
              "refunds_amount_sum",
              "refunds_amounts_finite",
              "transactions_amount_positive",
            ],
          ],
        )
      ).rows.map((r) => [r.conname, r.def]),
    );
    expect(checks).toEqual({
      rate_plans_base_price_positive: "CHECK ((bar_cents >= 0))",
      rooms_cot_fee_cents_check: "CHECK ((cot_fee_cents >= 0))",
      properties_breakfast_value_cents_check: "CHECK ((breakfast_value_cents >= 0))",
      reservations_pay_at_property_cents_check: "CHECK ((pay_at_property_cents >= 0))",
      booking_intent_rooms_discount_cents_check: "CHECK ((discount_cents > 0))",
      refunds_amount_sum: "CHECK (((amount_cents = (accommodation_cents + tourist_tax_cents)) AND (amount_cents >= 0)))",
      transactions_amount_positive: "CHECK ((amount_cents > 0))",
    });

    const trigger = await one(
      `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = 'refunds'::regclass AND tgname = 'analytics_cache_refunds'`,
    );
    expect(trigger.def).toContain("UPDATE OF booking_id, reservation_id, accommodation_cents, status");
  });

  test("no euro key is left anywhere, the database's own rows included", async () => {
    await seedOldShape();
    await migrate();

    const left = await one(`
      SELECT
        (SELECT count(*) FROM tourist_tax_rules WHERE jsonb_path_exists(charges, '$[*].amount'))::int AS charges,
        (SELECT count(*) FROM reservations WHERE jsonb_path_exists(nights, '$[*] ? (exists(@.price) || exists(@.touristTax))')
            OR jsonb_path_exists(tourist_tax_lines, '$[*].amount')
            OR jsonb_path_exists(vat_split, '$.** ? (exists(@.gross) || exists(@.vat))'))::int AS reservations,
        (SELECT count(*) FROM booking_intents WHERE snapshot ?| ARRAY['roomsTotal', 'touristTaxTotal', 'total'])::int AS snapshots,
        (SELECT count(*) FROM booking_intent_rooms WHERE jsonb_path_exists(nights, '$[*].price')
            OR jsonb_path_exists(rate_nights, '$[*].price')
            OR jsonb_path_exists(extra_guests, '$[*] ? (exists(@.per_night) || exists(@.amount))')
            OR jsonb_path_exists(pay_at_property_lines, '$[*] ? (exists(@.fee_per_night) || exists(@.amount))')
            OR jsonb_path_exists(tourist_tax_lines, '$[*].amount')
            OR jsonb_path_exists(vat_split, '$.** ? (exists(@.gross) || exists(@.vat))'))::int AS intent_rooms,
        (SELECT count(*) FROM refunds WHERE breakdown ?| ARRAY['requested', 'capped']
            OR breakdown -> 'refund' ? 'total' OR breakdown -> 'retained' ? 'total')::int AS breakdowns,
        (SELECT count(*) FROM booking_events
          WHERE data ?| ARRAY['amount', 'requested', 'refundTotal', 'roomPrice', 'snapshotTotal']
             OR (kind = 'outside_refund_explained' AND data ? 'touristTax'))::int AS events
    `);
    expect(left).toEqual({ charges: 0, reservations: 0, snapshots: 0, intent_rooms: 0, breakdowns: 0, events: 0 });
  });

  test("running the migration twice changes nothing", async () => {
    const f = await seedOldShape();
    await migrate();
    const once = await fixtureRows(f);
    await migrate();
    expect(await fixtureRows(f)).toEqual(once);
    // Spot check that the first run really converted (not two no-ops).
    expect(once.ratePlans[0].row.bar_cents).toBe(10000);
  });
});

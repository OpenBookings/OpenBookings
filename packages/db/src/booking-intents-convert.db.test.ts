import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { loadStayAvailability } from "./availability";
import type { LifecycleDb } from "./booking-lifecycle";
import {
  convertIntentToBooking,
  createBookingIntent,
  expireIntent,
  IntentNotFoundError,
  markIntentRefundedOversold,
  type IntentRoomInput,
  type IntentSnapshot,
} from "./booking-intents";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedGuest, seedProperty } from "./testing/db-harness";

const CHECK_IN = "2031-11-10";
const CHECK_OUT = "2031-11-12"; // 2 nights
const NOW = new Date("2031-10-01T10:00:00Z");
/** Well after any hold made at NOW has run out. */
const LATE = new Date("2031-10-01T12:00:00Z");

/** Uneven nights, so the exact prices and the rounded columns differ. Tax: €3 × 2 adults × 2 nights. */
const room = (roomId: string, ratePlanId: string): IntentRoomInput => ({
  roomId,
  ratePlanId,
  adults: 2,
  children: 0,
  infants: 1,
  cots: 1,
  extraBeds: 0,
  payAtProperty: 20,
  discount: { label: "Weekly discount", amount: 10 },
  rateNights: [
    { date: "2031-11-10", price: 99.5 },
    { date: "2031-11-11", price: 120 },
  ],
  extraGuests: [],
  payAtPropertyLines: [{ label: "Cots", count: 1, fee_per_night: 10, nights: 2, amount: 20 }],
  nights: [
    { date: "2031-11-10", price: 99.5 },
    { date: "2031-11-11", price: 120 },
  ],
  stayTotal: 219.5,
  touristTax: 12,
  touristTaxLines: [{ label: "€3.00 per person per night", amount: 12, effectiveFrom: "2026-01-01" }],
});

const snapshot = (rooms: IntentRoomInput[]): IntentSnapshot => ({
  roomsTotal: 219.5 * rooms.length,
  touristTaxTotal: 12 * rooms.length,
  total: 231.5 * rooms.length,
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

describeWithDb("converting a paid booking intent", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let guest: string;

  /** Transactions become savepoints inside the test's own transaction. */
  const lifecycleDb = (): LifecycleDb => {
    const query = (text: string, values?: unknown[]) => db.query(text, values);
    return {
      query,
      transaction: async (fn) => {
        await db.query("SAVEPOINT convert");
        try {
          const out = await fn({ query });
          await db.query("RELEASE SAVEPOINT convert");
          return out;
        } catch (error) {
          await db.query("ROLLBACK TO SAVEPOINT convert");
          throw error;
        }
      },
    };
  };

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
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges) VALUES ($1, '2026-01-01', $2::jsonb)`,
      [ids.propertyId, JSON.stringify([{ kind: "fixed", amount: 3, perPerson: true, perNight: true, perRoom: false }])],
    );
    guest = await seedGuest(db);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const intent = async (count = 1) => {
    const rooms = Array.from({ length: count }, () => room(ids.roomId, ids.ratePlanId));
    const result = await createBookingIntent(lifecycleDb(), {
      userId: guest,
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms,
      snapshot: snapshot(rooms),
      now: NOW,
    });
    if (!result.ok) throw new Error(`expected an intent, got ${result.error}`);
    return { intentId: result.intentId, rooms, snapshot: snapshot(rooms) };
  };

  const convert = (intentId: string, now = NOW, paymentIntentId = "pi_convert") =>
    convertIntentToBooking(lifecycleDb(), { intentId, paymentIntentId, accountId: "acct_host", amountCents: 46300, now });

  const intentRow = async (intentId: string) =>
    (
      await db.query(`SELECT status, booking_id, payment_reference, refund_reference FROM booking_intents WHERE id = $1`, [
        intentId,
      ])
    ).rows[0] as { status: string; booking_id: string | null; payment_reference: string | null; refund_reference: string | null };

  const bookingsFor = async (paymentIntentId: string) =>
    (await db.query(`SELECT id FROM bookings WHERE stripe_payment_intent_id = $1`, [paymentIntentId])).rows as { id: string }[];

  test("keeps the exact money split on the booking, in cents", async () => {
    const rooms = [room(ids.roomId, ids.ratePlanId), room(ids.roomId, ids.ratePlanId)];
    const snap = { ...snapshot(rooms), commissionCents: 1976 };
    const created = await createBookingIntent(lifecycleDb(), {
      userId: guest,
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms,
      snapshot: snap,
      now: NOW,
    });
    if (!created.ok) throw new Error(`expected an intent, got ${created.error}`);
    const result = await convert(created.intentId);
    if (result.outcome !== "confirmed") throw new Error(`expected confirmed, got ${result.outcome}`);

    const booking = (
      await db.query(
        `SELECT rooms_total_cents, tourist_tax_cents, total_cents, commission_cents FROM bookings WHERE id = $1`,
        [result.bookingId],
      )
    ).rows[0];
    // 2 × €219.50 rooms and 2 × €12 tax: whole-euro rounding would lose the 50 cents.
    expect(Number(booking.rooms_total_cents)).toBe(43900);
    expect(Number(booking.tourist_tax_cents)).toBe(2400);
    expect(Number(booking.total_cents)).toBe(46300);
    expect(Number(booking.commission_cents)).toBe(1976);
  });

  test("the booking keeps the commission split the intent recorded", async () => {
    const rooms = [room(ids.roomId, ids.ratePlanId)];
    const snap: IntentSnapshot = {
      ...snapshot(rooms),
      commissionCents: 1080,
      commissionRate: 0.05,
      commissionVatTreatment: "NL_DOMESTIC",
      commissionNetCents: 893,
      commissionVatCents: 187,
    };
    const created = await createBookingIntent(lifecycleDb(), {
      userId: guest,
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms,
      snapshot: snap,
      now: NOW,
    });
    if (!created.ok) throw new Error(`expected an intent, got ${created.error}`);
    const result = await convert(created.intentId);
    if (result.outcome !== "confirmed") throw new Error(`expected confirmed, got ${result.outcome}`);
    const b = (
      await db.query(
        `SELECT commission_rate, commission_vat_treatment, commission_net_cents, commission_vat_cents FROM bookings WHERE id = $1`,
        [result.bookingId],
      )
    ).rows[0];
    expect(Number(b.commission_rate)).toBe(0.05);
    expect(b.commission_vat_treatment).toBe("NL_DOMESTIC");
    expect(Number(b.commission_net_cents)).toBe(893);
    expect(Number(b.commission_vat_cents)).toBe(187);
  });

  test("an intent from before the split existed converts with NULL split columns", async () => {
    const rooms = [room(ids.roomId, ids.ratePlanId)];
    const { commissionRate, commissionVatTreatment, commissionNetCents, commissionVatCents, ...legacy } = snapshot(rooms);
    void commissionRate; void commissionVatTreatment; void commissionNetCents; void commissionVatCents;
    const created = await createBookingIntent(lifecycleDb(), {
      userId: guest,
      propertyId: ids.propertyId,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      rooms,
      snapshot: legacy as IntentSnapshot,
      now: NOW,
    });
    if (!created.ok) throw new Error(`expected an intent, got ${created.error}`);
    const result = await convert(created.intentId);
    if (result.outcome !== "confirmed") throw new Error(`expected confirmed, got ${result.outcome}`);
    const b = (
      await db.query(
        `SELECT commission_rate, commission_vat_treatment, commission_net_cents, commission_vat_cents FROM bookings WHERE id = $1`,
        [result.bookingId],
      )
    ).rows[0];
    expect(b).toEqual({ commission_rate: null, commission_vat_treatment: null, commission_net_cents: null, commission_vat_cents: null });
  });

  test("confirms a two-room intent", async () => {
    const { intentId, rooms, snapshot: snap } = await intent(2);
    const result = await convert(intentId);
    if (result.outcome !== "confirmed") throw new Error(`expected confirmed, got ${result.outcome}`);
    expect(result.firstTime).toBe(true);

    const booking = (
      await db.query(
        `SELECT hotel_id, user_id, check_in_date::text AS check_in, check_out_date::text AS check_out, status,
                confirmed_at, total_amount, booking_fee_amount, currency, stripe_payment_intent_id
         FROM bookings WHERE id = $1`,
        [result.bookingId],
      )
    ).rows[0];
    expect(booking).toMatchObject({
      hotel_id: ids.propertyId,
      user_id: guest,
      check_in: CHECK_IN,
      check_out: CHECK_OUT,
      status: "confirmed",
      currency: "EUR",
      stripe_payment_intent_id: "pi_convert",
    });
    expect((booking.confirmed_at as Date).getTime()).toBe(NOW.getTime());
    expect(Number(booking.total_amount)).toBe(Math.round(snap.total));
    expect(Number(booking.booking_fee_amount)).toBe(0);

    const reservations = (
      await db.query(
        `SELECT room_id, rate_plan_id, adults, children, infants, cots, extra_beds, pay_at_property_amount, total_nights, price_per_night, total_amount,
                tourist_tax_amount, tourist_tax_lines, cancellation_tier, nights
         FROM reservations WHERE booking_id = $1`,
        [result.bookingId],
      )
    ).rows;
    expect(reservations).toHaveLength(2);
    for (const r of reservations) {
      expect(r).toMatchObject({
        room_id: ids.roomId,
        rate_plan_id: ids.ratePlanId,
        adults: 2,
        children: 0,
        infants: 1,
        cots: 1,
        extra_beds: 0,
        total_nights: 2,
      });
      // Paid at the hotel: kept apart from what was charged.
      expect(Number(r.pay_at_property_amount)).toBe(20);
      expect(Number(r.price_per_night)).toBe(Math.round(219.5 / 2));
      expect(Number(r.total_amount)).toBe(Math.round(219.5));
      expect(Number(r.tourist_tax_amount)).toBe(12);
      expect(r.tourist_tax_lines).toEqual(rooms[0].touristTaxLines);
      expect(r.cancellation_tier).not.toBeNull();
      expect((r.nights as { date: string; price: number }[]).map(({ date, price }) => ({ date, price }))).toEqual(
        rooms[0].nights,
      );
    }

    const events = (await db.query(`SELECT kind, actor_kind, data FROM booking_events WHERE booking_id = $1`, [result.bookingId]))
      .rows;
    // The bigint totals are rounded; the event and the charge keep the exact amounts.
    expect(events).toEqual([
      {
        kind: "confirmed",
        actor_kind: "system",
        data: { intentId, paymentIntentId: "pi_convert", amountCents: 46300, snapshotTotal: snap.total },
      },
    ]);

    const charges = (
      await db.query(
        `SELECT type, provider, provider_payment_id, amount, currency, status, metadata FROM transactions WHERE booking_id = $1`,
        [result.bookingId],
      )
    ).rows;
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      type: "charge",
      provider: "stripe",
      provider_payment_id: "pi_convert",
      currency: "EUR",
      status: "succeeded",
      metadata: { amountCents: 46300 },
    });
    expect(Number(charges[0].amount)).toBe(463);

    expect(await intentRow(intentId)).toMatchObject({ status: "paid", booking_id: result.bookingId, payment_reference: "pi_convert" });
    // The rooms are booked now, not held: counted once.
    const nights = (await loadStayAvailability(db, { propertyId: ids.propertyId, checkIn: CHECK_IN, checkOut: CHECK_OUT, now: NOW }))[0]
      .nights;
    expect(nights.map((n) => [n.booked, n.held])).toEqual([
      [2, 0],
      [2, 0],
    ]);
  });

  test("convert is idempotent", async () => {
    const { intentId } = await intent();
    const first = await convert(intentId);
    const second = await convert(intentId);
    expect(first.outcome).toBe("confirmed");
    expect(first).toMatchObject({ firstTime: true, paymentReference: "pi_convert" });
    expect(second).toEqual({
      outcome: "confirmed",
      bookingId: (first as { bookingId: string }).bookingId,
      firstTime: false,
      paymentReference: "pi_convert",
    });
    expect(await bookingsFor("pi_convert")).toHaveLength(1);
    expect((await db.query(`SELECT count(*)::int AS n FROM transactions WHERE provider_payment_id = 'pi_convert'`)).rows[0].n).toBe(1);
  });

  test("late payment on a free room confirms", async () => {
    const { intentId } = await intent();
    await expireIntent(db, { intentId, now: NOW, force: true });
    const result = await convert(intentId, LATE);
    expect(result).toMatchObject({ outcome: "confirmed", firstTime: true });
    expect((await intentRow(intentId)).status).toBe("paid");
  });

  test("late payment on a taken room is oversold", async () => {
    await db.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    const { intentId } = await intent();
    await expireIntent(db, { intentId, now: NOW, force: true });
    const other = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [other.bookingId]);

    const oversold = {
      outcome: "oversold" as const,
      paymentIntentId: "pi_convert",
      accountId: "acct_host",
      amountCents: 46300,
    };
    expect(await convert(intentId, LATE)).toEqual({ ...oversold, firstTime: true });
    expect(await bookingsFor("pi_convert")).toHaveLength(0);
    expect(await intentRow(intentId)).toMatchObject({ status: "oversold", booking_id: null, payment_reference: "pi_convert" });

    expect(await convert(intentId, LATE)).toEqual({ ...oversold, firstTime: false });
    expect(await bookingsFor("pi_convert")).toHaveLength(0);
  });

  test("expire after paid is a no-op", async () => {
    const { intentId } = await intent();
    await convert(intentId);
    expect(await expireIntent(db, { intentId, now: LATE, force: true })).toBeNull();
    expect((await intentRow(intentId)).status).toBe("paid");
  });

  test("markIntentRefundedOversold", async () => {
    await db.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    const { intentId } = await intent();
    await expireIntent(db, { intentId, now: NOW, force: true });
    const other = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [other.bookingId]);
    await convert(intentId, LATE);

    expect(await markIntentRefundedOversold(db, { intentId, refundId: "re_1" })).toBe(true);
    expect(await intentRow(intentId)).toMatchObject({ status: "refunded_oversold", refund_reference: "re_1" });
    expect(await markIntentRefundedOversold(db, { intentId, refundId: "re_2" })).toBe(false);
    expect((await intentRow(intentId)).refund_reference).toBe("re_1");
    // Refunded and redelivered: still oversold, never a booking.
    expect(await convert(intentId, LATE)).toMatchObject({ outcome: "oversold", firstTime: false });
  });

  test("markIntentRefundedOversold leaves a paid intent alone", async () => {
    const { intentId } = await intent();
    await convert(intentId);
    expect(await markIntentRefundedOversold(db, { intentId, refundId: "re_1" })).toBe(false);
    expect(await intentRow(intentId)).toMatchObject({ status: "paid", refund_reference: null });
  });

  test("a second payment for a paid intent gets the stored reference back", async () => {
    const { intentId } = await intent();
    const first = await convert(intentId);
    const second = await convert(intentId, NOW, "pi_second");
    expect(second).toEqual({
      outcome: "confirmed",
      bookingId: (first as { bookingId: string }).bookingId,
      firstTime: false,
      paymentReference: "pi_convert",
    });
    expect(await bookingsFor("pi_second")).toHaveLength(0);
    expect((await intentRow(intentId)).payment_reference).toBe("pi_convert");
  });

  test("a second payment for an oversold intent gets the stored reference back", async () => {
    await db.query(`UPDATE rooms SET total_units = 1 WHERE id = $1`, [ids.roomId]);
    const { intentId } = await intent();
    await expireIntent(db, { intentId, now: NOW, force: true });
    const other = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [other.bookingId]);
    await convert(intentId, LATE);

    expect(await convert(intentId, LATE, "pi_second")).toMatchObject({
      outcome: "oversold",
      firstTime: false,
      paymentIntentId: "pi_convert",
    });
    expect((await intentRow(intentId)).payment_reference).toBe("pi_convert");
  });

  test("an unknown or malformed intent id is IntentNotFoundError", async () => {
    await expect(convert(crypto.randomUUID())).rejects.toBeInstanceOf(IntentNotFoundError);
    await expect(convert("not-a-uuid")).rejects.toBeInstanceOf(IntentNotFoundError);
  });

  test("the reservation keeps the tourist tax the guest was charged when the rules change before payment", async () => {
    const { intentId } = await intent();
    // €5 pp/pn now: the current rules would say €20 for the room, the guest paid €12.
    await db.query(`UPDATE tourist_tax_rules SET charges = $2::jsonb WHERE property_id = $1`, [
      ids.propertyId,
      JSON.stringify([{ kind: "fixed", amount: 5, perPerson: true, perNight: true, perRoom: false }]),
    ]);
    const result = await convert(intentId, LATE);
    if (result.outcome !== "confirmed") throw new Error(`expected confirmed, got ${result.outcome}`);

    const res = (
      await db.query(`SELECT tourist_tax_amount::float8 AS tax, nights FROM reservations WHERE booking_id = $1`, [result.bookingId])
    ).rows[0] as { tax: number; nights: { touristTax: number }[] };
    expect(res.tax).toBe(12);
    expect(res.nights.map((n) => n.touristTax)).toEqual([6, 6]);
  });
});

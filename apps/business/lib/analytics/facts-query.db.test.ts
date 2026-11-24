/**
 * The live facts loader against a real Postgres: only this hotel, the window
 * rule, clipped nights, succeeded refunds only. query/queryOne are pointed at
 * the test's transaction; each test is rolled back.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { Client } from "pg";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedGuest,
  seedProperty,
} from "@openbookings/db/testing";
import { mockModules } from "@/lib/mock-modules";

let db: Client;

const realDb = await import("@openbookings/db");
await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({
    ...realDb,
    query: async (text: string, values: unknown[] = []) =>
      (await run(text, values)).rows,
    queryOne: async (text: string, values: unknown[] = []) =>
      (await run(text, values)).rows[0] ?? null,
  }),
});

let queue: Promise<unknown> = Promise.resolve();
function run(text: string, values: unknown[]) {
  const result = queue.then(() => db.query(text, values));
  queue = result.catch(() => undefined);
  return result;
}

const { loadWindowFacts, loadHotelSpan } = await import("./facts-query");
const { bookingDate, bookingsCreatedIn } = await import("./metrics");

type Hotel = Awaited<ReturnType<typeof seedProperty>>;

describeWithDb("live analytics facts", () => {
  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
  });

  /** A confirmed booking (booked at noon on `bookedOn`) for `nights` nights from `checkIn`. */
  async function booked(
    hotel: Hotel,
    checkIn: string,
    nights: number,
    bookedOn: string,
  ) {
    const guest = await seedGuest(db);
    const made = await seedBooking(db, hotel, {
      checkIn,
      nights,
      userId: guest,
    });
    await db.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = $2::timestamptz WHERE id = $1`,
      [made.bookingId, `${bookedOn}T12:00:00+01:00`],
    );
    const nightsJson = Array.from({ length: nights }, (_, i) => ({
      date: new Date(Date.parse(`${checkIn}T00:00:00Z`) + i * 86_400_000)
        .toISOString()
        .slice(0, 10),
      priceCents: 10_000,
      touristTaxCents: 0,
    }));
    await db.query(
      `UPDATE reservations SET nights = $2::jsonb WHERE booking_id = $1`,
      [made.bookingId, JSON.stringify(nightsJson)],
    );
    return made;
  }

  test("loads only this hotel", async () => {
    const a = await seedProperty(db);
    const b = await seedProperty(db);
    await booked(a, "2031-03-10", 2, "2031-03-01");
    await booked(b, "2031-03-10", 2, "2031-03-01");
    const facts = await loadWindowFacts(a.propertyId, {
      from: "2031-03-01",
      to: "2031-03-31",
    });
    expect(facts.bookings).toHaveLength(1);
    expect(facts.bookings[0].roomId).toBe(a.roomId);
    expect(Object.keys(facts.roomTypeNames)).toEqual([a.roomId]);
    expect(Object.keys(facts.ratePlanNames)).toEqual([a.ratePlanId]);
    expect(new Set(facts.inventory.map((i) => i.roomId))).toEqual(
      new Set([a.roomId]),
    );
  });

  test("booking made in window but staying after it is included; its nights outside the window are not", async () => {
    const a = await seedProperty(db);
    await booked(a, "2031-04-29", 4, "2031-04-20"); // nights 29, 30, 1, 2 May
    const facts = await loadWindowFacts(a.propertyId, {
      from: "2031-04-01",
      to: "2031-04-30",
    });
    expect(facts.bookings).toHaveLength(1);
    expect(facts.bookings[0].nightlyNetCents).toHaveLength(4);
    expect(facts.nights.map((n) => n.date).sort()).toEqual([
      "2031-04-29",
      "2031-04-30",
    ]);
    const may = await loadWindowFacts(a.propertyId, {
      from: "2031-05-01",
      to: "2031-05-31",
    });
    expect(may.bookings).toHaveLength(1); // overlaps by stay
    const june = await loadWindowFacts(a.propertyId, {
      from: "2031-06-01",
      to: "2031-06-30",
    });
    expect(june.bookings).toHaveLength(0);
  });

  test("succeeded refunds reduce revenue, pending refunds do not", async () => {
    const a = await seedProperty(db);
    const made = await booked(a, "2031-03-10", 2, "2031-03-01");
    const insert = (status: string, amount: number, key: string) =>
      db.query(
        `INSERT INTO refunds (booking_id, reservation_id, reason, accommodation_cents, tourist_tax_cents, amount_cents, status, idempotency_key)
         VALUES ($1, $2, 'guest_cancellation', $3, 0, $3, $4::payment_status, $5)`,
        [made.bookingId, made.reservationIds[0], amount, status, key],
      );
    await insert("succeeded", 5_000, `t-${crypto.randomUUID()}`);
    await insert("pending", 7_000, `t-${crypto.randomUUID()}`);
    const facts = await loadWindowFacts(a.propertyId, {
      from: "2031-03-01",
      to: "2031-03-31",
    });
    expect(facts.bookings[0].netRevenueCents).toBe(20_000 - 5_000);
  });

  test("hotel span sees bookings outside any window", async () => {
    const a = await seedProperty(db);
    expect(await loadHotelSpan(a.propertyId)).toEqual({
      earliest: null,
      hasAnyBookings: false,
    });
    await booked(a, "2031-09-10", 2, "2031-08-15");
    await booked(a, "2031-03-10", 2, "2031-03-01");
    const pending = await seedBooking(db, a, {
      checkIn: "2030-01-10",
      nights: 1,
    });
    await db.query(
      `UPDATE bookings SET created_at = '2030-01-01T10:00:00Z' WHERE id = $1`,
      [pending.bookingId],
    );
    expect(await loadHotelSpan(a.propertyId)).toEqual({
      earliest: "2031-03-01",
      hasAnyBookings: true,
    });
  });
  test("a booking-level refund (no reservation) is split over both reservations", async () => {
    const a = await seedProperty(db);
    const guest = await seedGuest(db);
    const made = await seedBooking(db, a, {
      checkIn: "2031-03-10",
      nights: 2,
      rooms: 2,
      userId: guest,
    });
    await db.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = '2031-03-01T12:00:00Z' WHERE id = $1`,
      [made.bookingId],
    );
    const nj = JSON.stringify([
      { date: "2031-03-10", priceCents: 10_000, touristTaxCents: 0 },
      { date: "2031-03-11", priceCents: 10_000, touristTaxCents: 0 },
    ]);
    await db.query(
      `UPDATE reservations SET nights = $2::jsonb WHERE booking_id = $1`,
      [made.bookingId, nj],
    );
    await db.query(
      `INSERT INTO refunds (booking_id, reservation_id, reason, accommodation_cents, tourist_tax_cents, amount_cents, status, idempotency_key)
       VALUES ($1, NULL, 'guest_cancellation', 10000, 0, 10000, 'succeeded', $2)`,
      [made.bookingId, `t-${crypto.randomUUID()}`],
    );
    const facts = await loadWindowFacts(a.propertyId, {
      from: "2031-03-01",
      to: "2031-03-31",
    });
    expect(facts.bookings).toHaveLength(2);
    expect(facts.bookings.map((b) => b.netRevenueCents)).toEqual([
      15_000, 15_000,
    ]);
  });

  test("a fee refund (negative ledger amount) lowers the booking's commission", async () => {
    const a = await seedProperty(db);
    const made = await booked(a, "2031-03-10", 2, "2031-03-01");
    await db.query(
      `UPDATE bookings SET commission_cents = 1000 WHERE id = $1`,
      [made.bookingId],
    );
    const orgId = `test-fx-org-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Fx', $1, now())`,
      [orgId],
    );
    const entry = (kind: string, sign: number, amount: number) =>
      db.query(
        `INSERT INTO commission_entries (kind, billing_entity_id, property_id, booking_id, stripe_account_id, stripe_application_fee_id,
           booking_ref, stay_start, stay_end, stripe_fee_refund_id, base_amount, commission_net, vat_rate_bp, vat_amount, gross_amount, vat_treatment, occurred_at, disposition)
         VALUES ($1, $2, $3, $4, 'acct_test', $5, 'REF1', '2031-03-10', '2031-03-12', $6, $7, $7, 2100, 0, $7, 'NL_DOMESTIC', now(), 'booked')`,
        [
          kind,
          orgId,
          a.propertyId,
          made.bookingId,
          `fee_${crypto.randomUUID()}`,
          kind === "fee_refund" ? `fr_${crypto.randomUUID()}` : null,
          sign * amount,
        ],
      );
    await entry("fee", 1, 1000);
    await entry("fee_refund", -1, 400);
    const facts = await loadWindowFacts(a.propertyId, {
      from: "2031-03-01",
      to: "2031-03-31",
    });
    expect(facts.bookings[0].commissionCents).toBe(600);
  });

  async function withIntent(
    rooms: { discount: number | null; sort: number }[],
    reservationCount = 1,
  ) {
    const a = await seedProperty(db);
    const guest = await seedGuest(db);
    const made = await seedBooking(db, a, {
      checkIn: "2031-03-10",
      nights: 2,
      rooms: reservationCount,
      userId: guest,
    });
    await db.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = '2031-03-01T12:00:00Z' WHERE id = $1`,
      [made.bookingId],
    );
    const intent = (
      await db.query(
        `INSERT INTO booking_intents (user_id, property_id, check_in_date, check_out_date, hold_expires_at, snapshot, total_cents, booking_id, status)
           VALUES ($1, $2, '2031-03-10', '2031-03-12', now(), '{}'::jsonb, 20000, $3, 'paid') RETURNING id`,
        [guest, a.propertyId, made.bookingId],
      )
    ).rows[0] as { id: string };
    for (const r of rooms) {
      await db.query(
        `INSERT INTO booking_intent_rooms (intent_id, room_id, rate_plan_id, adults, nights, stay_total_cents, discount_cents, sort_order)
           VALUES ($1, $2, $3, 2, '[]'::jsonb, 20000, $4, $5)`,
        [intent.id, a.roomId, a.ratePlanId, r.discount, r.sort],
      );
    }
    return loadWindowFacts(a.propertyId, {
      from: "2031-03-01",
      to: "2031-03-31",
    });
  }

  test("intent discount: a one-to-one match carries the discount", async () => {
    const facts = await withIntent([{ discount: 1000, sort: 0 }]);
    expect(facts.bookings[0].discountCents).toBe(1000);
  });

  test("intent discount: two intent rooms for one reservation cannot be paired: no discount", async () => {
    const facts = await withIntent([
      { discount: 1000, sort: 0 },
      { discount: 2000, sort: 1 },
    ]);
    expect(facts.bookings[0].discountCents).toBe(0);
  });

  test("intent discount: equal counts pair by order", async () => {
    const facts = await withIntent(
      [
        { discount: 1000, sort: 0 },
        { discount: 2000, sort: 1 },
      ],
      2,
    );
    expect(facts.bookings.map((b) => b.discountCents).sort()).toEqual([
      1000, 2000,
    ]);
  });

  /** A confirmed booking whose Booking Time is the given instant. */
  async function bookedAt(hotel: Hotel, instant: string, checkIn = "2031-09-10") {
    const made = await booked(hotel, checkIn, 2, "2031-01-01");
    await db.query(`UPDATE bookings SET confirmed_at = $2::timestamptz WHERE id = $1`, [made.bookingId, instant]);
    return made;
  }

  test("a booking made at 00:30 Amsterdam in winter is dated that Amsterdam day, not the UTC day before", async () => {
    const a = await seedProperty(db);
    await bookedAt(a, "2031-01-31T23:30:00Z"); // 1 Feb 00:30 CET
    const feb = await loadWindowFacts(a.propertyId, { from: "2031-02-01", to: "2031-02-28" });
    expect(feb.bookings).toHaveLength(1);
    expect(bookingDate(feb.bookings[0])).toBe("2031-02-01");
    expect(feb.bookings[0].createdAt).toBe("2031-02-01T00:30:00.000+01:00");
    expect(Date.parse(feb.bookings[0].createdAt)).toBe(Date.parse("2031-01-31T23:30:00Z"));
    const jan = await loadWindowFacts(a.propertyId, { from: "2031-01-01", to: "2031-01-31" });
    expect(jan.bookings).toHaveLength(0);
  });

  test("a booking made at 00:30 Amsterdam in summer is dated that Amsterdam day", async () => {
    const a = await seedProperty(db);
    await bookedAt(a, "2031-06-30T22:30:00Z"); // 1 Jul 00:30 CEST
    const july = await loadWindowFacts(a.propertyId, { from: "2031-07-01", to: "2031-07-31" });
    expect(july.bookings).toHaveLength(1);
    expect(bookingDate(july.bookings[0])).toBe("2031-07-01");
    expect(july.bookings[0].createdAt).toBe("2031-07-01T00:30:00.000+02:00");
    expect(bookingsCreatedIn(july.bookings, { from: "2031-07-01", to: "2031-07-31" })).toHaveLength(1);
  });

  test("cancellations just after Amsterdam midnight are dated that Amsterdam day", async () => {
    const a = await seedProperty(db);
    const whole = await bookedAt(a, "2031-02-10T12:00:00Z");
    await db.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = '2031-02-28T23:30:00Z' WHERE id = $1`, [
      whole.bookingId,
    ]);
    const single = await bookedAt(a, "2031-02-10T12:00:00Z");
    await db.query(`UPDATE reservations SET cancelled_at = '2031-06-30T22:30:00Z' WHERE booking_id = $1`, [single.bookingId]);
    const facts = await loadWindowFacts(a.propertyId, { from: "2031-02-01", to: "2031-02-28" });
    const byId = new Map(facts.bookings.map((b) => [b.id, b]));
    expect(byId.get(whole.reservationIds[0])!.cancelledAt!.slice(0, 10)).toBe("2031-03-01");
    expect(byId.get(single.reservationIds[0])!.cancelledAt!.slice(0, 10)).toBe("2031-07-01");
  });

  test("a night without a readable price counts as 0, never NaN, so cached JSON and live agree", async () => {
    const a = await seedProperty(db);
    const made = await booked(a, "2031-03-10", 2, "2031-03-01");
    await db.query(`UPDATE reservations SET nights = $2::jsonb WHERE booking_id = $1`, [
      made.bookingId,
      JSON.stringify([{ date: "2031-03-10", priceCents: 10_000 }, { date: "2031-03-11", priceCents: "n/a" }]),
    ]);
    const facts = await loadWindowFacts(a.propertyId, { from: "2031-03-01", to: "2031-03-31" });
    expect(facts.bookings[0].nightlyNetCents).toEqual([10_000, 0]);
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });
});

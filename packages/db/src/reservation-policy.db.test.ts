import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { confirmBookingPolicy } from "./reservation-policy";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "./testing/db-harness";

describeWithDb("confirmBookingPolicy against Postgres", () => {
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
    await applyPendingMigrations(db);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  /** €3 per person per night, so 2 adults owe €6 a night. */
  async function touristTax(propertyId: string) {
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges)
       VALUES ($1, '2026-01-01', $2::jsonb)`,
      [propertyId, JSON.stringify([{ kind: "fixed", amount: 3, perPerson: true, perNight: true, perRoom: false }])],
    );
  }

  test("snapshots the tier, the deadlines and each night, and confirms the booking", async () => {
    const ids = await seedProperty(db, { tier: "standard" });
    await touristTax(ids.propertyId);
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 3 });

    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date("2031-10-01T10:00:00Z") });

    const res = (
      await db.query(
        `SELECT cancellation_tier, check_in_at, full_refund_until, nights, policy_version,
                tourist_tax_amount::float8 AS tourist_tax_amount
         FROM reservations WHERE id = $1`,
        [reservationIds[0]],
      )
    ).rows[0];
    expect(res.cancellation_tier).toBe("standard");
    expect(res.check_in_at.toISOString()).toBe("2031-11-10T14:00:00.000Z");
    expect(res.full_refund_until.toISOString()).toBe("2031-11-03T14:00:00.000Z");
    expect(res.nights).toHaveLength(3);
    expect(res.nights.reduce((sum: number, n: { touristTax: number }) => sum + n.touristTax, 0)).toBe(
      res.tourist_tax_amount,
    );
    expect(res.policy_version).toBe("annex-b-2026-10-30-rev2");

    const booking = (await db.query(`SELECT status, confirmed_at FROM bookings WHERE id = $1`, [bookingId])).rows[0];
    expect(booking.status).toBe("confirmed");
    expect(booking.confirmed_at.toISOString()).toBe("2031-10-01T10:00:00.000Z");
  });

  test("a later tier change never alters a booking that already has its snapshot", async () => {
    const ids = await seedProperty(db, { tier: "standard" });
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 3 });
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date("2031-10-01T10:00:00Z") });

    await db.query(`UPDATE properties SET cancellation_tier = 'flex' WHERE id = $1`, [ids.propertyId]);
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date("2031-10-05T10:00:00Z") });

    const res = (
      await db.query(`SELECT cancellation_tier, full_refund_until FROM reservations WHERE id = $1`, [reservationIds[0]])
    ).rows[0];
    expect(res.cancellation_tier).toBe("standard");
    expect(res.full_refund_until.toISOString()).toBe("2031-11-03T14:00:00.000Z");
  });

  test("a non-refundable rate is snapshotted as Non-refundable", async () => {
    const ids = await seedProperty(db, { tier: "flex", isRefundable: false });
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2 });
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date("2031-10-01T10:00:00Z") });
    const res = (await db.query(`SELECT cancellation_tier FROM reservations WHERE id = $1`, [reservationIds[0]])).rows[0];
    expect(res.cancellation_tier).toBe("non_refundable");
  });

  /** The rules say €6 a night (€18); the guest was charged something else. */
  const chargedTax = async (charged: number, opts: { rules: boolean }) => {
    const ids = await seedProperty(db, { tier: "standard" });
    if (opts.rules) await touristTax(ids.propertyId);
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 3 });
    await confirmBookingPolicy(db, {
      bookingId,
      confirmedAt: new Date("2031-10-01T10:00:00Z"),
      touristTax: { [reservationIds[0]]: charged },
    });
    return (
      await db.query(`SELECT tourist_tax_amount::float8 AS tax, nights FROM reservations WHERE id = $1`, [reservationIds[0]])
    ).rows[0] as { tax: number; nights: { touristTax: number }[] };
  };

  test("charged tax replaces the current rules' total, split over the nights the same way", async () => {
    const res = await chargedTax(10, { rules: true });
    expect(res.tax).toBe(10);
    // 6:6:6 scaled to €10; the cent left over goes on the first night.
    expect(res.nights.map((n) => n.touristTax)).toEqual([3.34, 3.33, 3.33]);
  });

  test("charged tax equal to the rules' total changes nothing", async () => {
    const res = await chargedTax(18, { rules: true });
    expect(res.tax).toBe(18);
    expect(res.nights.map((n) => n.touristTax)).toEqual([6, 6, 6]);
  });

  test("charged tax with no rules left lands on the first night", async () => {
    const res = await chargedTax(7.5, { rules: false });
    expect(res.tax).toBe(7.5);
    expect(res.nights.map((n) => n.touristTax)).toEqual([7.5, 0, 0]);
  });
});

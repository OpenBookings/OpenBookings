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

  /** €3 (300 cents) per person per night, so 2 adults owe 600 cents a night. */
  async function touristTax(propertyId: string) {
    await db.query(
      `INSERT INTO tourist_tax_rules (property_id, effective_from, charges)
       VALUES ($1, '2026-01-01', $2::jsonb)`,
      [propertyId, JSON.stringify([{ kind: "fixed", amountCents: 300, perPerson: true, perNight: true, perRoom: false }])],
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
                tourist_tax_cents::int AS tourist_tax_cents
         FROM reservations WHERE id = $1`,
        [reservationIds[0]],
      )
    ).rows[0];
    expect(res.cancellation_tier).toBe("standard");
    expect(res.check_in_at.toISOString()).toBe("2031-11-10T14:00:00.000Z");
    expect(res.full_refund_until.toISOString()).toBe("2031-11-03T14:00:00.000Z");
    expect(res.nights).toHaveLength(3);
    expect(res.nights.reduce((sum: number, n: { touristTaxCents: number }) => sum + n.touristTaxCents, 0)).toBe(
      res.tourist_tax_cents,
    );
    expect(res.tourist_tax_cents).toBe(3 * 600);
    // Each night keeps the price it was valued at, in cents (seedBooking: 10000 a night).
    expect(res.nights.map((n: { priceCents: number }) => n.priceCents)).toEqual([10000, 10000, 10000]);
    expect(res.policy_version).toBe("annex-b-2026-10-30-rev3");

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

  test("the terms the guest was shown win over the live ones the host changed since", async () => {
    // Held under Standard on a refundable rate; the host then switched to Flex and Non-refundable.
    const ids = await seedProperty(db, { tier: "flex", isRefundable: false });
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, rooms: 2 });
    await confirmBookingPolicy(db, {
      bookingId,
      confirmedAt: new Date("2031-10-01T10:00:00Z"),
      policy: {
        [reservationIds[0]]: { tier: "standard", isRefundable: true },
        // An intent from before the tier was kept: refundability only, the live tier for the rest.
        [reservationIds[1]]: { isRefundable: true },
      },
    });
    const tiers = (
      await db.query(`SELECT id, cancellation_tier FROM reservations WHERE id = ANY($1::uuid[])`, [reservationIds])
    ).rows.reduce((all: Record<string, string>, r: { id: string; cancellation_tier: string }) => ({ ...all, [r.id]: r.cancellation_tier }), {});
    expect(tiers[reservationIds[0]]).toBe("standard");
    expect(tiers[reservationIds[1]]).toBe("flex");
  });

  test("a non-refundable rate is snapshotted as Non-refundable", async () => {
    const ids = await seedProperty(db, { tier: "flex", isRefundable: false });
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2 });
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date("2031-10-01T10:00:00Z") });
    const res = (await db.query(`SELECT cancellation_tier FROM reservations WHERE id = $1`, [reservationIds[0]])).rows[0];
    expect(res.cancellation_tier).toBe("non_refundable");
  });

  /** The rules say 600 cents a night (1800); the guest was charged something else, in cents. */
  const chargedTax = async (charged: number, opts: { rules: boolean }) => {
    const ids = await seedProperty(db, { tier: "standard" });
    if (opts.rules) await touristTax(ids.propertyId);
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 3 });
    await confirmBookingPolicy(db, {
      bookingId,
      confirmedAt: new Date("2031-10-01T10:00:00Z"),
      touristTaxCents: { [reservationIds[0]]: charged },
    });
    return (
      await db.query(`SELECT tourist_tax_cents::int AS tax, nights FROM reservations WHERE id = $1`, [reservationIds[0]])
    ).rows[0] as { tax: number; nights: { touristTaxCents: number }[] };
  };

  test("charged tax replaces the current rules' total, split over the nights the same way", async () => {
    const res = await chargedTax(1000, { rules: true });
    expect(res.tax).toBe(1000);
    // 6:6:6 scaled to €10; the cent left over goes on the first night.
    expect(res.nights.map((n) => n.touristTaxCents)).toEqual([334, 333, 333]);
  });

  test("charged tax equal to the rules' total changes nothing", async () => {
    const res = await chargedTax(1800, { rules: true });
    expect(res.tax).toBe(1800);
    expect(res.nights.map((n) => n.touristTaxCents)).toEqual([600, 600, 600]);
  });

  test("charged tax with no rules left lands on the first night", async () => {
    const res = await chargedTax(750, { rules: false });
    expect(res.tax).toBe(750);
    expect(res.nights.map((n) => n.touristTaxCents)).toEqual([750, 0, 0]);
  });
});

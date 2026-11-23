import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "./testing/db-harness";

describeWithDb("analytics month cache invalidation", () => {
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

  /** A cache row stamped with the month's current generation (0 when it has never been touched). */
  async function cacheRow(hotel: string, month: string, generation?: number) {
    const current =
      generation ??
      Number(
        (
          await db.query(`SELECT generation FROM analytics_month_generation WHERE hotel_id = $1 AND month = $2`, [
            hotel,
            month,
          ])
        ).rows[0]?.generation ?? 0,
      );
    await db.query(
      `INSERT INTO analytics_month_cache (hotel_id, month, version, generation, facts) VALUES ($1, $2, 1, $3, '{}'::jsonb)`,
      [hotel, month, current],
    );
  }
  const cachedMonths = async (hotel: string) =>
    (
      await db.query(`SELECT to_char(month, 'YYYY-MM') AS m FROM analytics_month_cache WHERE hotel_id = $1 ORDER BY month`, [
        hotel,
      ])
    ).rows.map((r) => r.m as string);
  const generations = async (hotel: string) =>
    Object.fromEntries(
      (
        await db.query(
          `SELECT to_char(month, 'YYYY-MM') AS m, generation::int AS g FROM analytics_month_generation WHERE hotel_id = $1 ORDER BY month`,
          [hotel],
        )
      ).rows.map((r) => [r.m as string, r.g as number]),
    );

  async function bookedHotel(checkIn = "2031-02-27", nights = 3) {
    const ids = await seedProperty(db);
    const { bookingId } = await seedBooking(db, ids, { checkIn, nights });
    await db.query(`UPDATE bookings SET confirmed_at = '2031-01-15T12:00:00Z', status = 'confirmed' WHERE id = $1`, [bookingId]);
    return { ...ids, bookingId };
  }
  /** Seeding touches months too; start each test from generation 0 so the asserted counts are the test's own. */
  const fillCache = async (hotel: string, months: string[]) => {
    await db.query(`UPDATE analytics_month_generation SET generation = 0 WHERE hotel_id = $1`, [hotel]);
    for (const m of months) await cacheRow(hotel, `${m}-01`);
  };

  test("booking update clears its booked month and stay months", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);

    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
    const g = await generations(propertyId);
    expect(g["2031-01"]).toBe(1);
    expect(g["2031-02"]).toBe(1);
    expect(g["2031-03"]).toBe(1);
    expect(g["2031-04"]).toBeUndefined();
  });

  test("succeeded refund insert clears the booking months", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);

    await db.query(
      `INSERT INTO refunds (booking_id, reason, source, accommodation_amount, tourist_tax_amount, amount, status, idempotency_key)
       VALUES ($1, 'goodwill', 'openbookings', 50, 0, 50, 'succeeded', $2)`,
      [bookingId, `k-${crypto.randomUUID()}`],
    );

    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
  });

  test("room_inventory change clears only that month", async () => {
    const { propertyId, roomId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03"]);

    await db.query(`INSERT INTO room_inventory (room_id, date, blocked_rooms) VALUES ($1, '2031-02-10', 1)`, [roomId]);

    expect(await cachedMonths(propertyId)).toEqual(["2031-01", "2031-03"]);
    expect((await generations(propertyId))["2031-02"]).toBe(1);
  });

  test("rooms total_units change clears every month of that hotel and none of another hotel", async () => {
    const a = await bookedHotel();
    const b = await bookedHotel();
    await fillCache(a.propertyId, ["2031-01", "2031-02", "2031-03"]);
    await fillCache(b.propertyId, ["2031-01", "2031-02"]);

    await db.query(`UPDATE rooms SET total_units = 9 WHERE id = $1`, [a.roomId]);

    expect(await cachedMonths(a.propertyId)).toEqual([]);
    expect(await cachedMonths(b.propertyId)).toEqual(["2031-01", "2031-02"]);
    // Only the hotel sentinel moves: readers and builders check it, so the
    // month rows need no bump (and are not locked by a units edit).
    const g = await generations(a.propertyId);
    expect(g["0001-01"]).toBe(1);
    expect(Object.entries(g).filter(([m]) => m !== "0001-01").every(([, n]) => n === 0)).toBe(true);
  });

  test("rooms change bumps the hotel sentinel generation", async () => {
    const a = await bookedHotel();
    const b = await bookedHotel();
    const sentinel = async (hotel: string) =>
      Number(
        (
          await db.query(
            `SELECT generation FROM analytics_month_generation WHERE hotel_id = $1 AND month = '0001-01-01'`,
            [hotel],
          )
        ).rows[0]?.generation ?? 0,
      );
    // Seeding a room already touched the hotel; start from 0.
    await db.query(`UPDATE analytics_month_generation SET generation = 0 WHERE month = '0001-01-01' AND hotel_id IN ($1, $2)`, [
      a.propertyId,
      b.propertyId,
    ]);
    expect(await sentinel(a.propertyId)).toBe(0);

    await db.query(`UPDATE rooms SET total_units = 9 WHERE id = $1`, [a.roomId]);

    expect(await sentinel(a.propertyId)).toBe(1);
    expect(await sentinel(b.propertyId)).toBe(0);
  });

  test("another hotel's cache is untouched by a booking change", async () => {
    const a = await bookedHotel();
    const b = await bookedHotel();
    await fillCache(a.propertyId, ["2031-01", "2031-02"]);
    await fillCache(b.propertyId, ["2031-01", "2031-02", "2031-03"]);
    const before = await generations(b.propertyId);

    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [a.bookingId]);

    expect(await cachedMonths(a.propertyId)).toEqual([]);
    expect(await cachedMonths(b.propertyId)).toEqual(["2031-01", "2031-02", "2031-03"]);
    expect(await generations(b.propertyId)).toEqual(before);
  });

  const reset = async (hotel: string) =>
    db.query(`UPDATE analytics_month_generation SET generation = 0 WHERE hotel_id = $1`, [hotel]);

  test("deleting a property that has rooms succeeds (bookings restrict a property delete, so rooms only)", async () => {
    const { propertyId, roomId } = await seedProperty(db);
    await db.query(`INSERT INTO room_inventory (room_id, date, blocked_rooms) VALUES ($1, '2031-02-10', 1)`, [roomId]);
    await fillCache(propertyId, ["2031-01", "2031-02"]);
    await db.query(`DELETE FROM properties WHERE id = $1`, [propertyId]);
    expect((await db.query(`SELECT 1 FROM properties WHERE id = $1`, [propertyId])).rowCount).toBe(0);
  });

  test("a booking delete clears its months, children cascading first do not error", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    await db.query(`DELETE FROM reservations WHERE booking_id = $1`, [bookingId]);
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);
    await db.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
    expect((await generations(propertyId))["2031-03"]).toBe(1);
  });

  test("deleting a booking with reservations (cascade) works and clears its months", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);
    await db.query(`DELETE FROM bookings WHERE id = $1`, [bookingId]);
    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
  });

  test("moving a booking to another hotel touches the old and the new hotel", async () => {
    const a = await bookedHotel();
    const b = await bookedHotel("2031-08-10", 2);
    await fillCache(a.propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);
    await fillCache(b.propertyId, ["2031-01", "2031-02", "2031-03", "2031-08"]);
    await db.query(`UPDATE bookings SET hotel_id = $2 WHERE id = $1`, [a.bookingId, b.propertyId]);
    expect(await cachedMonths(a.propertyId)).toEqual(["2031-04"]);
    expect(await cachedMonths(b.propertyId)).toEqual(["2031-08"]);
  });

  test("reservation insert and update clear the booking months", async () => {
    const { propertyId, bookingId, roomId, ratePlanId } = await bookedHotel();
    const [first] = (await db.query(`SELECT * FROM reservations WHERE booking_id = $1`, [bookingId])).rows;
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);
    await db.query(`UPDATE reservations SET id = id WHERE id = $1`, [first.id]);
    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);

    await fillCache(propertyId, ["2031-01", "2031-02"]);
    // Same shape as the seeded row, as a second reservation.
    const cols = Object.keys(first).filter((c) => c !== "id");
    await db.query(
      `INSERT INTO reservations (${cols.map((c) => `"${c}"`).join(", ")})
       SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM reservations WHERE id = $1`,
      [first.id],
    );
    expect((await cachedMonths(propertyId)).filter((m) => m !== "2031-04")).toEqual([]);
    void roomId;
    void ratePlanId;
  });

  test("a commission entry with a booking clears the booking months, one without touches nothing", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    const orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, now())`, [orgId]);
    const insert = (booking: string | null) =>
      db.query(
        `INSERT INTO commission_entries
           (kind, billing_entity_id, property_id, booking_id, booking_ref, stay_start, stay_end, stripe_account_id, stripe_application_fee_id, base_amount,
            commission_net, vat_rate_bp, vat_amount, gross_amount, vat_treatment, currency, occurred_at, disposition)
         VALUES ('fee', $1, $2, $3, 'REF', '2031-02-27', '2031-03-02', 'acct_test', $4, 20000, 744, 2100, 156, 900, 'NL_DOMESTIC', 'eur', '2031-11-01T10:00:00Z', $5)`,
        [orgId, propertyId, booking, `fee_${crypto.randomUUID()}`, booking ? "booked" : "returned"],
      );
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);
    await insert(null);
    expect(await cachedMonths(propertyId)).toEqual(["2031-01", "2031-02", "2031-03", "2031-04"]);
    await insert(bookingId);
    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
  });

  test("an outside refund clears the booking months", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);
    await db.query(
      `INSERT INTO refunds (booking_id, source, accommodation_amount, tourist_tax_amount, amount, status, idempotency_key)
       VALUES ($1, 'stripe_dashboard', 20, 0, 20, 'succeeded', $2)`,
      [bookingId, `stripe_dashboard:re_${crypto.randomUUID()}`],
    );
    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
  });

  test("rooms insert and archived_at update touch the whole hotel", async () => {
    const { propertyId, roomId } = await bookedHotel();
    await fillCache(propertyId, ["2031-01", "2031-02"]);
    await db.query(`UPDATE rooms SET archived_at = now(), is_active = false WHERE id = $1`, [roomId]);
    expect(await cachedMonths(propertyId)).toEqual([]);

    await fillCache(propertyId, ["2031-01", "2031-02"]);
    await reset(propertyId);
    await db.query(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active) VALUES ($1, 'Extra', 2, 2, 1, true)`,
      [propertyId],
    );
    expect(await cachedMonths(propertyId)).toEqual([]);
    expect((await generations(propertyId))["2031-01"]).toBe(0);
    expect((await generations(propertyId))["0001-01"]).toBe(1);
  });

  test("a room moved to another hotel touches both hotels", async () => {
    const a = await bookedHotel();
    const b = await bookedHotel();
    await fillCache(a.propertyId, ["2031-01", "2031-02"]);
    await fillCache(b.propertyId, ["2031-01", "2031-02"]);
    await db.query(`UPDATE rooms SET property_id = $2 WHERE id = $1`, [a.roomId, b.propertyId]);
    expect(await cachedMonths(a.propertyId)).toEqual([]);
    expect(await cachedMonths(b.propertyId)).toEqual([]);
  });

  test("updates to columns analytics does not read leave the cache alone", async () => {
    const { propertyId, bookingId, roomId } = await bookedHotel();
    const orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, now())`, [orgId]);
    const entry = (
      await db.query(
        `INSERT INTO commission_entries
           (kind, billing_entity_id, property_id, booking_id, booking_ref, stay_start, stay_end, stripe_account_id, stripe_application_fee_id, base_amount,
            commission_net, vat_rate_bp, vat_amount, gross_amount, vat_treatment, currency, occurred_at, disposition)
         VALUES ('fee', $1, $2, $3, 'REF', '2031-02-27', '2031-03-02', 'acct_test', $4, 20000, 744, 2100, 156, 900, 'NL_DOMESTIC', 'eur', '2031-11-01T10:00:00Z', 'booked')
         RETURNING id`,
        [orgId, propertyId, bookingId, `fee_${crypto.randomUUID()}`],
      )
    ).rows[0].id as string;
    const run = (
      await db.query(`INSERT INTO invoice_runs (period_start, step, status) VALUES ('2031-11-01', 'draft', 'running') RETURNING id`)
    ).rows[0].id as string;
    const invoice = (
      await db.query(
        `INSERT INTO invoices (run_id, billing_entity_id, period_start, period_end, doc_type, status, vat_treatment, vat_rate_bp,
           net_total, vat_total, gross_total, vat_collected, vat_rounding_diff, seller, buyer)
         VALUES ($1, $2, '2031-10-01', '2031-11-01', 'invoice', 'draft', 'NL_DOMESTIC', 2100, 744, 156, 900, 156, 0, '{}'::jsonb, '{}'::jsonb)
         RETURNING id`,
        [run, orgId],
      )
    ).rows[0].id as string;
    await db.query(`INSERT INTO room_inventory (room_id, date, blocked_rooms) VALUES ($1, '2031-02-10', 1)`, [roomId]);
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03"]);

    await db.query(`UPDATE bookings SET guest_notes = 'late arrival', updated_at = now() WHERE id = $1`, [bookingId]);
    await db.query(`UPDATE reservations SET adults = 1 WHERE booking_id = $1`, [bookingId]);
    await db.query(`UPDATE commission_entries SET invoice_id = $2 WHERE id = $1`, [entry, invoice]);
    await db.query(`UPDATE rooms SET name = 'Renamed' WHERE id = $1`, [roomId]);

    expect(await cachedMonths(propertyId)).toEqual(["2031-01", "2031-02", "2031-03"]);
    expect(Object.values(await generations(propertyId)).every((n) => n === 0)).toBe(true);
  });

  test("a refund going from pending to succeeded clears the booking months", async () => {
    const { propertyId, bookingId } = await bookedHotel();
    const refund = (
      await db.query(
        `INSERT INTO refunds (booking_id, reason, source, accommodation_amount, tourist_tax_amount, amount, status, idempotency_key)
         VALUES ($1, 'goodwill', 'openbookings', 50, 0, 50, 'pending', $2) RETURNING id`,
        [bookingId, `k-${crypto.randomUUID()}`],
      )
    ).rows[0].id as string;
    await fillCache(propertyId, ["2031-01", "2031-02", "2031-03", "2031-04"]);
    await db.query(`UPDATE refunds SET status = 'succeeded' WHERE id = $1`, [refund]);
    expect(await cachedMonths(propertyId)).toEqual(["2031-04"]);
  });
});

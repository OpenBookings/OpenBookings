/**
 * The support bots' money fragments (BOOKING_CENTS_COLUMNS, ROOM_CENTS_JSON)
 * read the cents columns as stored: no whole-euro fallbacks.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { BOOKING_CENTS_COLUMNS, ROOM_CENTS_JSON } from "./support";
import { connectionString, describeWithDb, seedBooking, seedProperty } from "./testing/db-harness";

describeWithDb("support money fragments", () => {
  let db: Client;
  let bookingId: string;
  let reservationIds: string[];

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    const ids = await seedProperty(db, { tier: "flex" });
    ({ bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2 }));
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const read = async () =>
    (
      await db.query(
        `SELECT ${BOOKING_CENTS_COLUMNS},
                (SELECT json_build_object(${ROOM_CENTS_JSON}) FROM reservations r WHERE r.booking_id = b.id) AS room
           FROM bookings b WHERE b.id = $1`,
        [bookingId],
      )
    ).rows[0] as {
      total_cents: number;
      rooms_total_cents: number | null;
      tourist_tax_cents: number | null;
      room: { stay_total_cents: number; pay_at_property_cents: number };
    };

  test("a booking and its room in cents, the stay summed from the night prices", async () => {
    await db.query(
      `UPDATE bookings SET rooms_total_cents = 18650, tourist_tax_cents = 1212, total_cents = 19862 WHERE id = $1`,
      [bookingId],
    );
    await db.query(`UPDATE reservations SET nights = $2::jsonb, pay_at_property_cents = 3750 WHERE id = $1`, [
      reservationIds[0],
      JSON.stringify([
        { date: "2031-11-10", priceCents: 9325, touristTaxCents: 606 },
        { date: "2031-11-11", priceCents: 9325, touristTaxCents: 606 },
      ]),
    ]);
    expect(await read()).toEqual({
      total_cents: 19862,
      rooms_total_cents: 18650,
      tourist_tax_cents: 1212,
      room: { stay_total_cents: 18650, pay_at_property_cents: 3750 },
    });
  });

  test("a reservation without nights falls back to its stored total in cents", async () => {
    // seedBooking: 10000 cents a night, two nights, no snapshot of the nights.
    await db.query(`UPDATE reservations SET nights = '[]'::jsonb WHERE id = $1`, [reservationIds[0]]);
    const row = await read();
    expect(row.room).toEqual({ stay_total_cents: 20000, pay_at_property_cents: 0 });
    expect(row.total_cents).toBe(20000);
  });
});

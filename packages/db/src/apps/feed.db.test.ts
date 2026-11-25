/**
 * The booking change feed (0060). Fixtures sit in 2031+ so dev data cannot interfere.
 *
 * Every test runs in one transaction, so the events it writes carry that
 * transaction's own txid, which is never below the snapshot xmin: to
 * `loadBookingChanges` they are unfinished and stay out of the feed (one test
 * pins exactly that). The other tests read through `loadBookingChangesBefore`
 * with `finishedBefore` = own txid + 1, i.e. "this transaction has finished".
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { BookingChangesPageSchema, type BookingChangesPage } from "@openbookings/apps-contract";
import { bookingReference } from "../booking-reference";
import { recordBookingEvent, type BookingEventKind } from "../booking-events";
import { DELIVERY_EVENT_KINDS, loadBookingChanges, loadBookingChangesBefore } from "./feed";
import { connectApp, type Installation } from "./installations";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";

type Ids = Awaited<ReturnType<typeof seedProperty>>;

describeWithDb("booking change feed", () => {
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

  const now = new Date("2031-03-01T12:00:00Z");
  const system = { kind: "system" as const, id: null };

  async function setup() {
    const ids = await seedProperty(db);
    const { installation } = await connectApp(db, {
      propertyId: ids.propertyId,
      appKey: "siteminder",
      userId: "test-host-user",
      sendUpcoming: true,
      now,
    });
    const codes = (
      await db.query(
        `SELECT r.channel_code AS room, p.channel_code AS plan
           FROM rooms r JOIN rate_plans p ON p.room_id = r.id WHERE r.id = $1`,
        [ids.roomId],
      )
    ).rows[0] as { room: string; plan: string };
    return { ids, installation, roomCode: codes.room, planCode: codes.plan };
  }

  /** A confirmed booking with a `confirmed` event and per-night prices 18650, 18651, … cents. */
  async function confirmed(ids: Ids, checkIn: string, opts: { nights?: number; rooms?: number; status?: string } = {}) {
    const nights = opts.nights ?? 2;
    const { bookingId, reservationIds } = await seedBooking(db, ids, { checkIn, nights, rooms: opts.rooms });
    await db.query(`UPDATE bookings SET status = $2::booking_status, confirmed_at = $3, commission_cents = 1678 WHERE id = $1`, [
      bookingId,
      opts.status ?? "confirmed",
      now,
    ]);
    await db.query(
      `UPDATE reservations
          SET nights = (SELECT jsonb_agg(jsonb_build_object(
                                 'date', (d::date)::text, 'priceCents', 18650 + n::int - 1, 'touristTaxCents', 300)
                               ORDER BY n)
                          FROM generate_series($2::date, $2::date + ($3::int - 1), interval '1 day') WITH ORDINALITY AS g(d, n)),
              tourist_tax_cents = 300 * $3::int, pay_at_property_cents = 2500
        WHERE booking_id = $1`,
      [bookingId, checkIn, nights],
    );
    await recordBookingEvent(db, { bookingId, kind: "confirmed", actor: system });
    return { bookingId, reservationIds };
  }

  const event = (bookingId: string, kind: BookingEventKind) => recordBookingEvent(db, { bookingId, kind, actor: system });

  async function cancelRoom(bookingId: string, reservationId: string) {
    await db.query(`UPDATE reservations SET cancelled_at = $2 WHERE id = $1`, [reservationId, now]);
    await event(bookingId, "rooms_cancelled");
  }

  const ownTxid = async () => ((await db.query(`SELECT pg_current_xact_id()::text AS t`)).rows[0] as { t: string }).t;
  /** The position of the last event this transaction wrote, as a cursor. */
  const hereCursor = async () => {
    const r = (
      await db.query(
        `SELECT pg_current_xact_id()::text AS t, COALESCE(max(seq), 0)::text AS s FROM booking_events WHERE txid = pg_current_xact_id()`,
      )
    ).rows[0] as { t: string; s: string };
    return `${r.t}:${r.s}`;
  };
  /** Treat this transaction as finished: every txid up to and including ours. */
  const finished = async () => (BigInt(await ownTxid()) + BigInt(1)).toString();
  const changes = async (installation: Installation, cursor: string | null, limit = 50): Promise<BookingChangesPage> =>
    BookingChangesPageSchema.parse(await loadBookingChangesBefore(db, installation, { cursor, limit }, await finished()));

  test("the snapshot returns upcoming bookings in full, nights in cents, and leaves out not_sent ones", async () => {
    const { ids, installation, roomCode, planCode } = await setup();
    const a = await confirmed(ids, "2031-06-10");
    const inHouse = await confirmed(ids, "2031-06-12", { status: "checked_in" });
    const notSent = await confirmed(ids, "2031-07-10");
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status) VALUES ($1, $2, 'not_sent')`,
      [installation.id, notSent.bookingId],
    );
    await confirmed(ids, "2031-08-10", { status: "cancelled" });
    // (Past stays are left out by the same `upcomingBookings` rule connectApp counts with; tested there.)
    const pending = await seedBooking(db, ids, { checkIn: "2031-09-10", nights: 1 }); // never paid
    expect(pending.bookingId).toBeTruthy();

    const page = BookingChangesPageSchema.parse(await loadBookingChanges(db, installation, { cursor: null, limit: 50 }));
    expect(page.hasMore).toBe(false);
    // The cursor starts at the snapshot's xmin: this (unfinished) transaction's events lie ahead of it.
    const [txid, seq] = page.nextCursor.split(":");
    expect(seq).toBe("0");
    expect(BigInt(txid!) <= BigInt(await ownTxid())).toBe(true);

    expect(page.bookings.map((b) => b.bookingId).sort()).toEqual([a.bookingId, inHouse.bookingId].sort());
    const version = Number(
      (
        (await db.query(`SELECT max(seq)::text AS v FROM booking_events WHERE booking_id = $1`, [a.bookingId])).rows[0] as {
          v: string;
        }
      ).v,
    );
    const got = page.bookings.find((b) => b.bookingId === a.bookingId)!;
    expect(got).toEqual({
      bookingId: a.bookingId,
      reference: bookingReference(a.bookingId),
      version,
      cancelled: false,
      createdAt: now.toISOString(),
      modifiedAt: expect.any(String),
      checkIn: "2031-06-10",
      checkOut: "2031-06-12",
      booker: { givenName: "Test", surname: "Guest" },
      rooms: [
        {
          reservationId: a.reservationIds[0]!,
          roomCode,
          ratePlanCode: planCode,
          checkIn: "2031-06-10",
          checkOut: "2031-06-12",
          adults: 2,
          children: 0,
          infants: 0,
          cots: 0,
          extraBeds: 0,
          cancelled: false,
          nights: [
            { date: "2031-06-10", priceCents: 18650 },
            { date: "2031-06-11", priceCents: 18651 },
          ],
          touristTaxCents: 600,
          payAtPropertyCents: 2500,
        },
      ],
      roomsTotalCents: 18650 + 18651,
      touristTaxCents: 600,
      commissionCents: 1678,
    });
    // No guest contact data anywhere: the seeded guest's email has an @.
    expect(JSON.stringify(page)).not.toContain("@");
  });

  test("a room cancelled after the snapshot comes in the next page with a higher version", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10", { rooms: 2 });
    const snapshot = await loadBookingChanges(db, installation, { cursor: null, limit: 50 });
    const before = snapshot.bookings.find((b) => b.bookingId === a.bookingId)!;

    await cancelRoom(a.bookingId, a.reservationIds[0]!);
    const page = await changes(installation, snapshot.nextCursor);
    expect(page.bookings).toHaveLength(1);
    const after = page.bookings[0]!;
    expect(after.bookingId).toBe(a.bookingId);
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.cancelled).toBe(false);
    const byId = new Map(after.rooms.map((r) => [r.reservationId, r.cancelled]));
    expect(byId.get(a.reservationIds[0]!)).toBe(true);
    expect(byId.get(a.reservationIds[1]!)).toBe(false);
  });

  test("paging with limit 1 returns two changed bookings across two calls, then an empty page", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10");
    const b = await confirmed(ids, "2031-06-20");
    const cursor = await hereCursor();
    await cancelRoom(a.bookingId, a.reservationIds[0]!);
    await cancelRoom(b.bookingId, b.reservationIds[0]!);

    const first = await changes(installation, cursor, 1);
    expect(first.bookings.map((x) => x.bookingId)).toEqual([a.bookingId]);
    expect(first.hasMore).toBe(true);
    const second = await changes(installation, first.nextCursor, 1);
    expect(second.bookings.map((x) => x.bookingId)).toEqual([b.bookingId]);
    expect(second.hasMore).toBe(false);
    expect(second.bookings[0]!.rooms[0]!.cancelled).toBe(true);
    const third = await changes(installation, second.nextCursor, 1);
    expect(third).toEqual({ bookings: [], nextCursor: second.nextCursor, hasMore: false });
  });

  test("check-in, no-show and refund events are not sent and do not raise the version; the cursor moves past them", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10");
    const cursor = await hereCursor();
    for (const kind of ["checked_in", "no_show", "goodwill_refund", "refund_succeeded", "outside_refund"] as const) {
      await event(a.bookingId, kind);
    }
    const quiet = await changes(installation, cursor);
    expect(quiet.bookings).toEqual([]);
    expect(quiet.nextCursor).toBe(await hereCursor());

    await event(a.bookingId, "forced_status");
    const page = await changes(installation, quiet.nextCursor);
    expect(page.bookings.map((x) => x.bookingId)).toEqual([a.bookingId]);
    expect(page.bookings[0]!.version).toBe(Number((await hereCursor()).split(":")[1]));
  });

  test("every delivery-relevant kind puts the booking in the feed", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10");
    for (const kind of DELIVERY_EVENT_KINDS) {
      const cursor = await hereCursor();
      await event(a.bookingId, kind);
      const page = await changes(installation, cursor);
      expect({ kind, ids: page.bookings.map((x) => x.bookingId) }).toEqual({ kind, ids: [a.bookingId] });
    }
  });

  test("another property's bookings never appear, nor do later changes of a not_sent booking", async () => {
    const { ids, installation } = await setup();
    const other = await seedProperty(db);
    await connectApp(db, { propertyId: other.propertyId, appKey: "siteminder", userId: "test-host-user", sendUpcoming: true, now });
    const cursor = await hereCursor();
    const theirs = await confirmed(other, "2031-06-10");
    await cancelRoom(theirs.bookingId, theirs.reservationIds[0]!);
    const notSent = await confirmed(ids, "2031-06-10");
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status) VALUES ($1, $2, 'not_sent')`,
      [installation.id, notSent.bookingId],
    );
    await cancelRoom(notSent.bookingId, notSent.reservationIds[0]!);

    expect((await changes(installation, cursor)).bookings).toEqual([]);
    const snapshot = await loadBookingChanges(db, installation, { cursor: null, limit: 50 });
    expect(snapshot.bookings).toEqual([]);
  });

  test("an early departure ends the stay the day after the last night stayed, with that night's money only", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10", { nights: 3 });
    await db.query(`UPDATE reservations SET pay_at_property_cents = 3000 WHERE booking_id = $1`, [a.bookingId]); // €10 a night
    const cursor = await hereCursor();
    await db.query(`UPDATE bookings SET departed_early_on = '2031-06-10', status = 'checked_in' WHERE id = $1`, [a.bookingId]);
    await event(a.bookingId, "early_departure");
    const got = (await changes(installation, cursor)).bookings[0]!;
    expect(got.checkOut).toBe("2031-06-11");
    expect(got.rooms[0]).toMatchObject({
      checkOut: "2031-06-11",
      nights: [{ date: "2031-06-10", priceCents: 18650 }],
      touristTaxCents: 300,
      payAtPropertyCents: 1000,
    });
    expect(got.roomsTotalCents).toBe(18650);
    expect(got.touristTaxCents).toBe(300);
  });

  test("after one of two rooms is cancelled, totals and commission are the remaining room's", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10", { rooms: 2 }); // rooms_total_cents 40000, commission 1678
    const cursor = await hereCursor();
    await cancelRoom(a.bookingId, a.reservationIds[0]!);
    // Refunded in full through OpenBookings: half the room price, so half the commission goes back.
    await db.query(
      `INSERT INTO refunds (booking_id, reservation_id, reason, accommodation_cents, tourist_tax_cents, amount_cents, status, idempotency_key)
       VALUES ($1, $2, 'guest_cancellation', 20000, 600, 20600, 'pending', $3)`,
      [a.bookingId, a.reservationIds[0], `test-${crypto.randomUUID()}`],
    );
    const got = (await changes(installation, cursor)).bookings[0]!;
    const cancelledById = new Map(got.rooms.map((r) => [r.reservationId, r.cancelled]));
    expect([cancelledById.get(a.reservationIds[0]!), cancelledById.get(a.reservationIds[1]!)]).toEqual([true, false]);
    expect(got.roomsTotalCents).toBe(18650 + 18651);
    expect(got.touristTaxCents).toBe(600);
    expect(got.commissionCents).toBe(1678 - 839);

    // A refund that failed, or one the host made outside OpenBookings, gives no commission back.
    await db.query(`UPDATE refunds SET status = 'failed' WHERE booking_id = $1`, [a.bookingId]);
    await db.query(
      `INSERT INTO refunds (booking_id, reason, source, accommodation_cents, tourist_tax_cents, amount_cents, status, idempotency_key)
       VALUES ($1, NULL, 'stripe_dashboard', 20000, 0, 20000, 'succeeded', $2)`,
      [a.bookingId, `test-${crypto.randomUUID()}`],
    );
    expect((await changes(installation, cursor)).bookings[0]!.commissionCents).toBe(1678);
  });

  test("the booker's name is first and last name only, as typed", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10");
    await db.query(
      `UPDATE "user" SET first_name = 'Zoë', last_name = 'O''Brien & Co' WHERE id = (SELECT user_id FROM bookings WHERE id = $1)`,
      [a.bookingId],
    );
    const got = (await changes(installation, `${await ownTxid()}:0`)).bookings[0]!;
    expect(got.booker).toEqual({ givenName: "Zoë", surname: "O'Brien & Co" });
  });

  test("a booking whose account is gone still appears, booked by \"Guest\"", async () => {
    const { ids, installation } = await setup();
    const a = await confirmed(ids, "2031-06-10");
    // The real database refuses an orphan; drop the key inside this rolled-back transaction to make one.
    await db.query(`ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_user_id_fkey`);
    await db.query(`UPDATE bookings SET user_id = $2 WHERE id = $1`, [a.bookingId, `test-gone-${crypto.randomUUID()}`]);
    const got = (await changes(installation, `${await ownTxid()}:0`)).bookings;
    expect(got.map((b) => b.bookingId)).toEqual([a.bookingId]);
    expect(got[0]!.booker).toEqual({ givenName: "", surname: "Guest" });
  });

  test("events of a transaction still running stay out, and the cursor never passes them", async () => {
    const { ids, installation } = await setup();
    const snapshot = await loadBookingChanges(db, installation, { cursor: null, limit: 50 });
    const a = await confirmed(ids, "2031-06-10");
    await cancelRoom(a.bookingId, a.reservationIds[0]!);

    // Read the way production does: this transaction has not committed, so its events are not final yet.
    const page = await loadBookingChanges(db, installation, { cursor: snapshot.nextCursor, limit: 50 });
    expect(page.bookings).toEqual([]);
    const [t, s] = page.nextCursor.split(":").map(BigInt) as [bigint, bigint];
    const own = BigInt(await ownTxid());
    expect(t < own || (t === own && s === BigInt(0))).toBe(true);

    // Once it has finished, the same cursor picks the booking up.
    const later = await changes(installation, page.nextCursor);
    expect(later.bookings.map((x) => x.bookingId)).toEqual([a.bookingId]);
  });

  test("a malformed cursor is refused", async () => {
    const { installation } = await setup();
    for (const cursor of ["", "abc", "1:", ":1", "1:2:3", "-1:0", "1.5:0"]) {
      await expect(loadBookingChanges(db, installation, { cursor, limit: 10 })).rejects.toThrow(/cursor/);
    }
  });
});

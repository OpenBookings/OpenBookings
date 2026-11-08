import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { loadBookingEvents, recordBookingEvent } from "./booking-events";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "./testing/db-harness";

describeWithDb("booking events against Postgres", () => {
  let db: Client;
  let bookingId: string;

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
    const ids = await seedProperty(db, { tier: "flex" });
    ({ bookingId } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 3, rooms: 1 }));
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("records and loads events oldest first", async () => {
    await recordBookingEvent(db, { bookingId, kind: "confirmed", actor: { kind: "system", id: null } });
    await recordBookingEvent(db, {
      bookingId,
      kind: "no_show",
      actor: { kind: "host", id: "h1" },
      reason: "test",
      data: { a: 1 },
    });
    const events = await loadBookingEvents(db, bookingId);
    expect(events.map((e) => e.kind)).toEqual(["confirmed", "no_show"]);
    expect(events[0].actorKind).toBe("system");
    expect(events[0].actorId).toBeNull();
    expect(events[1].actorKind).toBe("host");
    expect(events[1].actorId).toBe("h1");
    expect(events[1].reason).toBe("test");
    expect(events[1].data).toEqual({ a: 1 });
    expect(events[1].reservationId).toBeNull();
    expect(events[1].createdAt).toBeInstanceOf(Date);
  });

  test("loads nothing for a booking without events", async () => {
    expect(await loadBookingEvents(db, bookingId)).toEqual([]);
  });

  test("rejects an unknown actor kind", async () => {
    await expect(
      db.query(`INSERT INTO booking_events (booking_id, kind, actor_kind) VALUES ($1, 'confirmed', 'robot')`, [bookingId]),
    ).rejects.toThrow();
  });
});

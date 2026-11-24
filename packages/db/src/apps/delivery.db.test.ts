/** Delivery reports from apps, and what a booking change does to them (0060). Fixtures sit in 2031+. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { DeliveryReport } from "@openbookings/apps-contract";
import { recordBookingEvent, type BookingEventKind } from "../booking-events";
import { deliveryForBooking, recordDelivery } from "./delivery";
import { DELIVERY_EVENT_KINDS } from "./feed";
import { connectApp } from "./installations";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";

describeWithDb("app delivery status", () => {
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
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const delivered = (minutes: number): DeliveryReport => ({ status: "delivered", acknowledgedAt: at(minutes), detail: null });

  async function setup() {
    const ids = await seedProperty(db);
    const { installation } = await connectApp(db, {
      propertyId: ids.propertyId,
      appKey: "siteminder",
      userId: "test-host-user",
      sendUpcoming: true,
      now,
    });
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-06-10", nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    return { ids, installation, bookingId };
  }

  const row = async (bookingId: string) =>
    (
      await db.query(
        `SELECT status, acknowledged_at, detail, updated_at FROM app_booking_delivery WHERE booking_id = $1`,
        [bookingId],
      )
    ).rows[0] as { status: string; acknowledged_at: Date | null; detail: string | null; updated_at: Date } | undefined;

  const event = (bookingId: string, kind: BookingEventKind) =>
    recordBookingEvent(db, { bookingId, kind, actor: { kind: "system", id: null } });

  test("the first delivered report records the acknowledgement", async () => {
    const { installation, bookingId } = await setup();
    expect(await deliveryForBooking(db, bookingId)).toBeNull();
    expect(await recordDelivery(db, installation, bookingId, delivered(0), now)).toEqual({ result: "ok", previousStatus: null });
    expect(await deliveryForBooking(db, bookingId)).toEqual({
      appKey: "siteminder",
      status: "delivered",
      acknowledgedAt: at(0),
      detail: null,
    });
  });

  test("acknowledgedAt keeps the latest successful delivery: an earlier time never moves it back", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(10), now);
    expect(await recordDelivery(db, installation, bookingId, delivered(5), now)).toEqual({
      result: "ok",
      previousStatus: "delivered",
    });
    expect((await deliveryForBooking(db, bookingId))?.acknowledgedAt).toBe(at(10));
    // A later Modify delivered restarts the window.
    await recordDelivery(db, installation, bookingId, delivered(20), now);
    expect((await deliveryForBooking(db, bookingId))?.acknowledgedAt).toBe(at(20));
    // Delivered without a time keeps the one we have.
    await recordDelivery(db, installation, bookingId, { status: "delivered", acknowledgedAt: null, detail: null }, now);
    expect((await deliveryForBooking(db, bookingId))?.acknowledgedAt).toBe(at(20));
  });

  test("retrying and needs_attention keep the acknowledgement, store the reason and return the status they replace", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(10), now);
    expect(
      await recordDelivery(db, installation, bookingId, { status: "retrying", acknowledgedAt: at(30), detail: "timeout" }, now),
    ).toEqual({ result: "ok", previousStatus: "delivered" });
    expect(
      await recordDelivery(
        db,
        installation,
        bookingId,
        { status: "needs_attention", acknowledgedAt: null, detail: "Hotel not found in SiteMinder" },
        now,
      ),
    ).toEqual({ result: "ok", previousStatus: "retrying" });
    expect(await deliveryForBooking(db, bookingId)).toEqual({
      appKey: "siteminder",
      status: "needs_attention",
      acknowledgedAt: at(10),
      detail: "Hotel not found in SiteMinder",
    });
    expect((await row(bookingId))?.updated_at).toEqual(now);
  });

  test("a booking of another property, or no booking at all, is unknown and writes nothing", async () => {
    const { installation } = await setup();
    const other = await seedProperty(db);
    const { bookingId: theirs } = await seedBooking(db, other, { checkIn: "2031-06-10", nights: 2 });
    expect(await recordDelivery(db, installation, theirs, delivered(0), now)).toEqual({ result: "unknown-booking" });
    expect(await row(theirs)).toBeUndefined();
    expect(await recordDelivery(db, installation, crypto.randomUUID(), delivered(0), now)).toEqual({ result: "unknown-booking" });
    expect(await recordDelivery(db, installation, "not-a-uuid", delivered(0), now)).toEqual({ result: "unknown-booking" });
  });

  test("a delivery-relevant change puts a delivered booking back to pending in the same transaction", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(0), now);
    await event(bookingId, "checked_in");
    await event(bookingId, "goodwill_refund");
    expect((await row(bookingId))?.status).toBe("delivered");

    await event(bookingId, "rooms_cancelled");
    const after = await row(bookingId);
    expect(after?.status).toBe("pending");
    expect(after?.acknowledged_at?.toISOString()).toBe(at(0)); // kept: A3 and the app still know it was acknowledged
  });

  test("every delivery-relevant kind un-settles a delivered booking", async () => {
    const { installation, bookingId } = await setup();
    for (const kind of DELIVERY_EVENT_KINDS) {
      await recordDelivery(db, installation, bookingId, delivered(0), now);
      await event(bookingId, kind);
      expect({ kind, status: (await row(bookingId))?.status }).toEqual({ kind, status: "pending" });
    }
  });

  test("not_sent, retrying and needs_attention rows are left alone", async () => {
    const { ids, installation, bookingId } = await setup();
    await db.query(`INSERT INTO app_booking_delivery (installation_id, booking_id, status) VALUES ($1, $2, 'not_sent')`, [
      installation.id,
      bookingId,
    ]);
    await event(bookingId, "forced_cancel");
    expect((await row(bookingId))?.status).toBe("not_sent");

    const { bookingId: retrying } = await seedBooking(db, ids, { checkIn: "2031-07-10", nights: 1 });
    await recordDelivery(db, installation, retrying, { status: "retrying", acknowledgedAt: null, detail: "timeout" }, now);
    await event(retrying, "rooms_cancelled");
    expect((await row(retrying))?.status).toBe("retrying");
  });

  test("the trigger works for a writer with no rights on the delivery table (admin forced edit)", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(0), now);
    await db.query(`SET LOCAL ROLE ob_admin_write`);
    try {
      await event(bookingId, "forced_cancel");
    } finally {
      await db.query("RESET ROLE");
    }
    expect((await row(bookingId))?.status).toBe("pending");
  });
});

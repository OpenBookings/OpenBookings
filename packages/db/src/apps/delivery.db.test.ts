/** Delivery reports from apps, and what a booking change does to them (0060). Fixtures sit in 2031+. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { DeliveryReport } from "@openbookings/apps-contract";
import { loadStayAvailability } from "../availability";
import { recordBookingEvent, type BookingEventKind } from "../booking-events";
import { applyAriBatch } from "./ari";
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
  /** When reports arrive: after every acknowledgement used below, so none is capped at "now". */
  const later = new Date(now.getTime() + 60 * 60_000);
  const delivered = (minutes: number, version = 0): DeliveryReport => ({
    status: "delivered",
    acknowledgedAt: at(minutes),
    detail: null,
    version,
  });
  const report = (r: Omit<DeliveryReport, "version"> & { version?: number }): DeliveryReport => ({ version: 0, ...r });

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

  test("no report and nothing the app should have: nothing to show", async () => {
    const { ids } = await setup();
    // Stayed and left before the app was connected.
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-01-10", nights: 2 });
    await db.query(`UPDATE bookings SET status = 'completed' WHERE id = $1`, [bookingId]);
    expect(await deliveryForBooking(db, bookingId)).toBeNull();
    // And another hotel's booking is never this one's.
    const other = await seedProperty(db);
    const { bookingId: theirs } = await seedBooking(db, other, { checkIn: "2031-06-10", nights: 2 });
    expect(await deliveryForBooking(db, theirs, { propertyId: ids.propertyId })).toBeNull();
  });

  test("the first delivered report records the acknowledgement", async () => {
    const { installation, bookingId } = await setup();
    // Not reported yet, but the app should have it: on its way.
    expect(await deliveryForBooking(db, bookingId)).toEqual({ appKey: "siteminder", status: "pending", acknowledgedAt: null, detail: null });
    expect(await recordDelivery(db, installation, bookingId, delivered(0), later)).toEqual({
      result: "ok",
      previousStatus: null,
      status: "delivered",
    });
    expect(await deliveryForBooking(db, bookingId)).toEqual({
      appKey: "siteminder",
      status: "delivered",
      acknowledgedAt: at(0),
      detail: null,
    });
  });

  test("acknowledgedAt keeps the latest successful delivery: an earlier time never moves it back", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(10), later);
    expect(await recordDelivery(db, installation, bookingId, delivered(5), later)).toEqual({
      result: "ok",
      previousStatus: "delivered",
      status: "delivered",
    });
    expect((await deliveryForBooking(db, bookingId))?.acknowledgedAt).toBe(at(10));
    // A later Modify delivered restarts the window.
    await recordDelivery(db, installation, bookingId, delivered(20), later);
    expect((await deliveryForBooking(db, bookingId))?.acknowledgedAt).toBe(at(20));
    // Delivered without a time keeps the one we have.
    await recordDelivery(db, installation, bookingId, report({ status: "delivered", acknowledgedAt: null, detail: null }), later);
    expect((await deliveryForBooking(db, bookingId))?.acknowledgedAt).toBe(at(20));
  });

  test("retrying and needs_attention keep the acknowledgement, store the reason and return the status they replace", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(10), later);
    expect(
      await recordDelivery(db, installation, bookingId, report({ status: "retrying", acknowledgedAt: at(30), detail: "timeout" }), later),
    ).toEqual({ result: "ok", previousStatus: "delivered", status: "retrying" });
    expect(
      await recordDelivery(
        db,
        installation,
        bookingId,
        report({ status: "needs_attention", acknowledgedAt: null, detail: "Hotel not found in SiteMinder" }),
        later,
      ),
    ).toEqual({ result: "ok", previousStatus: "retrying", status: "needs_attention" });
    expect(await deliveryForBooking(db, bookingId)).toEqual({
      appKey: "siteminder",
      status: "needs_attention",
      acknowledgedAt: at(10),
      detail: "Hotel not found in SiteMinder",
    });
    expect((await row(bookingId))?.updated_at).toEqual(later);
  });

  test("a booking of another property, or no booking at all, is unknown and writes nothing", async () => {
    const { installation } = await setup();
    const other = await seedProperty(db);
    const { bookingId: theirs } = await seedBooking(db, other, { checkIn: "2031-06-10", nights: 2 });
    expect(await recordDelivery(db, installation, theirs, delivered(0), later)).toEqual({ result: "unknown-booking" });
    expect(await row(theirs)).toBeUndefined();
    expect(await recordDelivery(db, installation, crypto.randomUUID(), delivered(0), later)).toEqual({ result: "unknown-booking" });
    expect(await recordDelivery(db, installation, "not-a-uuid", delivered(0), later)).toEqual({ result: "unknown-booking" });
  });

  test("a delivery-relevant change puts a delivered booking back to pending in the same transaction", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(0), later);
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
      await recordDelivery(db, installation, bookingId, delivered(0), later);
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
    await recordDelivery(db, installation, retrying, report({ status: "retrying", acknowledgedAt: null, detail: "timeout" }), later);
    await event(retrying, "rooms_cancelled");
    expect((await row(retrying))?.status).toBe("retrying");
  });

  test("the trigger works for a writer with no rights on the delivery table (admin forced edit)", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(0), later);
    await db.query(`SET LOCAL ROLE ob_admin_write`);
    try {
      await event(bookingId, "forced_cancel");
    } finally {
      await db.query("RESET ROLE");
    }
    expect((await row(bookingId))?.status).toBe("pending");
  });

  const currentVersion = async (bookingId: string) =>
    Number(
      (
        (await db.query(`SELECT COALESCE(max(seq), 0)::text AS v FROM booking_events WHERE booking_id = $1 AND kind = ANY ($2)`, [
          bookingId,
          DELIVERY_EVENT_KINDS,
        ])).rows[0] as { v: string }
      ).v,
    );

  test("a delivered report for an older version leaves a changed booking pending, and it keeps counting (R13)", async () => {
    const { ids, installation, bookingId } = await setup();
    const roomCode = (
      (await db.query(`SELECT channel_code FROM rooms WHERE id = $1`, [ids.roomId])).rows[0] as { channel_code: string }
    ).channel_code;
    // The app's limit, received before anything was acknowledged.
    expect(
      (
        await applyAriBatch(
          db,
          installation,
          { inventory: [{ roomCode, from: "2031-06-10", to: "2031-06-11", unitsLeft: 2 }], rates: [], restrictions: [] },
          now,
        )
      ).ok,
    ).toBe(true);
    const unitsLeft = async () =>
      (await loadStayAvailability(db, { propertyId: ids.propertyId, checkIn: "2031-06-10", checkOut: "2031-06-12", now: later }))[0]!
        .unitsLeft;

    await event(bookingId, "confirmed");
    const v1 = await currentVersion(bookingId);
    await recordDelivery(db, installation, bookingId, delivered(0, v1), later);
    expect(await unitsLeft()).toBe(2); // acknowledged an hour ago: settled, part of the app's 2

    await event(bookingId, "forced_uncancel"); // the trigger un-settles it
    expect((await row(bookingId))?.status).toBe("pending");
    // A delayed or repeated report about v1 arrives.
    expect(await recordDelivery(db, installation, bookingId, delivered(1, v1), later)).toEqual({
      result: "ok",
      previousStatus: "pending",
      status: "pending",
    });
    const stale = await row(bookingId);
    expect(stale?.status).toBe("pending");
    expect(stale?.acknowledged_at?.toISOString()).toBe(at(1)); // the channel does hold the booking
    expect(await unitsLeft()).toBe(1);

    // The Modify for the current version is delivered.
    const v2 = await currentVersion(bookingId);
    expect(v2).toBeGreaterThan(v1);
    expect(await recordDelivery(db, installation, bookingId, delivered(2, v2), later)).toEqual({
      result: "ok",
      previousStatus: "pending",
      status: "delivered",
    });
    expect(await unitsLeft()).toBe(2);
  });

  test("a stale report never overwrites a stored delivered row (R16)", async () => {
    const { installation, bookingId } = await setup();
    await event(bookingId, "confirmed");
    const v1 = await currentVersion(bookingId);
    await event(bookingId, "forced_uncancel");
    const v2 = await currentVersion(bookingId);
    expect(v2).toBeGreaterThan(v1);
    await recordDelivery(db, installation, bookingId, delivered(0, v2), later);
    const before = await row(bookingId);
    expect(before?.status).toBe("delivered");

    for (const r of [
      report({ status: "retrying", acknowledgedAt: null, detail: "late", version: v1 }),
      report({ status: "needs_attention", acknowledgedAt: null, detail: "late", version: v1 }),
      delivered(30, v1),
    ]) {
      expect(await recordDelivery(db, installation, bookingId, r, later)).toEqual({
        result: "ok",
        previousStatus: "delivered",
        status: "delivered",
      });
      expect(await row(bookingId)).toEqual(before);
    }
    // A report for the current version still applies.
    expect(
      await recordDelivery(db, installation, bookingId, report({ status: "retrying", acknowledgedAt: null, detail: "now", version: v2 }), later),
    ).toEqual({ result: "ok", previousStatus: "delivered", status: "retrying" });
  });

  test("a not_sent row is never changed by a report (R15a)", async () => {
    const { installation, bookingId } = await setup();
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status, detail, updated_at) VALUES ($1, $2, 'not_sent', 'Not sent', $3)`,
      [installation.id, bookingId, now],
    );
    for (const r of [delivered(0), report({ status: "needs_attention", acknowledgedAt: null, detail: "boom" })]) {
      expect(await recordDelivery(db, installation, bookingId, r, later)).toEqual({
        result: "ok",
        previousStatus: "not_sent",
        status: "not_sent",
      });
    }
    expect(await row(bookingId)).toEqual({ status: "not_sent", acknowledged_at: null, detail: "Not sent", updated_at: now });
  });

  test("an acknowledgement time in the future is capped at now (R15b)", async () => {
    const { installation, bookingId } = await setup();
    await recordDelivery(db, installation, bookingId, delivered(24 * 60), later);
    expect((await deliveryForBooking(db, bookingId))?.acknowledgedAt).toBe(later.toISOString());
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { confirmBookingPolicy, loadBookingEvents } from "@openbookings/db";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  seedBooking,
  seedProperty,
} from "@openbookings/db/testing";
import {
  forceCancelRooms,
  forceClearMarkers,
  forceDeleteRefund,
  forceRefundStatus,
  forceStatus,
  forceUncancelRooms,
} from "./forced-edits";

const RANDOM = "7f1f6f0e-0000-4000-8000-000000000000";

describeWithDb("forced edits against Postgres", () => {
  let db: Client;
  let ids: Awaited<ReturnType<typeof seedProperty>>;
  let bookingId: string;
  let rooms: string[];

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
    ids = await seedProperty(db, { tier: "flex" });
    ({ bookingId, reservationIds: rooms } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2, rooms: 2 }));
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date() });
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const booking = async (id = bookingId) =>
    (await db.query(`SELECT status, cancelled_at, cancellation_reason FROM bookings WHERE id = $1`, [id])).rows[0];
  const lastEvent = async (kind: string) =>
    (await loadBookingEvents(db, bookingId)).filter((e) => e.kind === kind).at(-1)!;
  const addRefund = async (id = bookingId) =>
    (
      await db.query(
        `INSERT INTO refunds (booking_id, reason, accommodation_amount, tourist_tax_amount, amount, idempotency_key)
         VALUES ($1, 'goodwill', 10, 0, 10, 'test:'||gen_random_uuid()) RETURNING id`,
        [id],
      )
    ).rows[0].id as string;

  test("forceStatus sets any status and logs from/to", async () => {
    expect(await forceStatus(db, { bookingId, status: "checked_in", reason: "why" })).toEqual({ ok: true });
    expect((await booking()).status).toBe("checked_in");
    const e = await lastEvent("forced_status");
    expect(e.data).toEqual({ from: "confirmed", to: "checked_in" });
    expect(e.actorKind).toBe("admin");
    expect(e.actorId).toBe("dev-super-admin");
    expect(e.reason).toBe("why");
    expect(await forceStatus(db, { bookingId, status: "bogus" })).toEqual({ ok: false, error: "invalid" });
  });

  test("missing booking is not_found, bad id is invalid", async () => {
    expect(await forceStatus(db, { bookingId: RANDOM, status: "confirmed" })).toEqual({ ok: false, error: "not_found" });
    expect(await forceStatus(db, { bookingId: "abc", status: "confirmed" })).toEqual({ ok: false, error: "invalid" });
  });

  test("forceCancelRooms on both rooms cancels the booking without refunds", async () => {
    expect(await forceCancelRooms(db, { bookingId, reservationIds: rooms })).toEqual({ ok: true });
    const b = await booking();
    expect(b.status).toBe("cancelled");
    expect(b.cancellation_reason).toBe("Cancelled by admin");
    expect(b.cancelled_at).not.toBeNull();
    expect((await db.query(`SELECT 1 FROM refunds WHERE booking_id = $1`, [bookingId])).rowCount).toBe(0);
    expect((await lastEvent("forced_cancel")).data).toMatchObject({ cancelsBooking: true });
  });

  test("forceUncancelRooms restores a cancelled booking", async () => {
    await forceCancelRooms(db, { bookingId, reservationIds: rooms });
    expect(await forceUncancelRooms(db, { bookingId, reservationIds: rooms })).toEqual({ ok: true });
    const b = await booking();
    expect(b.status).toBe("confirmed");
    expect(b.cancelled_at).toBeNull();
    expect(b.cancellation_reason).toBeNull();
    expect((await lastEvent("forced_uncancel")).data).toMatchObject({
      bookingStatusFrom: "cancelled",
      bookingStatusTo: "confirmed",
    });
  });

  test("uncancel one room of a confirmed booking leaves status alone", async () => {
    await forceCancelRooms(db, { bookingId, reservationIds: [rooms[0]] });
    expect((await booking()).status).toBe("confirmed");
    await forceUncancelRooms(db, { bookingId, reservationIds: [rooms[0]] });
    const r = await db.query(`SELECT cancelled_at FROM reservations WHERE id = $1`, [rooms[0]]);
    expect(r.rows[0].cancelled_at).toBeNull();
    expect((await booking()).status).toBe("confirmed");
  });

  test("ignores rooms of another booking and rejects bad input", async () => {
    const other = await seedBooking(db, ids, { checkIn: "2031-12-10", nights: 2, rooms: 1 });
    await db.query(`UPDATE reservations SET cancelled_at = now() WHERE id = $1`, [other.reservationIds[0]]);
    await forceUncancelRooms(db, { bookingId, reservationIds: [other.reservationIds[0]] });
    const r = await db.query(`SELECT cancelled_at FROM reservations WHERE id = $1`, [other.reservationIds[0]]);
    expect(r.rows[0].cancelled_at).not.toBeNull();
    expect(await forceCancelRooms(db, { bookingId, reservationIds: [] })).toEqual({ ok: false, error: "invalid" });
    expect(await forceCancelRooms(db, { bookingId, reservationIds: ["x"] })).toEqual({ ok: false, error: "invalid" });
  });

  test("forceDeleteRefund removes the row and records it", async () => {
    const refundId = await addRefund();
    expect(await forceDeleteRefund(db, { bookingId, refundId })).toEqual({ ok: true });
    expect((await db.query(`SELECT 1 FROM refunds WHERE id = $1`, [refundId])).rowCount).toBe(0);
    expect(((await lastEvent("forced_refund_deleted")).data as { refund: { id: string } }).refund.id).toBe(refundId);
  });

  test("forceRefundStatus changes status and logs from/to", async () => {
    const refundId = await addRefund();
    expect(await forceRefundStatus(db, { bookingId, refundId, status: "failed" })).toEqual({ ok: true });
    expect((await lastEvent("forced_refund_status")).data).toEqual({ refundId, from: "pending", to: "failed" });
    expect(await forceRefundStatus(db, { bookingId, refundId, status: "refunded" as never })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  test("a refund of another booking is not_found", async () => {
    const other = await seedBooking(db, ids, { checkIn: "2031-12-10", nights: 2, rooms: 1 });
    const refundId = await addRefund(other.bookingId);
    expect(await forceDeleteRefund(db, { bookingId, refundId })).toEqual({ ok: false, error: "not_found" });
    expect(await forceRefundStatus(db, { bookingId, refundId, status: "succeeded" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  test("forceClearMarkers nulls the chosen markers", async () => {
    await db.query(`UPDATE bookings SET no_show_reported_at = now() WHERE id = $1`, [bookingId]);
    expect(await forceClearMarkers(db, { bookingId, noShow: true, earlyDeparture: false })).toEqual({ ok: true });
    const r = await db.query(`SELECT no_show_reported_at, departed_early_on FROM bookings WHERE id = $1`, [bookingId]);
    expect(r.rows[0].no_show_reported_at).toBeNull();
    expect((await lastEvent("forced_markers_cleared")).data).toEqual({ noShow: true, earlyDeparture: false });
  });
});

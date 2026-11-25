/** The delivery watchdog (R28): which bookings it flags, and that each move into needs_attention mails once. Fixtures sit in 2031+. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";
import { recordDelivery } from "./delivery";
import { connectApp, disconnectApp, type Installation } from "./installations";
import { claimAlert, claimUnmailedAlerts, flagUnconfirmedDeliveries } from "./watchdog";

const NOW = new Date("2031-05-01T12:00:00Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

describeWithDb("delivery watchdog", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let installation: Installation;

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
    ids = await seedProperty(db);
    installation = (
      await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId: "test-host-user", sendUpcoming: true, now: ago(120) })
    ).installation;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  /** A booking with a `confirmed` event at `eventAt` (and the delivery row, when given). */
  async function booking(i: {
    eventAt: Date;
    checkIn?: string;
    status?: string;
    row?: string;
    property?: { propertyId: string; roomId: string; ratePlanId: string };
  }) {
    const p = i.property ?? ids;
    const { bookingId } = await seedBooking(db, p, { checkIn: i.checkIn ?? "2031-06-10", nights: 2 });
    await db.query(`UPDATE bookings SET status = $2::booking_status WHERE id = $1`, [bookingId, i.status ?? "confirmed"]);
    await db.query(
      `INSERT INTO booking_events (booking_id, kind, actor_kind, created_at) VALUES ($1, 'confirmed', 'guest', $2)`,
      [bookingId, i.eventAt],
    );
    if (i.row) {
      await db.query(`INSERT INTO app_booking_delivery (installation_id, booking_id, status, updated_at) VALUES ($1, $2, $3, $4)`, [
        installation.id,
        bookingId,
        i.row,
        ago(60),
      ]);
    }
    return bookingId;
  }

  test("flags bookings the app should have confirmed by now, and nothing else", async () => {
    const noRow = await booking({ eventAt: ago(40) });
    const retrying = await booking({ eventAt: ago(40), row: "retrying" });
    const pending = await booking({ eventAt: ago(31), row: "pending" });
    const backfill = await booking({ eventAt: ago(180) }); // upcoming when the app connected 2 hours ago
    await booking({ eventAt: ago(10) }); // too recent
    await booking({ eventAt: ago(40), row: "delivered" });
    await booking({ eventAt: ago(40), row: "not_sent" });
    const already = await booking({ eventAt: ago(40), row: "needs_attention" });
    await booking({ eventAt: ago(600), checkIn: "2031-04-20", status: "completed" }); // stayed before connecting
    // Checked out on the connect day (and an early departure), both completed: not in the connect snapshot either.
    await booking({ eventAt: ago(3000), checkIn: "2031-04-29", status: "completed" });
    await booking({ eventAt: ago(3000), checkIn: "2031-04-30", status: "completed" });
    const other = await seedProperty(db);
    await booking({ eventAt: ago(40), property: other }); // no app

    const flagged = await flagUnconfirmedDeliveries(db, NOW);
    expect(flagged.map((f) => f.bookingId).sort()).toEqual([noRow, retrying, pending, backfill].sort());
    expect(flagged[0]).toMatchObject({
      installationId: installation.id,
      propertyId: ids.propertyId,
      appKey: "siteminder",
      detail: "Not confirmed by SiteMinder within 30 minutes",
    });
    const rows = (
      await db.query(`SELECT booking_id, status, mailed_at FROM app_booking_delivery WHERE installation_id = $1 AND status = 'needs_attention'`, [
        installation.id,
      ])
    ).rows as { booking_id: string; mailed_at: Date | null }[];
    expect(rows.map((r) => r.booking_id).sort()).toEqual([noRow, retrying, pending, backfill, already].sort());

    // A second run finds nothing new.
    expect(await flagUnconfirmedDeliveries(db, NOW)).toEqual([]);
  });

  test("a disconnected installation is not watched", async () => {
    await booking({ eventAt: ago(40) });
    await disconnectApp(db, { installationId: installation.id, now: ago(1) });
    expect(await flagUnconfirmedDeliveries(db, NOW)).toEqual([]);
  });

  test("each move into needs_attention mails once", async () => {
    const id = await booking({ eventAt: ago(40) });
    const report = (status: "delivered" | "needs_attention", version: number) =>
      recordDelivery(db, installation, id, { status, acknowledgedAt: status === "delivered" ? ago(1).toISOString() : null, detail: null, version }, NOW);
    const version = Number(((await db.query(`SELECT max(seq)::text AS v FROM booking_events WHERE booking_id = $1`, [id])).rows[0] as { v: string }).v);

    await report("needs_attention", version);
    const claim = () => claimAlert(db, { installationId: installation.id, bookingId: id, now: NOW });
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await report("needs_attention", version); // repeated: still mailed
    expect(await claim()).toBe(false);

    await report("delivered", version); // leaves needs_attention: the mail re-arms
    await report("needs_attention", version);
    expect(await claim()).toBe(true);
  });

  test("an unmailed needs_attention row is claimed once, after the route's grace, only for active installations", async () => {
    const stale = await booking({ eventAt: ago(40), row: "needs_attention" }); // updated an hour ago, never mailed
    const fresh = await booking({ eventAt: ago(40) });
    await db.query(`INSERT INTO app_booking_delivery (installation_id, booking_id, status, updated_at) VALUES ($1, $2, 'needs_attention', $3)`, [
      installation.id,
      fresh,
      ago(1),
    ]);
    const mailed = await booking({ eventAt: ago(40), row: "needs_attention" });
    await claimAlert(db, { installationId: installation.id, bookingId: mailed, now: ago(30) });

    const claimed = await claimUnmailedAlerts(db, NOW);
    expect(claimed.map((c) => c.bookingId)).toEqual([stale]);
    expect(claimed[0]).toMatchObject({ propertyId: ids.propertyId, appKey: "siteminder" });
    expect(await claimUnmailedAlerts(db, NOW)).toEqual([]);

    await db.query(`UPDATE app_booking_delivery SET mailed_at = NULL WHERE booking_id = $1`, [stale]);
    await disconnectApp(db, { installationId: installation.id, now: NOW });
    expect(await claimUnmailedAlerts(db, NOW)).toEqual([]);
  });
});

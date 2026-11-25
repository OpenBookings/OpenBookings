/** App installations and per-property keys (0060). Fixtures sit in 2031+ so dev data cannot interfere. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import {
  activeInstallation,
  connectApp,
  disconnectApp,
  installationForKey,
  upcomingUndeliveredCount,
} from "./installations";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";

describeWithDb("app installations", () => {
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
  const userId = "test-host-user";

  async function confirmed(ids: Awaited<ReturnType<typeof seedProperty>>, checkIn: string, status = "confirmed") {
    const { bookingId } = await seedBooking(db, ids, { checkIn, nights: 2 });
    await db.query(`UPDATE bookings SET status = $2::booking_status WHERE id = $1`, [bookingId, status]);
    return bookingId;
  }
  const deliveryStatuses = async (installationId: string) =>
    (
      await db.query(`SELECT booking_id, status FROM app_booking_delivery WHERE installation_id = $1`, [installationId])
    ).rows as { booking_id: string; status: string }[];

  test("a key finds its active installation; wrong keys and disconnected ones find nothing", async () => {
    const { propertyId } = await seedProperty(db);
    const { installation, apiKey } = await connectApp(db, {
      propertyId,
      appKey: "siteminder",
      userId,
      sendUpcoming: true,
      now,
    });
    expect(installation).toMatchObject({ propertyId, appKey: "siteminder", status: "active" });
    expect(await installationForKey(db, apiKey)).toEqual(installation);
    expect(await installationForKey(db, "obk_" + "x".repeat(40))).toBeNull();
    expect(await activeInstallation(db, propertyId)).toEqual(installation);

    const stored = (await db.query(`SELECT key_hash, key_last4 FROM app_installations WHERE id = $1`, [installation.id]))
      .rows[0] as { key_hash: string; key_last4: string };
    expect(stored.key_hash).not.toContain(apiKey);
    expect(stored.key_last4).toBe(apiKey.slice(-4));

    await disconnectApp(db, { installationId: installation.id, now });
    expect(await installationForKey(db, apiKey)).toBeNull();
    expect(await activeInstallation(db, propertyId)).toBeNull();
  });

  test("reconnect keeps the installation id, its delivery rows, and retires the old key", async () => {
    const ids = await seedProperty(db);
    const first = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    const bookingId = await confirmed(ids, "2031-06-10");
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at) VALUES ($1, $2, 'delivered', now())`,
      [first.installation.id, bookingId],
    );
    await disconnectApp(db, { installationId: first.installation.id, now });

    const second = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: false, now });
    expect(second.installation.id).toBe(first.installation.id);
    expect(second.apiKey).not.toBe(first.apiKey);
    expect(await installationForKey(db, first.apiKey)).toBeNull();
    expect((await installationForKey(db, second.apiKey))?.id).toBe(first.installation.id);
    // The delivered booking stays delivered; it is not marked not_sent.
    expect(await deliveryStatuses(first.installation.id)).toEqual([{ booking_id: bookingId, status: "delivered" }]);
    expect(second.notSentCount).toBe(0);
  });

  test("connecting twice in a row replaces the key and leaves one active installation", async () => {
    const { propertyId } = await seedProperty(db);
    const a = await connectApp(db, { propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    const b = await connectApp(db, { propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    expect(b.installation.id).toBe(a.installation.id);
    expect(await installationForKey(db, a.apiKey)).toBeNull();
    const rows = (await db.query(`SELECT count(*)::int AS n FROM app_installations WHERE property_id = $1`, [propertyId]))
      .rows[0] as { n: number };
    expect(rows.n).toBe(1);
  });

  test("sendUpcoming false marks upcoming confirmed and checked-in bookings not_sent, not past or cancelled ones", async () => {
    const ids = await seedProperty(db);
    const a = await confirmed(ids, "2031-06-10");
    const b = await confirmed(ids, "2031-07-10", "checked_in");
    await confirmed(ids, "2030-01-10"); // checked out long before "today"
    await confirmed(ids, "2031-08-10", "cancelled");
    const res = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: false, now });
    expect(res.notSentCount).toBe(2);
    const rows = await deliveryStatuses(res.installation.id);
    expect(rows.map((r) => r.booking_id).sort()).toEqual([a, b].sort());
    expect(rows.every((r) => r.status === "not_sent")).toBe(true);
  });

  test("sendUpcoming true writes no delivery rows", async () => {
    const ids = await seedProperty(db);
    await confirmed(ids, "2031-06-10");
    const res = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    expect(res.notSentCount).toBe(0);
    expect(await deliveryStatuses(res.installation.id)).toEqual([]);
  });

  test("a stay checking out today (property time) still counts as upcoming", async () => {
    const ids = await seedProperty(db); // Europe/Amsterdam
    await confirmed(ids, "2031-02-27"); // 2 nights: check-out 2031-03-01
    // 23:30 UTC on 28 Feb is already 1 March in Amsterdam, so check-out is today.
    expect(await upcomingUndeliveredCount(db, ids.propertyId, "2031-03-01")).toBe(1);
    expect(await upcomingUndeliveredCount(db, ids.propertyId, "2031-03-02")).toBe(0);
    const res = await connectApp(db, {
      propertyId: ids.propertyId,
      appKey: "siteminder",
      userId,
      sendUpcoming: false,
      now: new Date("2031-02-28T23:30:00Z"),
    });
    expect(res.notSentCount).toBe(1);
  });

  test("upcomingUndeliveredCount counts bookings without a delivered row", async () => {
    const ids = await seedProperty(db);
    const a = await confirmed(ids, "2031-06-10");
    await confirmed(ids, "2031-07-10");
    await confirmed(ids, "2030-01-10");
    expect(await upcomingUndeliveredCount(db, ids.propertyId, "2031-03-01")).toBe(2);
    const { installation } = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    await db.query(`INSERT INTO app_booking_delivery (installation_id, booking_id, status) VALUES ($1, $2, 'delivered')`, [installation.id, a]);
    expect(await upcomingUndeliveredCount(db, ids.propertyId, "2031-03-01")).toBe(1);
  });

  test("acknowledged bookings keep their row on reconnect and are not counted, even when pending or needs_attention", async () => {
    const ids = await seedProperty(db);
    const first = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    const pending = await confirmed(ids, "2031-06-10");
    const attention = await confirmed(ids, "2031-07-10");
    const unacked = await confirmed(ids, "2031-08-10");
    await db.query(
      `INSERT INTO app_booking_delivery (installation_id, booking_id, status, acknowledged_at) VALUES
         ($1, $2, 'pending', now()), ($1, $3, 'needs_attention', now())`,
      [first.installation.id, pending, attention],
    );
    await db.query(`INSERT INTO app_booking_delivery (installation_id, booking_id, status) VALUES ($1, $2, 'retrying')`, [
      first.installation.id,
      unacked,
    ]);
    expect(await upcomingUndeliveredCount(db, ids.propertyId, "2031-03-01")).toBe(1);
    await disconnectApp(db, { installationId: first.installation.id, now });
    const second = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: false, now });
    const byBooking = new Map((await deliveryStatuses(second.installation.id)).map((r) => [r.booking_id, r.status]));
    expect(byBooking.get(pending)).toBe("pending");
    expect(byBooking.get(attention)).toBe("needs_attention");
    expect(byBooking.get(unacked)).toBe("not_sent");
    expect(second.notSentCount).toBe(1);
  });

  test("reconnecting starts from nothing: the earlier connection's ARI is gone, other hotels' stays", async () => {
    const ids = await seedProperty(db);
    const other = await seedProperty(db);
    const first = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    await connectApp(db, { propertyId: other.propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });
    for (const p of [ids, other]) {
      await db.query(`INSERT INTO app_inventory (room_id, date, units_left, received_at) VALUES ($1, '2031-06-01', 2, now())`, [p.roomId]);
      await db.query(`INSERT INTO app_rates (rate_plan_id, date, price_cents, received_at) VALUES ($1, '2031-06-01', 9000, now())`, [p.ratePlanId]);
      await db.query(`INSERT INTO app_restrictions (rate_plan_id, date, is_closed, received_at) VALUES ($1, '2031-06-01', true, now())`, [
        p.ratePlanId,
      ]);
    }
    await disconnectApp(db, { installationId: first.installation.id, now });
    await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId, sendUpcoming: true, now });

    const left = async (p: { roomId: string; ratePlanId: string }) =>
      (
        await db.query(
          `SELECT (SELECT count(*) FROM app_inventory WHERE room_id = $1)::int AS inv,
                  (SELECT count(*) FROM app_rates WHERE rate_plan_id = $2)::int AS rates,
                  (SELECT count(*) FROM app_restrictions WHERE rate_plan_id = $2)::int AS restrictions`,
          [p.roomId, p.ratePlanId],
        )
      ).rows[0];
    expect(await left(ids)).toEqual({ inv: 0, rates: 0, restrictions: 0 });
    expect(await left(other)).toEqual({ inv: 1, rates: 1, restrictions: 1 });
  });
});

/**
 * Connecting and disconnecting SiteMinder, and what the Channel manager page
 * reads back, against Postgres. Authorisation is the real authz check on real
 * membership rows; the app's registry is faked. Every test runs in a
 * transaction that is rolled back; fixtures sit in 2031+.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { InstallationRegistration } from "@openbookings/apps-contract";
import { activeInstallation, applyAriBatch, connectApp } from "@openbookings/db/apps";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { CONNECT_UNAVAILABLE } from "@/lib/apps/managed-view";
import { connectChannelManager, disconnectChannelManager, type ConnectDeps } from "./connect";
import { loadBookingDelivery, loadChannelManager } from "./data";

describeWithDb("channel manager", () => {
  let db: Client;
  let ids: { propertyId: string; roomId: string; ratePlanId: string };
  let ownerId: string;
  let frontdeskId: string;
  let registered: InstallationRegistration[];
  let unregistered: string[];
  let registerFails: boolean;
  let unregisterFails: boolean;
  let baseUrl: string | undefined;

  const now = new Date("2031-03-01T12:00:00Z");
  const row = async <T,>(sql: string, values: unknown[] = []) => ((await db.query(sql, values)).rows[0] ?? null) as T | null;

  const deps = (): ConnectDeps => ({
    tx: async (fn) => {
      await db.query("SAVEPOINT channel_manager");
      try {
        const result = await fn(db);
        await db.query("RELEASE SAVEPOINT channel_manager");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT channel_manager");
        throw error;
      }
    },
    queryOne: (sql, values) => row(sql, values),
    pin: async () => ({ currentPropertyId: ids.propertyId }),
    register: async (r) => {
      if (registerFails) throw new Error("app is down");
      registered.push(r);
    },
    unregister: async (id) => {
      if (unregisterFails) throw new Error("app is down");
      unregistered.push(id);
    },
    coreBaseUrl: () => baseUrl,
    now: () => now,
  });

  const session = (id: string) => ({ user: { id, account_type: "business" } });

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
    registered = [];
    unregistered = [];
    registerFails = false;
    unregisterFails = false;
    baseUrl = "https://business.example";

    ids = await seedProperty(db);
    const user = async (label: string) => {
      const id = `test-${label}-${crypto.randomUUID()}`;
      await db.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, $2, $3, true, 'business'::account_type)`,
        [id, label, `${id}@example.test`],
      );
      return id;
    };
    ownerId = await user("owner");
    frontdeskId = await user("frontdesk");
    const orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, NOW())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $2, owner_user_id = $3 WHERE id = $1`, [ids.propertyId, orgId, ownerId]);
    for (const [userId, role] of [[ownerId, "owner"], [frontdeskId, "frontdesk"]]) {
      const memberId = `test-member-${crypto.randomUUID()}`;
      await db.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, NOW())`, [memberId, orgId, userId, role]);
      await db.query(`INSERT INTO property_access (member_id, property_id) VALUES ($1, $2)`, [memberId, ids.propertyId]);
    }
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  // ── Connect ─────────────────────────────────────────────────────────

  test("a front desk member cannot connect, and nothing is written or registered", async () => {
    const result = await connectChannelManager(session(frontdeskId), { propertyId: ids.propertyId, sendUpcoming: true }, deps());
    expect(result).toEqual({ ok: false, error: "Property not found" });
    expect(await activeInstallation(db, ids.propertyId)).toBeNull();
    expect(registered).toEqual([]);
  });

  test("a stale tab (another hotel is current) is refused as property-switched", async () => {
    const other = await seedProperty(db);
    const stale = { ...deps(), pin: async () => ({ currentPropertyId: other.propertyId }) };
    const result = await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: true }, stale);
    expect(result).toMatchObject({ ok: false, reason: "property-switched" });
    expect(await activeInstallation(db, ids.propertyId)).toBeNull();
  });

  test("an owner connects: the property code comes back and the app is told the key and the coordinates", async () => {
    const result = await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: true }, deps());
    const property = await row<{ channel_code: string; name: string }>(`SELECT channel_code, name FROM properties WHERE id = $1`, [ids.propertyId]);
    expect(result).toEqual({ ok: true, propertyCode: property!.channel_code });

    const installation = await activeInstallation(db, ids.propertyId);
    expect(installation).toMatchObject({ appKey: "siteminder", status: "active" });
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      installationId: installation!.id,
      propertyCode: property!.channel_code,
      propertyName: property!.name,
      coreBaseUrl: "https://business.example",
    });
    expect(registered[0].apiKey).toMatch(/^obk_[0-9A-Za-z]{40}$/);
  });

  test("unticking 'send upcoming' marks the upcoming bookings not sent", async () => {
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-03-10", nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed'::booking_status WHERE id = $1`, [bookingId]);
    await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: false }, deps());
    expect((await loadBookingDelivery(bookingId, ids.propertyId, db))?.status).toBe("not_sent");
  });

  test("when the app cannot be told, the connection is rolled back and the hotel sees the plain error", async () => {
    registerFails = true;
    const result = await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: true }, deps());
    expect(result).toEqual({ ok: false, error: CONNECT_UNAVAILABLE });
    expect(CONNECT_UNAVAILABLE).toBe("SiteMinder connection is not available right now. Try again in a few minutes.");
    expect(await activeInstallation(db, ids.propertyId)).toBeNull();
    expect(await row(`SELECT 1 FROM app_installations WHERE property_id = $1`, [ids.propertyId])).toBeNull();
  });

  test("without APPS_API_BASE_URL nothing is connected and nobody is told", async () => {
    baseUrl = undefined;
    const result = await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: true }, deps());
    expect(result).toEqual({ ok: false, error: CONNECT_UNAVAILABLE });
    expect(await activeInstallation(db, ids.propertyId)).toBeNull();
    expect(registered).toEqual([]);
  });

  // ── Disconnect ──────────────────────────────────────────────────────

  test("a front desk member cannot disconnect", async () => {
    await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: true }, deps());
    const result = await disconnectChannelManager(session(frontdeskId), { propertyId: ids.propertyId }, deps());
    expect(result).toEqual({ ok: false, error: "Property not found" });
    expect(await activeInstallation(db, ids.propertyId)).not.toBeNull();
    expect(unregistered).toEqual([]);
  });

  test("an owner disconnects: the installation is off and the app is told to forget it", async () => {
    await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: true }, deps());
    const installationId = (await activeInstallation(db, ids.propertyId))!.id;
    expect(await disconnectChannelManager(session(ownerId), { propertyId: ids.propertyId }, deps())).toEqual({ ok: true });
    expect(await activeInstallation(db, ids.propertyId)).toBeNull();
    expect(unregistered).toEqual([installationId]);
  });

  test("when the app cannot be told to forget, the hotel is still disconnected", async () => {
    await connectChannelManager(session(ownerId), { propertyId: ids.propertyId, sendUpcoming: true }, deps());
    unregisterFails = true;
    expect(await disconnectChannelManager(session(ownerId), { propertyId: ids.propertyId }, deps())).toEqual({ ok: true });
    expect(await activeInstallation(db, ids.propertyId)).toBeNull();
  });

  test("disconnecting a hotel that is not connected changes nothing and tells nobody", async () => {
    expect(await disconnectChannelManager(session(ownerId), { propertyId: ids.propertyId }, deps())).toEqual({ ok: true });
    expect(unregistered).toEqual([]);
  });

  // ── What the page reads ─────────────────────────────────────────────

  test("not connected: the code and how many upcoming bookings the tick box would send", async () => {
    const { bookingId } = await seedBooking(db, ids, { checkIn: "2031-03-10", nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed'::booking_status WHERE id = $1`, [bookingId]);
    const property = await row<{ channel_code: string; timezone: string }>(`SELECT channel_code, timezone FROM properties WHERE id = $1`, [ids.propertyId]);

    expect(await loadChannelManager(ids.propertyId, db, now)).toEqual({
      connected: false,
      propertyCode: property!.channel_code,
      timezone: property!.timezone,
      appName: "SiteMinder",
      connectedAt: null,
      upcomingCount: 1,
      roomsLinked: 0,
      roomsTotal: 0,
      lastUpdateAt: null,
      needsAttentionCount: 0,
    });
    expect(await loadChannelManager("11111111-1111-4111-8111-111111111111", db, now)).toBeNull();
  });

  test("connected: rooms linked of active rooms, the latest update and the bookings needing attention", async () => {
    const { installation } = await connectApp(db, { propertyId: ids.propertyId, appKey: "siteminder", userId: ownerId, sendUpcoming: true, now });
    // An active room without data, a draft and an archived room (neither counts), and one with data only in the past.
    const addRoom = async (name: string, columns: string) =>
      (await row<{ id: string }>(
        `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, ${columns.split("=")[0]}) VALUES ($1, $2, 2, 2, 1, ${columns.split("=")[1]}) RETURNING id`,
        [ids.propertyId, name],
      ))!.id;
    await addRoom("Without data", "is_active=true");
    await addRoom("Draft", "is_active=false");
    await db.query(`UPDATE rooms SET archived_at = now() WHERE id = $1`, [await addRoom("Archived", "is_active=false")]);
    const pastOnly = (await row<{ id: string }>(`INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active) VALUES ($1, 'Past', 2, 2, 1, true) RETURNING id`, [ids.propertyId]))!.id;

    const codes = await row<{ room: string; past: string }>(
      `SELECT (SELECT channel_code FROM rooms WHERE id = $1) AS room, (SELECT channel_code FROM rooms WHERE id = $2) AS past`,
      [ids.roomId, pastOnly],
    );
    await applyAriBatch(
      db,
      installation,
      {
        inventory: [
          { roomCode: codes!.room, from: "2031-03-05", to: "2031-03-06", unitsLeft: 2 },
          { roomCode: codes!.past, from: "2031-02-01", to: "2031-02-02", unitsLeft: 2 },
        ],
        rates: [],
        restrictions: [],
      },
      new Date("2031-03-01T10:00:00Z"),
    );
    await applyAriBatch(
      db,
      installation,
      { inventory: [], rates: [], restrictions: [{ ratePlanCode: (await row<{ c: string }>(`SELECT channel_code AS c FROM rate_plans WHERE id = $1`, [ids.ratePlanId]))!.c, from: "2031-03-05", to: "2031-03-05", closed: true }] },
      new Date("2031-03-01T11:30:00Z"),
    );

    const upcoming = await seedBooking(db, ids, { checkIn: "2031-03-10", nights: 2 });
    const past = await seedBooking(db, ids, { checkIn: "2031-02-10", nights: 2 });
    for (const [bookingId, status] of [[upcoming.bookingId, "needs_attention"], [past.bookingId, "needs_attention"]]) {
      await db.query(
        `INSERT INTO app_booking_delivery (installation_id, booking_id, status, detail, updated_at) VALUES ($1, $2, $3, 'Hotel not found', $4)`,
        [installation.id, bookingId, status, now],
      );
    }

    expect(await loadChannelManager(ids.propertyId, db, now)).toMatchObject({
      connected: true,
      appName: "SiteMinder",
      connectedAt: now.toISOString(),
      upcomingCount: 0,
      roomsLinked: 1,
      roomsTotal: 3,
      lastUpdateAt: "2031-03-01T11:30:00.000Z",
      needsAttentionCount: 1,
    });
    expect(await loadBookingDelivery(upcoming.bookingId, ids.propertyId, db)).toMatchObject({ appKey: "siteminder", status: "needs_attention", detail: "Hotel not found" });
    expect(await loadBookingDelivery("11111111-1111-4111-8111-111111111111", ids.propertyId, db)).toBeNull();
    // Asked for from another hotel, the booking is not there.
    const other = await seedProperty(db);
    expect(await loadBookingDelivery(upcoming.bookingId, other.propertyId, db)).toBeNull();
  });
});

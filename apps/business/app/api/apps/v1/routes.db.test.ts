/**
 * Apps API v1 routes against a real Postgres: the exported handlers are called
 * with plain Requests (no cookie), the pool is this test's transaction.
 * Fixtures sit in 2031+.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { Client } from "pg";
import { BookingChangesPageSchema, AppStructureSchema } from "@openbookings/apps-contract";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { mockModules } from "@/lib/mock-modules";

let db: Client;
/** Set to make the next matching query fail like Postgres would. */
let failNext: { match: string; error: Error } | null = null;

const realDb = await import("@openbookings/db");

/** One client, so parallel queries take turns (pg warns on overlap). */
let queue: Promise<unknown> = Promise.resolve();
function run(text: string, values?: unknown[]) {
  if (failNext && text.includes(failNext.match)) {
    const { error } = failNext;
    failNext = null;
    return Promise.reject(error);
  }
  const result = queue.then(() => db.query(text, values));
  queue = result.catch(() => undefined);
  return result;
}
const pool = { query: run };

/** What the delivery route sent out: fakes for the mailer and Sentry. */
const emails: { bookingId: string; detail: string | null }[] = [];
const messages: { message: string; options: { level: string; tags: Record<string, string> } }[] = [];
let mailFails = false;

/** Work the delivery route left for after the response: run at once, awaited by `settled()`. */
const afterWork: Promise<unknown>[] = [];
const settled = () => Promise.all(afterWork.splice(0));
const realNextServer = await import("next/server");

await mockModules(import.meta.dir, {
  "next/server": () => ({ ...realNextServer, after: (fn: () => Promise<unknown>) => { afterWork.push(Promise.resolve().then(fn)); } }),
  "@openbookings/db": () => ({
    ...realDb,
    getPool: () => pool,
    // A savepoint stands in for BEGIN/COMMIT so the test's own transaction survives.
    withTransaction: async (fn: (tx: typeof pool) => Promise<unknown>) => {
      await run("SAVEPOINT route_tx");
      try {
        const out = await fn(pool);
        await run("RELEASE SAVEPOINT route_tx");
        return out;
      } catch (error) {
        await run("ROLLBACK TO SAVEPOINT route_tx");
        throw error;
      }
    },
  }),
  "@openbookings/mailing/booking-send": () => ({
    sendChannelDeliveryFailed: async (bookingId: string, detail: string | null) => {
      if (mailFails) throw new Error("smtp down");
      emails.push({ bookingId, detail });
    },
  }),
  "@sentry/nextjs": () => ({
    captureMessage: (message: string, options: { level: string; tags: Record<string, string> }) => {
      messages.push({ message, options });
    },
    captureException: () => undefined,
  }),
});

const { connectApp, disconnectApp } = await import("@openbookings/db/apps");
const structure = await import("./structure/route");
const ari = await import("./ari/route");
const changes = await import("./bookings/changes/route");
const delivery = await import("./bookings/[bookingId]/delivery/route");

const BASE = "https://business.localhost:3001/api/apps/v1";
const now = new Date("2031-03-01T12:00:00Z");

describeWithDb("Apps API v1 routes", () => {
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
    failNext = null;
    emails.length = 0;
    messages.length = 0;
    mailFails = false;
  });
  afterEach(async () => {
    await settled();
    await db.query("ROLLBACK");
  });

  async function setup() {
    const ids = await seedProperty(db);
    const connected = await connectApp(db, {
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
    return { ids, ...connected, roomCode: codes.room, planCode: codes.plan };
  }

  const req = (path: string, init: { method?: string; key?: string | null; body?: unknown; raw?: string } = {}) =>
    new Request(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.key === null || init.key === undefined ? {} : { Authorization: `Bearer ${init.key}` }),
        ...(init.body !== undefined || init.raw !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });

  const batch = (over: Record<string, unknown> = {}) => ({ inventory: [], rates: [], restrictions: [], ...over });
  const report = (over: Record<string, unknown> = {}) => ({ status: "retrying", acknowledgedAt: null, detail: null, version: 0, ...over });
  const ctx = (bookingId: string) => ({ params: Promise.resolve({ bookingId }) });

  async function confirmedBooking(ids: Awaited<ReturnType<typeof seedProperty>>, checkIn: string) {
    const { bookingId } = await seedBooking(db, ids, { checkIn, nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed', confirmed_at = $2 WHERE id = $1`, [bookingId, now]);
    await db.query(
      `UPDATE reservations
          SET nights = jsonb_build_array(
                jsonb_build_object('date', $2::text, 'priceCents', 18650, 'touristTaxCents', 300),
                jsonb_build_object('date', ($2::date + 1)::text, 'priceCents', 18651, 'touristTaxCents', 300))
        WHERE booking_id = $1`,
      [bookingId, checkIn],
    );
    return bookingId;
  }

  test("every route refuses a missing, malformed, wrong or disconnected key with 401", async () => {
    const { installation, apiKey } = await setup();
    const wrong = `obk_${"a".repeat(40)}`;
    const someBooking = crypto.randomUUID();
    const calls = (key: string | null) => [
      () => structure.GET(req("/structure", { key })),
      () => ari.POST(req("/ari", { method: "POST", key, body: batch() })),
      () => changes.GET(req("/bookings/changes", { key })),
      () => delivery.PUT(req(`/bookings/${someBooking}/delivery`, { method: "PUT", key, body: report() }), ctx(someBooking)),
    ];
    for (const key of [null, "", "not-a-key", wrong]) {
      for (const call of calls(key)) {
        const res = await call();
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
    }
    // The real key works, until the app is disconnected.
    expect((await structure.GET(req("/structure", { key: apiKey }))).status).toBe(200);
    await disconnectApp(db, { installationId: installation.id, now });
    for (const call of calls(apiKey)) expect((await call()).status).toBe(401);
  });

  test("structure lists the seeded room with its plan codes", async () => {
    const { apiKey, ids, roomCode, planCode } = await setup();
    // Archived or inactive rooms and plans stay out.
    await db.query(
      `INSERT INTO rooms (property_id, name, base_occupancy, max_adults, total_units, is_active) VALUES ($1, 'Hidden', 2, 2, 1, false)`,
      [ids.propertyId],
    );
    const res = await structure.GET(req("/structure", { key: apiKey }));
    expect(res.status).toBe(200);
    const body = AppStructureSchema.parse(await res.json());
    expect(body.propertyName).toBe("Test Property");
    expect(body.timezone).toBe("Europe/Amsterdam");
    expect(body.rooms).toEqual([
      {
        code: roomCode,
        name: "Double",
        baseOccupancy: 2,
        maxAdults: 2,
        maxChildren: 0,
        ratePlans: [
          { code: planCode, name: "Room only", isRefundable: true, includesBreakfast: false, includesLunch: false, includesDinner: false },
        ],
      },
    ]);
  });

  test("ari writes a batch, and refuses another property's codes with 422", async () => {
    const { apiKey, roomCode, planCode } = await setup();
    const other = await seedProperty(db);
    const otherCodes = (
      await db.query(`SELECT r.channel_code AS room FROM rooms r WHERE r.id = $1`, [other.roomId])
    ).rows[0] as { room: string };

    const ok = await ari.POST(
      req("/ari", {
        method: "POST",
        key: apiKey,
        body: batch({
          inventory: [{ roomCode, from: "2031-06-10", to: "2031-06-12", unitsLeft: 2 }],
          rates: [{ ratePlanCode: planCode, from: "2031-06-10", to: "2031-06-12", priceCents: 18650, extraAdultCents: null, extraChildCents: null }],
        }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, nights: 6 });

    const refused = await ari.POST(
      req("/ari", {
        method: "POST",
        key: apiKey,
        body: batch({ inventory: [{ roomCode: otherCodes.room, from: "2031-06-10", to: "2031-06-12", unitsLeft: 2 }] }),
      }),
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ ok: false, error: "unknown codes", unknownCodes: [otherCodes.room] });
  });

  test("ari answers a malformed body with 400 and the first issue", async () => {
    const { apiKey, roomCode } = await setup();
    const bad = await ari.POST(
      req("/ari", { method: "POST", key: apiKey, body: batch({ inventory: [{ roomCode, from: "2031-13-40", to: "2031-06-12", unitsLeft: 2 }] }) }),
    );
    expect(bad.status).toBe(400);
    const { error } = (await bad.json()) as { error: string };
    expect(error).toStartWith("inventory.0.from:");

    const notJson = await ari.POST(req("/ari", { method: "POST", key: apiKey, raw: "{nope" }));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: "invalid JSON" });

    const missing = await ari.POST(req("/ari", { method: "POST", key: apiKey, body: {} }));
    expect(missing.status).toBe(400);
  });

  test("ari refuses a body over the size cap before parsing it", async () => {
    const { apiKey } = await setup();
    // Declared length over the cap: refused without reading.
    const declared = new Request(`${BASE}/ari`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Length": String(11 * 1024 * 1024) },
      body: "{}",
    });
    const res = await ari.POST(declared);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too large" });

    // A real oversized stream (and not even JSON) is cut off the same way.
    const big = await ari.POST(req("/ari", { method: "POST", key: apiKey, raw: "x".repeat(10 * 1024 * 1024 + 1) }));
    expect(big.status).toBe(413);
  });

  test("ari stores received_at as the earlier of the batch's receivedAt and now", async () => {
    const { apiKey, roomCode } = await setup();
    const change = { roomCode, from: "2031-07-01", to: "2031-07-01", unitsLeft: 1 };
    const storedAt = async (date: string) =>
      (
        await db.query(
          `SELECT ai.received_at FROM app_inventory ai JOIN rooms r ON r.id = ai.room_id WHERE r.channel_code = $1 AND ai.date = $2`,
          [roomCode, date],
        )
      ).rows[0] as { received_at: Date };

    const past = "2026-01-01T08:00:00.000Z";
    await ari.POST(req("/ari", { method: "POST", key: apiKey, body: batch({ inventory: [change], receivedAt: past }) }));
    expect((await storedAt("2031-07-01")).received_at.toISOString()).toBe(past);

    // A receivedAt in the future (a fast clock) is capped at the server's now.
    const before = Date.now();
    await ari.POST(
      req("/ari", {
        method: "POST",
        key: apiKey,
        body: batch({ inventory: [{ ...change, from: "2031-07-02", to: "2031-07-02" }], receivedAt: "2099-01-01T00:00:00Z" }),
      }),
    );
    const capped = (await storedAt("2031-07-02")).received_at.getTime();
    expect(capped).toBeGreaterThanOrEqual(before);
    expect(capped).toBeLessThanOrEqual(Date.now());
  });

  test("ari maps a concurrent-insert unique violation to 503 with Retry-After", async () => {
    const { apiKey, planCode } = await setup();
    failNext = { match: "app_restrictions", error: Object.assign(new Error("duplicate key"), { code: "23505" }) };
    const res = await ari.POST(
      req("/ari", {
        method: "POST",
        key: apiKey,
        body: batch({ restrictions: [{ ratePlanCode: planCode, from: "2031-06-10", to: "2031-06-10", closed: true }] }),
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("1");
    expect(await res.json()).toEqual({ error: "conflict, retry" });
  });

  test("changes returns the snapshot, then an empty page with the same cursor", async () => {
    const { apiKey, ids } = await setup();
    const bookingId = await confirmedBooking(ids, "2031-06-10");

    const snapshot = await changes.GET(req("/bookings/changes", { key: apiKey }));
    expect(snapshot.status).toBe(200);
    const page = BookingChangesPageSchema.parse(await snapshot.json());
    expect(page.bookings.map((b) => b.bookingId)).toEqual([bookingId]);
    expect(page.bookings[0]!.rooms[0]!.nights.map((n) => n.priceCents)).toEqual([18650, 18651]);

    const next = await changes.GET(req(`/bookings/changes?cursor=${encodeURIComponent(page.nextCursor)}&limit=500`, { key: apiKey }));
    expect(next.status).toBe(200);
    expect(await next.json()).toEqual({ bookings: [], nextCursor: page.nextCursor, hasMore: false });
  });

  test("changes refuses a bad cursor or limit with 400, and clamps a large limit", async () => {
    const { apiKey } = await setup();
    expect((await changes.GET(req("/bookings/changes?cursor=garbage", { key: apiKey }))).status).toBe(400);
    expect((await changes.GET(req("/bookings/changes?cursor=1:1&limit=0", { key: apiKey }))).status).toBe(400);
    expect((await changes.GET(req("/bookings/changes?cursor=1:1&limit=abc", { key: apiKey }))).status).toBe(400);
    expect((await changes.GET(req("/bookings/changes?cursor=1:1&limit=100000", { key: apiKey }))).status).toBe(200);
  });

  test("delivery: 204 for the property's booking, 404 for another's or an unknown one", async () => {
    const { apiKey, ids } = await setup();
    const mine = await confirmedBooking(ids, "2031-06-10");
    const other = await seedProperty(db);
    const theirs = await confirmedBooking(other, "2031-06-10");
    const put = (bookingId: string, body: unknown) =>
      delivery.PUT(req(`/bookings/${bookingId}/delivery`, { method: "PUT", key: apiKey, body }), ctx(bookingId));

    const ok = await put(mine, report({ status: "needs_attention", detail: "Hotel not found" }));
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    const stored = (await db.query(`SELECT status, detail FROM app_booking_delivery WHERE booking_id = $1`, [mine])).rows[0];
    expect(stored).toEqual({ status: "needs_attention", detail: "Hotel not found" });

    for (const id of [theirs, crypto.randomUUID(), "not-a-uuid"]) {
      const res = await put(id, report());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
    }
    expect((await db.query(`SELECT 1 FROM app_booking_delivery WHERE booking_id = $1`, [theirs])).rows).toHaveLength(0);
  });

  test("delivery: a report on a booking the hotel chose not to send is answered 409 not_sent, and stored nothing", async () => {
    const { apiKey, ids, installation } = await setup();
    const mine = await confirmedBooking(ids, "2031-06-10");
    await db.query(`INSERT INTO app_booking_delivery (installation_id, booking_id, status) VALUES ($1, $2, 'not_sent')`, [installation.id, mine]);
    const res = await delivery.PUT(
      req(`/bookings/${mine}/delivery`, { method: "PUT", key: apiKey, body: report({ status: "delivered", acknowledgedAt: "2031-03-01T11:00:00Z" }) }),
      ctx(mine),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "not_sent" });
    expect((await db.query(`SELECT status FROM app_booking_delivery WHERE booking_id = $1`, [mine])).rows[0]).toEqual({ status: "not_sent" });
  });

  test("delivery refuses an invalid report with 400 and the first issue", async () => {
    const { apiKey, ids } = await setup();
    const mine = await confirmedBooking(ids, "2031-06-10");
    const put = (body: unknown) =>
      delivery.PUT(req(`/bookings/${mine}/delivery`, { method: "PUT", key: apiKey, body }), ctx(mine));
    const noVersion = await put({ status: "delivered", acknowledgedAt: "2031-03-01T11:00:00Z", detail: null });
    expect(noVersion.status).toBe(400);
    expect(((await noVersion.json()) as { error: string }).error).toStartWith("version:");
    expect((await put(report({ acknowledgedAt: "yesterday" }))).status).toBe(400);
    expect((await put(report({ status: "pending" }))).status).toBe(400);
  });

  test("delivery: reporting needs_attention twice emails the hotel and alerts us once; retrying sends nothing", async () => {
    const { apiKey, ids } = await setup();
    const mine = await confirmedBooking(ids, "2031-06-10");
    const put = (body: unknown) =>
      delivery.PUT(req(`/bookings/${mine}/delivery`, { method: "PUT", key: apiKey, body }), ctx(mine));

    expect((await put(report({ status: "retrying" }))).status).toBe(204);
    expect(emails).toHaveLength(0);
    expect(messages).toHaveLength(0);

    expect((await put(report({ status: "needs_attention", detail: "Hotel not found" }))).status).toBe(204);
    expect(emails).toHaveLength(0); // the 204 does not wait for the mail
    await settled();
    expect((await put(report({ status: "needs_attention", detail: "Hotel not found" }))).status).toBe(204);
    await settled();
    expect(emails).toEqual([{ bookingId: mine, detail: "Hotel not found" }]);
    const mailed = (await db.query(`SELECT mailed_at FROM app_booking_delivery WHERE booking_id = $1`, [mine])).rows[0] as { mailed_at: Date | null };
    expect(mailed.mailed_at).not.toBeNull();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.options.level).toBe("warning");
    expect(messages[0]!.options.tags).toEqual({ app: "siteminder", property_id: ids.propertyId });
  });

  test("delivery: a failing mail does not turn the 204 into an error", async () => {
    const { apiKey, ids } = await setup();
    const mine = await confirmedBooking(ids, "2031-06-10");
    mailFails = true;
    const quiet = spyOn(console, "error").mockImplementation(() => undefined);
    const res = await delivery.PUT(
      req(`/bookings/${mine}/delivery`, { method: "PUT", key: apiKey, body: report({ status: "needs_attention" }) }),
      ctx(mine),
    );
    expect(res.status).toBe(204);
    await settled();
    quiet.mockRestore();
    expect(messages).toHaveLength(1);
  });
});

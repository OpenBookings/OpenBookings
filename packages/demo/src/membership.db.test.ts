import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";
import { convertIntentToBooking, createBookingIntent } from "@openbookings/db";
import { applyPendingMigrations, connectionString, describeWithDb, seedGuest, seedProperty } from "@openbookings/db/testing";
import { insertDemoProperty, insertDemoRatePlan, insertDemoRoom } from "./factories";
import { ensureDemoMembership, resetDemoData } from "./membership";
import { DEMO_ORG_ID, ensureDemoOrganisation } from "./organisation";

let db: Client;

describeWithDb("demo membership and reset", () => {
  /** Transactions become savepoints inside the test's own transaction. */
  const lifecycleDb = (): LifecycleDb => {
    const query = (text: string, values?: unknown[]) => db.query(text, values);
    return {
      query,
      transaction: async (fn) => {
        await db.query("SAVEPOINT demo_tx");
        try {
          const out = await fn({ query });
          await db.query("RELEASE SAVEPOINT demo_tx");
          return out;
        } catch (error) {
          await db.query("ROLLBACK TO SAVEPOINT demo_tx");
          throw error;
        }
      },
    };
  };

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

  const host = async () => {
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'Host', $2, true, 'business')`,
      [id, `host-${id}@example.test`],
    );
    return id;
  };

  test("ensureDemoMembership makes the user one owner, however often it runs", async () => {
    const userId = await host();
    await ensureDemoMembership(db, { userId });
    await ensureDemoMembership(db, { userId });
    const { rows } = await db.query(`SELECT role FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [DEMO_ORG_ID, userId]);
    expect(rows).toEqual([{ role: "owner" }]);
  });

  test("resetDemoData removes demo properties and their bookings, and spares the rest", async () => {
    const userId = await host();
    await ensureDemoMembership(db, { userId });
    await ensureDemoOrganisation(db);
    const demo = await insertDemoProperty(db, {
      name: "Demo Hotel",
      slug: `demo-reset-${crypto.randomUUID()}`,
      city: "Lisbon",
      country: "PT",
      timezone: "Europe/Lisbon",
      lat: 38.72,
      lon: -9.14,
      cancellationTier: "flex",
      organizationId: DEMO_ORG_ID,
      images: { hero: "https://example.test/h.jpg", gallery: [] },
    });
    const { roomId } = await insertDemoRoom(db, {
      propertyId: demo.propertyId,
      name: "Double",
      roomType: "double",
      bedType: "double",
      sizeSqm: 20,
      maxAdults: 2,
      maxChildren: 0,
      baseOccupancy: 2,
      totalUnits: 2,
      imageUrl: "https://example.test/r.jpg",
    });
    const { ratePlanId } = await insertDemoRatePlan(db, { roomId, name: "Room only", bar: 100, isRefundable: true, minStay: 1, mealPlan: "room_only" });
    const guest = await seedGuest(db);
    const intent = await createBookingIntent(lifecycleDb(), {
      userId: guest,
      propertyId: demo.propertyId,
      checkIn: "2031-11-10",
      checkOut: "2031-11-11",
      rooms: [{ roomId, ratePlanId, adults: 2, children: 0, nights: [{ date: "2031-11-10", price: 100 }], stayTotal: 100, touristTax: 0, touristTaxLines: [] }],
      snapshot: {
        roomsTotal: 100,
        touristTaxTotal: 0,
        total: 100,
        commissionCents: 0,
        currency: "EUR",
        rooms: [{ roomId, ratePlanId, roomName: "Double", ratePlanName: "Room only", isRefundable: true, freeCancellationUntil: null }],
      },
      now: new Date("2031-10-01T10:00:00Z"),
    });
    if (!intent.ok) throw new Error("expected an intent");
    const converted = await convertIntentToBooking(lifecycleDb(), {
      intentId: intent.intentId,
      paymentIntentId: "pi_demo_reset",
      accountId: "acct_host",
      amountCents: 10000,
      now: new Date("2031-10-01T10:00:00Z"),
    });
    expect(converted.outcome).toBe("confirmed");
    const other = await seedProperty(db);

    const counts = await resetDemoData(lifecycleDb());

    expect(counts.properties).toBeGreaterThan(0);
    expect(counts.bookings).toBeGreaterThan(0);
    expect(counts.intents).toBeGreaterThan(0);
    expect((await db.query(`SELECT 1 FROM properties WHERE is_demo`)).rowCount).toBe(0);
    expect((await db.query(`SELECT 1 FROM properties WHERE id = $1`, [other.propertyId])).rowCount).toBe(1);
    expect((await db.query(`SELECT 1 FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [DEMO_ORG_ID, userId])).rowCount).toBe(1);
  });
});

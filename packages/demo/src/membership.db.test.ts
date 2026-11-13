import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";
import { attachPaymentSession, convertIntentToBooking, createBookingIntent } from "@openbookings/db";
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
      rooms: [{ roomId, ratePlanId, adults: 2, children: 0, infants: 0, cots: 0, extraBeds: 0, payAtProperty: 0, discount: null, rateNights: [{ date: "2031-11-10", price: 100 }], extraGuests: [], payAtPropertyLines: [], nights: [{ date: "2031-11-10", price: 100 }], stayTotal: 100, touristTax: 0, touristTaxLines: [], vatSplit: null }],
      snapshot: {
        roomsTotal: 100,
        touristTaxTotal: 0,
        total: 100,
        commissionCents: 0,
        commissionRate: 0.1,
        commissionVatTreatment: null,
        commissionNetCents: null,
        commissionVatCents: null,
        currency: "EUR",
        rooms: [{ roomId, ratePlanId, roomName: "Double", ratePlanName: "Room only", isRefundable: true, freeCancellationUntil: null }],
      },
      now: new Date("2031-10-01T10:00:00Z"),
    });
    if (!intent.ok) throw new Error("expected an intent");
    await attachPaymentSession(db, { intentId: intent.intentId, sessionId: "cs_demo_reset", accountId: "acct_host", amountCents: 10000 });
    const converted = await convertIntentToBooking(lifecycleDb(), {
      intentId: intent.intentId,
      sessionId: "cs_demo_reset",
      paymentIntentId: "pi_demo_reset",
      accountId: "acct_host",
      amountCents: 10000,
      now: new Date("2031-10-01T10:00:00Z"),
    });
    if (converted.outcome !== "confirmed") throw new Error(`expected a confirmed booking, got ${converted.outcome}`);
    const other = await seedProperty(db);
    // A demo property with a fee in the append-only ledger must survive the reset.
    const billed = await insertDemoProperty(db, {
      name: "Billed Demo Hotel",
      slug: `demo-billed-${crypto.randomUUID()}`,
      city: "Lisbon",
      country: "PT",
      timezone: "Europe/Lisbon",
      lat: 38.72,
      lon: -9.14,
      cancellationTier: "flex",
      organizationId: DEMO_ORG_ID,
      images: { hero: "https://example.test/h.jpg", gallery: [] },
    });
    await db.query(
      `INSERT INTO commission_entries
         (kind, billing_entity_id, property_id, stripe_account_id, stripe_application_fee_id,
          base_amount, commission_net, vat_rate_bp, vat_amount, gross_amount, vat_treatment, occurred_at, disposition)
       VALUES ('fee', $1, $2, 'acct_demo', $3, 0, 0, 0, 0, 0, 'EU_REVERSE_CHARGE', now(), 'returned')`,
      [DEMO_ORG_ID, billed.propertyId, `fee_demo_${crypto.randomUUID()}`],
    );

    const counts = await resetDemoData(lifecycleDb());

    expect(counts.properties).toBeGreaterThan(0);
    expect(counts.bookings).toBeGreaterThan(0);
    expect(counts.intents).toBeGreaterThan(0);
    expect(counts.kept).toBeGreaterThan(0);
    expect((await db.query(`SELECT 1 FROM properties WHERE id = $1`, [demo.propertyId])).rowCount).toBe(0);
    expect((await db.query(`SELECT 1 FROM bookings WHERE id = $1`, [converted.bookingId])).rowCount).toBe(0);
    expect((await db.query(`SELECT 1 FROM properties WHERE id = $1`, [billed.propertyId])).rowCount).toBe(1);
    // Every demo property left is one the ledger points at.
    const { rows: leftover } = await db.query(
      `SELECT p.id FROM properties p WHERE p.is_demo AND NOT EXISTS (
         SELECT 1 FROM commission_entries ce
          WHERE ce.property_id = p.id
             OR ce.booking_id IN (SELECT id FROM bookings WHERE hotel_id = p.id)
             OR ce.booking_intent_id IN (SELECT id FROM booking_intents WHERE property_id = p.id))`,
    );
    expect(leftover).toEqual([]);
    expect((await db.query(`SELECT 1 FROM properties WHERE id = $1`, [other.propertyId])).rowCount).toBe(1);
    expect((await db.query(`SELECT 1 FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [DEMO_ORG_ID, userId])).rowCount).toBe(1);
  });
});

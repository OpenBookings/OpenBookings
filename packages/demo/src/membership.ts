/**
 * Testing mode gives every host the demo organisation, so the tester sees the
 * generated hotels and the bookings made at them in the host dashboard. Guests
 * never get here: a private account cannot sign in to the business app.
 */

import type { Queryable } from "@openbookings/db";
import type { LifecycleDb } from "@openbookings/db/booking-lifecycle";
import { DEMO_ORG_ID, ensureDemoOrganisation } from "./organisation";

/** Makes the user an owner of the demo organisation, creating it first if needed. Idempotent. */
export async function ensureDemoMembership(db: Queryable, i: { userId: string }): Promise<void> {
  await ensureDemoOrganisation(db);
  // The same user must not get two rows when two requests race.
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`demo:membership:${i.userId}`]);
  await db.query(
    `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
     SELECT gen_random_uuid()::text, $1, $2, 'owner', NOW()
     WHERE NOT EXISTS (SELECT 1 FROM "member" WHERE "organizationId" = $1 AND "userId" = $2)`,
    [DEMO_ORG_ID, i.userId],
  );
}

/** Runs a DELETE and returns how many rows it removed (Queryable has no rowCount). */
async function deleted(db: Queryable, deleteSql: string): Promise<number> {
  const { rows } = await db.query(`WITH d AS (${deleteSql} RETURNING 1) SELECT count(*)::int AS n FROM d`);
  return (rows[0] as { n: number }).n;
}

/**
 * Deletes every demo property and what hangs off it, in one transaction. The
 * demo organisation and its members stay. Rows that point at bookings without
 * cascading (refunds, transactions) go first; rooms, rate plans, inventory,
 * restrictions, images, tax rules, access rows and message threads go with
 * the properties through their cascades. Audit rows are not touched; they keep any booking ids in their jsonb detail.
 */
export async function resetDemoData(db: LifecycleDb): Promise<{ properties: number; bookings: number; intents: number }> {
  return db.transaction(async (tx) => {
    const demo = `SELECT id FROM properties WHERE is_demo`;
    const demoBookings = `SELECT id FROM bookings WHERE hotel_id IN (${demo})`;

    // Intents first: they point at properties and bookings; their rooms cascade.
    const intents = await deleted(tx, `DELETE FROM booking_intents WHERE property_id IN (${demo})`);
    await tx.query(`DELETE FROM refunds WHERE booking_id IN (${demoBookings})`);
    await tx.query(`DELETE FROM transactions WHERE booking_id IN (${demoBookings})`);
    await tx.query(`DELETE FROM booking_events WHERE booking_id IN (${demoBookings})`);
    await tx.query(`DELETE FROM message_threads WHERE booking_id IN (${demoBookings})`);
    await tx.query(`DELETE FROM reservations WHERE booking_id IN (${demoBookings})`);
    const bookings = await deleted(tx, `DELETE FROM bookings WHERE hotel_id IN (${demo})`);
    const properties = await deleted(tx, `DELETE FROM properties WHERE is_demo`);

    return { properties, bookings, intents };
  });
}

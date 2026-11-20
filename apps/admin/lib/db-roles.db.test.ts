/**
 * The console's loaders and actions, run as the roles they get in production
 * (packages/db/drizzle/0054_admin_roles.sql): every loader as ob_admin_read,
 * every action as ob_admin_write. A query that needs a grant 0054 does not
 * give fails here with "permission denied".
 *
 * Each test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { confirmBookingPolicy } from "@openbookings/db";
import {
  cancelRooms,
  issueGoodwillRefund,
  loadBookingState,
  markCheckedIn,
  markNoShow,
  previewRefund,
  recordEarlyDeparture,
  retryRefunds,
  type LifecycleDb,
  type LifecycleDeps,
} from "@openbookings/db/booking-lifecycle";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  pendingMigrationSql,
  seedBooking,
  seedProperty,
} from "@openbookings/db/testing";
import { sendBookingCancelled, sendRefundIssued, type SendDeps } from "@openbookings/mailing/booking-send";
import { actorFor } from "./actor";
import { loadAdminBooking } from "./booking";
import { loadFlaggedPayments, resolvePaymentFlag } from "./flagged-payments";
import {
  forceCancelRooms,
  forceClearMarkers,
  forceDeleteRefund,
  forceRefundStatus,
  forceStatus,
  forceUncancelRooms,
} from "./forced-edits";
import { searchBookings } from "./search";

const DAY = 86_400_000;
const CHECK_IN = "2031-11-10";
const CHECK_IN_AT = Date.parse("2031-11-10T14:00:00Z");
const TEN_DAYS_BEFORE = new Date(CHECK_IN_AT - 10 * DAY);

describeWithDb("admin console as its own database roles", () => {
  let db: Client;
  let bookingId: string;
  let reservationIds: string[];
  let flagId: string;
  let ownerId: string;
  let pi: string;

  const lifecycleDb = (): LifecycleDb => ({
    query: (text, values) => db.query(text, values as unknown[]),
    transaction: async (fn) => {
      await db.query("SAVEPOINT lifecycle");
      try {
        const out = await fn({ query: (text, values) => db.query(text, values as unknown[]) });
        await db.query("RELEASE SAVEPOINT lifecycle");
        return out;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT lifecycle");
        throw error;
      }
    },
  });
  const deps = (now = TEN_DAYS_BEFORE): LifecycleDeps => ({
    refund: async () => ({ id: `re_${crypto.randomUUID()}`, status: "succeeded" }),
    now: () => now,
    db: lifecycleDb(),
  });

  /** Run `fn` as `role`, then return to the owner. */
  async function as<T>(role: "ob_admin_read" | "ob_admin_write", fn: () => Promise<T>): Promise<T> {
    await db.query(`SET LOCAL ROLE ${role}`);
    const result = await fn();
    // Not in a finally: after a failed statement the transaction is aborted
    // and RESET would hide the error. ROLLBACK resets the role anyway.
    await db.query("RESET ROLE");
    return result;
  }

  /** Whether `fn` as `role` fails on a missing grant. Rolled back either way. */
  async function denied(role: "ob_admin_read" | "ob_admin_write", fn: () => Promise<unknown>): Promise<boolean> {
    await db.query("SAVEPOINT denied");
    await db.query(`SET LOCAL ROLE ${role}`);
    try {
      await fn();
      return false;
    } catch (error) {
      return /permission denied/.test((error as Error).message);
    } finally {
      // Also undoes the SET LOCAL ROLE.
      await db.query("ROLLBACK TO SAVEPOINT denied");
    }
  }

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
    // Again, even where CI applied it up front: a database rebuilt from a
    // schema dump has the roles without BYPASSRLS. Rolled back with the rest.
    await db.query(pendingMigrationSql("0054_admin_roles.sql"));

    const suffix = crypto.randomUUID().slice(0, 8);
    const orgId = `test-org-${suffix}`;
    const account = `acct_${suffix}`;
    pi = `pi_${suffix}`;
    ownerId = `test-owner-${suffix}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Hotel Roles', $1, NOW())`, [orgId]);
    await db.query(`INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id) VALUES ($1, 'Hotel Roles BV', $2)`, [
      orgId,
      account,
    ]);
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'Owner', $2, true, 'business'::account_type)`,
      [ownerId, `${ownerId}@example.test`],
    );
    await db.query(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, 'owner', NOW())`,
      [orgId, ownerId],
    );

    const ids = await seedProperty(db, { tier: "flex" });
    await db.query(`UPDATE properties SET organization_id = $2, owner_user_id = $3, stripe_account_id = $4 WHERE id = $1`, [
      ids.propertyId,
      orgId,
      ownerId,
      account,
    ]);
    ({ bookingId, reservationIds } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 3, rooms: 2 }));
    await db.query(`UPDATE bookings SET stripe_payment_intent_id = $2 WHERE id = $1`, [bookingId, pi]);
    await confirmBookingPolicy(db, { bookingId, confirmedAt: new Date(CHECK_IN_AT - 40 * DAY) });
    flagId = (
      await db.query(
        `INSERT INTO audit_log (action, organization_id, detail)
         VALUES ('payment.dispute-lost', $1, $2::jsonb) RETURNING id`,
        [orgId, JSON.stringify({ disputeId: `dp_${suffix}`, paymentIntentId: pi, amount: 100, dedupeKey: `dp_${suffix}` })],
      )
    ).rows[0].id as string;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("every loader reads what it needs as ob_admin_read, across hosts", async () => {
    await as("ob_admin_read", async () => {
      expect((await searchBookings(db, { q: bookingId })).map((r) => r.id)).toEqual([bookingId]);
      expect((await searchBookings(db, { q: "Test Guest" })).length).toBeGreaterThan(0);
      await db.query("SELECT id, name FROM properties ORDER BY name LIMIT 1");

      const booking = await loadAdminBooking(db, bookingId);
      expect(booking?.booking.id).toBe(bookingId);
      expect(booking?.guest?.email).toMatch(/@example\.test$/);
      expect(booking?.rooms).toHaveLength(2);

      expect((await loadFlaggedPayments(db)).find((f) => f.id === flagId)?.ownerEmails).toEqual([`${ownerId}@example.test`]);

      // The booking page's "what may happen" and the refund preview.
      expect(await actorFor(db, bookingId, "host")).toEqual({ kind: "host", userId: ownerId, via: "admin" });
      expect((await loadBookingState(db, bookingId, TEN_DAYS_BEFORE, false, "guest"))?.actions).toContain("cancel");
      expect((await previewRefund({ bookingId, reservationIds: null }, { db: lifecycleDb(), now: () => TEN_DAYS_BEFORE }))?.total).toBeGreaterThan(0);

      // The invoices page.
      await db.query(`SELECT step, status, report, started_at, finished_at FROM invoice_runs LIMIT 1`);
      await db.query(`SELECT number, period_start, status, doc_type, gross_total, billing_entity_id FROM invoices LIMIT 1`);
    });
  });

  test("ob_admin_read cannot change anything", async () => {
    expect(await denied("ob_admin_read", () => forceStatus(db, { bookingId, status: "cancelled" }))).toBe(true);
    expect(await denied("ob_admin_read", () => resolvePaymentFlag(db, { flagId }))).toBe(true);
    const guest = (await actorFor(db, bookingId, "guest"))!;
    expect(await denied("ob_admin_read", () => cancelRooms(deps(), { bookingId, actor: guest, reservationIds: null }))).toBe(true);
  });

  test("the lifecycle actions and their emails run as ob_admin_write", async () => {
    const problems: unknown[] = [];
    const sent: string[] = [];
    const mail: SendDeps = {
      db,
      transport: async (m) => {
        sent.push(m.subject);
      },
      testing: false,
      urls: { webUrl: "https://web.test", businessUrl: "https://biz.test" },
      track: async (m) => ({ html: m.html, onSent: async () => {} }),
    };
    const report = (error: unknown) => problems.push(error);
    const guest = (await actorFor(db, bookingId, "guest"))!;
    const host = (await actorFor(db, bookingId, "host"))!;

    await as("ob_admin_write", async () => {
      const cancelled = await cancelRooms(deps(), { bookingId, actor: guest, reservationIds: [reservationIds[0]!] });
      expect(cancelled.ok).toBe(true);
      if (cancelled.ok && cancelled.cancelled) await sendBookingCancelled(bookingId, cancelled.cancelled, report, mail);

      const goodwill = await issueGoodwillRefund(deps(), { bookingId, actor: host, amount: 10 });
      expect(goodwill.ok).toBe(true);
      if (goodwill.ok) await sendRefundIssued(bookingId, { reason: "goodwill", refunds: goodwill.refunds }, report, mail);

      // A refund Stripe refused, then retried.
      const failing = { ...deps(), refund: async () => Promise.reject(new Error("card_declined")) };
      expect((await issueGoodwillRefund(failing, { bookingId, actor: host, amount: 5 })).ok).toBe(true);
      expect((await retryRefunds({ ...deps(), findRefund: async () => null }, { bookingId, via: "admin" })).ok).toBe(true);

      const during = new Date(CHECK_IN_AT + 3_600_000);
      expect(await markCheckedIn(deps(during), { bookingId, actor: host })).toEqual({ ok: true, refunds: [] });
      expect((await recordEarlyDeparture(deps(during), { bookingId, actor: host, lastNightStayed: CHECK_IN })).ok).toBe(true);
    });
    expect(problems).toEqual([]);
    expect(sent.length).toBeGreaterThan(0);
  });

  test("a no-show runs as ob_admin_write", async () => {
    const host = (await actorFor(db, bookingId, "host"))!;
    await as("ob_admin_write", async () => {
      const afterWindow = new Date(CHECK_IN_AT + 12 * 3_600_000);
      expect(await markNoShow(deps(afterWindow), { bookingId, actor: host })).toEqual({ ok: true, refunds: [] });
    });
  });

  test("the forced edits run as ob_admin_write", async () => {
    const refundId = (
      await db.query(
        `INSERT INTO refunds (booking_id, reason, accommodation_amount, tourist_tax_amount, amount, idempotency_key)
         VALUES ($1, 'goodwill', 10, 0, 10, 'test:'||gen_random_uuid()) RETURNING id`,
        [bookingId],
      )
    ).rows[0].id as string;
    await as("ob_admin_write", async () => {
      const ok = { ok: true } as const;
      expect(await forceStatus(db, { bookingId, status: "checked_in" })).toEqual(ok);
      expect(await forceCancelRooms(db, { bookingId, reservationIds })).toEqual(ok);
      expect(await forceUncancelRooms(db, { bookingId, reservationIds })).toEqual(ok);
      expect(await forceClearMarkers(db, { bookingId, noShow: true, earlyDeparture: true })).toEqual(ok);
      expect(await forceRefundStatus(db, { bookingId, refundId, status: "failed" })).toEqual(ok);
      expect(await forceDeleteRefund(db, { bookingId, refundId })).toEqual(ok);
    });
  });

  test("resolving a flagged payment runs as ob_admin_write", async () => {
    await as("ob_admin_write", async () => {
      expect(await resolvePaymentFlag(db, { flagId, note: "explained" })).toEqual({ ok: true });
    });
  });

  test("resolving with the host's split writes it onto the booking as ob_admin_write", async () => {
    // As the webhook records a lost dispute (0053): the whole €1 counted as room price.
    const dedupeKey = (await db.query(`SELECT detail->>'dedupeKey' AS k FROM audit_log WHERE id = $1`, [flagId])).rows[0].k as string;
    const refundId = (
      await db.query(
        `INSERT INTO refunds (booking_id, reason, source, accommodation_amount, tourist_tax_amount, amount, status, idempotency_key)
         VALUES ($1, NULL, 'dispute', 1, 0, 1, 'succeeded', 'dispute:' || $2) RETURNING id`,
        [bookingId, dedupeKey],
      )
    ).rows[0].id as string;
    await as("ob_admin_write", async () => {
      expect(await resolvePaymentFlag(db, { flagId, split: { roomPriceCents: 60, touristTaxCents: 40 } })).toEqual({ ok: true });
    });
    const row = (
      await db.query(
        `SELECT accommodation_amount::float8 AS room, tourist_tax_amount::float8 AS tax, split_explained_at IS NOT NULL AS explained
           FROM refunds WHERE id = $1`,
        [refundId],
      )
    ).rows[0];
    expect(row).toEqual({ room: 0.6, tax: 0.4, explained: true });
  });

  test("ob_admin_write cannot touch what no action changes", async () => {
    expect(await denied("ob_admin_write", () => db.query(`UPDATE bookings SET total_amount = 1 WHERE id = $1`, [bookingId]))).toBe(true);
    expect(await denied("ob_admin_write", () => db.query(`SELECT 1 FROM messages LIMIT 1`))).toBe(true);
  });
});

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
import { keepItem, loadModerationCounts, loadModerationQueue, removeItem, type DecisionDeps, type QueueRow } from "./moderation";
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
  let ids: Awaited<ReturnType<typeof seedProperty>>;

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
    // 0058 renamed the refund columns 0054 grants on; replay its grants on the new names.
    await db.query(
      pendingMigrationSql("0054_admin_roles.sql").replace(
        "accommodation_amount, tourist_tax_amount",
        "accommodation_cents, tourist_tax_cents",
      ),
    );

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

    ids = await seedProperty(db, { tier: "flex" });
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
      expect((await previewRefund({ bookingId, reservationIds: null }, { db: lifecycleDb(), now: () => TEN_DAYS_BEFORE }))?.totalCents).toBeGreaterThan(0);

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

      const goodwill = await issueGoodwillRefund(deps(), { bookingId, actor: host, amountCents: 1_000 });
      expect(goodwill.ok).toBe(true);
      if (goodwill.ok) await sendRefundIssued(bookingId, { reason: "goodwill", refunds: goodwill.refunds }, report, mail);

      // A refund Stripe refused, then retried.
      const failing = { ...deps(), refund: async () => Promise.reject(new Error("card_declined")) };
      expect((await issueGoodwillRefund(failing, { bookingId, actor: host, amountCents: 500 })).ok).toBe(true);
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
        `INSERT INTO refunds (booking_id, reason, accommodation_cents, tourist_tax_cents, amount_cents, idempotency_key)
         VALUES ($1, 'goodwill', 1000, 0, 1000, 'test:'||gen_random_uuid()) RETURNING id`,
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
        `INSERT INTO refunds (booking_id, reason, source, accommodation_cents, tourist_tax_cents, amount_cents, status, idempotency_key)
         VALUES ($1, NULL, 'dispute', 100, 0, 100, 'succeeded', 'dispute:' || $2) RETURNING id`,
        [bookingId, dedupeKey],
      )
    ).rows[0].id as string;
    await as("ob_admin_write", async () => {
      expect(await resolvePaymentFlag(db, { flagId, split: { roomPriceCents: 60, touristTaxCents: 40 } })).toEqual({ ok: true });
    });
    const row = (
      await db.query(
        `SELECT accommodation_cents::int AS room, tourist_tax_cents::int AS tax, split_explained_at IS NOT NULL AS explained
           FROM refunds WHERE id = $1`,
        [refundId],
      )
    ).rows[0];
    expect(row).toEqual({ room: 60, tax: 40, explained: true });
  });

  // ── Review moderation (0061) ──────────────────────────────────────────────

  const HOUR = 3_600_000;
  /** When the reviews below are written: two days after check-out. */
  const WRITTEN = new Date(Date.parse("2031-11-13T12:00:00Z") + 2 * DAY);
  const later = (ms: number) => new Date(WRITTEN.getTime() + ms);

  /** A review of its own booking (one review per booking), written `writtenAt`. */
  async function seedReview(i: {
    status: "pending" | "published";
    body: string;
    rules?: string | null;
    fragments?: string[];
    source?: "regex" | "mistral" | "unchecked";
    writtenAt?: Date;
  }): Promise<{ id: string; bookingId: string; guestEmail: string }> {
    const seeded = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 3 });
    const guest = (await db.query(`SELECT b.user_id, u.email FROM bookings b JOIN "user" u ON u.id = b.user_id WHERE b.id = $1`, [seeded.bookingId])).rows[0];
    const at = i.writtenAt ?? WRITTEN;
    const id = (
      await db.query(
        `INSERT INTO reviews (booking_id, property_id, guest_user_id, score, body, author_name, author_country, stay_month, status,
                              flagged_reason, flagged_fragments, check_source, checked_at, submitted_via, published_at, created_at, updated_at)
         VALUES ($1, $2, $3, 4, $4, 'Anna', 'NL', '2031-11-01', $5, $6, $7::jsonb, $8, $9, 'session', $10, $9, $9) RETURNING id`,
        [
          seeded.bookingId,
          ids.propertyId,
          guest.user_id,
          i.body,
          i.status,
          i.rules ?? null,
          JSON.stringify(i.fragments ?? []),
          i.source ?? "mistral",
          at,
          i.status === "published" ? at : null,
        ],
      )
    ).rows[0].id as string;
    return { id, bookingId: seeded.bookingId, guestEmail: guest.email as string };
  }
  const sent: Array<{ to: string; subject: string }> = [];
  const purged: string[] = [];
  const problems: unknown[] = [];
  const decisionDeps = (now: Date): DecisionDeps => ({
    transaction: async (fn) => {
      await db.query("SAVEPOINT decide");
      try {
        const out = await fn(db);
        await db.query("RELEASE SAVEPOINT decide");
        return out;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT decide");
        throw error;
      }
    },
    mail: {
      db,
      transport: async (m) => {
        sent.push({ to: m.to, subject: m.subject });
      },
      testing: false,
      urls: { webUrl: "https://web.test", businessUrl: "https://biz.test" },
    },
    purgeReviews: async (propertyId) => {
      purged.push(propertyId);
    },
    report: (error) => problems.push(error),
    now,
  });
  const reset = () => {
    sent.length = 0;
    purged.length = 0;
    problems.length = 0;
  };

  /** The queue as a moderator sees it: held, reported, published by the deadline, decided. */
  async function seedQueue() {
    const held = await seedReview({ status: "pending", body: "Jan Jansen at the desk was rude.", rules: "personal_details", fragments: ["Jan Jansen"] });
    const reply = (
      await db.query(
        `INSERT INTO review_replies (review_id, author_role, author_user_id, body, status, flagged_reason, flagged_fragments,
                                     check_source, created_at, updated_at)
         VALUES ($1, 'host', $2, 'Call us on +31 6 12345678.', 'pending', 'links_contact', '["+31 6 12345678"]', 'regex', $3, $3)
         RETURNING id`,
        [held.id, ownerId, later(HOUR)],
      )
    ).rows[0].id as string;
    const reported = await seedReview({ status: "published", body: "The manager is a crook.", source: "regex", writtenAt: later(-DAY) });
    const publicReport = (
      await db.query(
        `INSERT INTO review_reports (review_id, reporter_kind, reporter_email, rule, created_at)
         VALUES ($1, 'public', 'reporter@example.test', 'abuse', $2) RETURNING id`,
        [reported.id, later(2 * HOUR)],
      )
    ).rows[0].id as string;
    const masked = await seedReview({ status: "pending", body: "Ask for Jan Jansen.", rules: "personal_details", fragments: ["Jan Jansen"], writtenAt: later(-4 * DAY) });
    await db.query(
      `UPDATE reviews SET status = 'published', published_at = $2, published_by_deadline = true, masked_body = 'Ask for [removed].' WHERE id = $1`,
      [masked.id, later(-DAY)],
    );
    await db.query(
      `INSERT INTO review_reports (review_id, reporter_kind, reporter_user_id, reporter_org_id, rule, note, created_at)
       VALUES ($1, 'host', $2, 'org-roles', 'personal_details', 'Names our staff', $3)`,
      [masked.id, ownerId, later(HOUR)],
    );
    const decided = await seedReview({ status: "published", body: "Lovely.", source: "regex", writtenAt: later(-2 * DAY) });
    await db.query(
      `UPDATE reviews SET decision = 'kept', decision_rules = '{}', decided_by = $2, decided_at = $3 WHERE id = $1`,
      [decided.id, ownerId, later(-HOUR)],
    );
    return { held, reply, reported, publicReport, masked, decided };
  }

  /** One item of a loaded tab, by id: the tab's order isn't what a test is about. */
  const byId = (rows: QueueRow[], id: string): QueueRow => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`item ${id} isn't in the tab`);
    return row;
  };
  /** What a moderator's decision sends: the item, the version they saw, and who they are. */
  const item = (row: QueueRow) => ({ item: { kind: row.kind, id: row.id }, version: row.version, decidedBy: ownerId });

  test("loadModerationQueue runs as ob_admin_read", async () => {
    const q = await seedQueue();
    await as("ob_admin_read", async () => {
      const held = await loadModerationQueue(db, "held", later(2 * HOUR));
      expect(held.map((r) => [r.kind, r.id])).toEqual([
        ["review", q.held.id],
        ["reply", q.reply],
      ]);
      expect(held[0]).toMatchObject({
        propertyName: expect.any(String),
        authorName: "Anna",
        authorCountry: "NL",
        stayMonth: "2031-11-01",
        score: 4,
        body: "Jan Jansen at the desk was rude.",
        fragments: ["Jan Jansen"],
        rules: ["personal_details"],
        checkSource: "mistral",
        status: "pending",
        writtenAt: WRITTEN,
        deadline: later(72 * HOUR),
        authorReachable: true,
        reports: [],
        decision: null,
      });
      expect(held[0]!.version).toMatch(/^\d+$/);
      expect(held[0]!.bookingId).toBe(q.held.bookingId);
      expect(held[1]).toMatchObject({ replyAuthor: "host", score: null, rules: ["links_contact"], checkSource: "regex", reviewStatus: "pending" });

      const reported = await loadModerationQueue(db, "reported", later(2 * HOUR));
      expect(reported.map((r) => r.id)).toEqual([q.masked.id, q.reported.id]);
      expect(reported[1]!.reports).toEqual([
        { id: q.publicReport, reporterKind: "public", rule: "abuse", note: null, emailLeft: true, status: "open", createdAt: later(2 * HOUR) },
      ]);

      const deadline = await loadModerationQueue(db, "deadline", later(2 * HOUR));
      expect(deadline.map((r) => r.id)).toEqual([q.masked.id]);
      expect(deadline[0]).toMatchObject({ maskedBody: "Ask for [removed].", publishedByDeadline: true });

      const decided = await loadModerationQueue(db, "decided", later(2 * HOUR));
      expect(decided.map((r) => r.id)).toEqual([q.decided.id]);
      expect(decided[0]!.decision).toEqual({
        decision: "kept",
        rules: [],
        note: null,
        decidedAt: later(-HOUR),
        decidedBy: `${ownerId}@example.test`,
      });

      expect(await loadModerationCounts(db)).toEqual({ held: 2, reported: 2, deadline: 1 });
    });
  });

  test("keepItem and removeItem run as ob_admin_write", async () => {
    const q = await seedQueue();
    reset();
    const reportedTab = await loadModerationQueue(db, "reported", later(2 * HOUR));
    const heldTab = await loadModerationQueue(db, "held", later(2 * HOUR));
    const reported = byId(reportedTab, q.reported.id);
    const masked = byId(reportedTab, q.masked.id);
    const held = byId(heldTab, q.held.id);
    const reply = byId(heldTab, q.reply);

    await as("ob_admin_write", async () => {
      // Remove a reported review: its author is told, and the public reporter.
      expect(
        await removeItem(decisionDeps(later(3 * HOUR)), { ...item(reported), rules: ["abuse"], note: "Not about the stay." }),
      ).toEqual({ ok: true });
      // Keep a deadline-masked review a host reported: only the host hears.
      expect(await keepItem(decisionDeps(later(3 * HOUR)), item(masked))).toEqual({ ok: true });
      // Keep a held review: nobody to tell.
      expect(await keepItem(decisionDeps(later(3 * HOUR)), item(held))).toEqual({ ok: true });
      // Decided already.
      expect(await keepItem(decisionDeps(later(3 * HOUR)), item(held))).toEqual({ ok: false, error: "Already decided" });
    });
    expect(problems).toEqual([]);
    expect(sent).toEqual([
      { to: q.reported.guestEmail, subject: expect.stringMatching(/was removed$/) },
      { to: "reporter@example.test", subject: expect.stringMatching(/^Your report about/) },
      { to: `${ownerId}@example.test`, subject: expect.stringMatching(/^Your report about/) },
    ]);
    const propertyId = (await db.query(`SELECT property_id FROM reviews WHERE id = $1`, [q.held.id])).rows[0].property_id;
    expect(purged).toEqual([propertyId, propertyId, propertyId]);
    const rows = (
      await db.query(`SELECT id, status, decision, decision_rules, decision_note, masked_body FROM reviews WHERE id = ANY($1::uuid[])`, [
        [q.reported.id, q.masked.id, q.held.id],
      ])
    ).rows;
    expect(rows.find((r) => r.id === q.reported.id)).toMatchObject({
      status: "removed",
      decision: "removed",
      decision_rules: ["abuse"],
      decision_note: "Not about the stay.",
    });
    expect(rows.find((r) => r.id === q.masked.id)).toMatchObject({ status: "published", decision: "kept", masked_body: null });
    expect(rows.find((r) => r.id === q.held.id)).toMatchObject({ status: "published", decision: "kept" });

    // The host edits the reply after the moderator loaded it: that version can't be decided.
    reset();
    await db.query(`UPDATE review_replies SET body = 'Call us.', edited_at = $2 WHERE id = $1`, [q.reply, later(2 * HOUR)]);
    await as("ob_admin_write", async () => {
      expect(await removeItem(decisionDeps(later(3 * HOUR)), { ...item(reply), rules: ["links_contact"], note: null })).toEqual({
        ok: false,
        error: "This item changed since you opened it. Reload.",
      });
    });
    expect(sent).toEqual([]);
  });

  test("a failing email or cache purge still leaves the decision made", async () => {
    const q = await seedQueue();
    reset();
    const reported = byId(await loadModerationQueue(db, "reported", later(2 * HOUR)), q.reported.id);
    const failing: DecisionDeps = {
      ...decisionDeps(later(3 * HOUR)),
      mail: { ...decisionDeps(later(3 * HOUR)).mail, transport: async () => Promise.reject(new Error("smtp down")) },
      purgeReviews: async () => Promise.reject(new Error("upstash down")),
    };
    await as("ob_admin_write", async () => {
      expect(await removeItem(failing, { ...item(reported), rules: ["abuse"], note: null })).toEqual({ ok: true });
    });
    expect((await db.query(`SELECT status, decision FROM reviews WHERE id = $1`, [q.reported.id])).rows[0]).toEqual({
      status: "removed",
      decision: "removed",
    });
    expect((await db.query(`SELECT status FROM review_reports WHERE id = $1`, [q.publicReport])).rows[0]).toEqual({ status: "upheld" });
    // Each failure was reported, none of them thrown.
    expect(problems.map((p) => (p as Error).message)).toEqual(expect.arrayContaining(["upstash down", "smtp down"]));
  });

  test("removeItem without a rule is refused", async () => {
    const q = await seedQueue();
    reset();
    const held = byId(await loadModerationQueue(db, "held", later(2 * HOUR)), q.held.id);
    await as("ob_admin_write", async () => {
      for (const rules of [[], ["not_a_rule"]]) {
        expect(
          await removeItem(decisionDeps(later(3 * HOUR)), {
            ...item(held),
            rules,
            note: "Why",
          }),
        ).toEqual({ ok: false, error: "Pick at least one rule." });
      }
    });
    expect((await db.query(`SELECT status, decided_at FROM reviews WHERE id = $1`, [q.held.id])).rows[0]).toEqual({
      status: "pending",
      decided_at: null,
    });
    expect(sent).toEqual([]);
    expect(purged).toEqual([]);
  });

  test("an item its author deleted can't be removed, and nobody is emailed", async () => {
    const q = await seedQueue();
    reset();
    const reported = byId(await loadModerationQueue(db, "reported", later(2 * HOUR)), q.reported.id);
    // As deleteGuestReview leaves it, with its open reports dismissed.
    await db.query(`UPDATE reviews SET status = 'deleted', body = NULL, score = NULL, deleted_at = $2 WHERE id = $1`, [q.reported.id, later(2 * HOUR)]);
    await db.query(`UPDATE review_reports SET status = 'dismissed', decided_at = $2 WHERE review_id = $1`, [q.reported.id, later(2 * HOUR)]);
    await as("ob_admin_write", async () => {
      expect(
        await removeItem(decisionDeps(later(3 * HOUR)), { ...item(reported), rules: ["abuse"], note: null }),
      ).toEqual({ ok: false, error: expect.stringMatching(/deleted/) });
    });
    expect(sent).toEqual([]);
    expect(await loadModerationQueue(db, "reported", later(3 * HOUR))).toHaveLength(1);
  });

  test("ob_admin_write cannot touch what no action changes", async () => {
    expect(await denied("ob_admin_write", () => db.query(`UPDATE bookings SET total_cents = 1 WHERE id = $1`, [bookingId]))).toBe(true);
    expect(await denied("ob_admin_write", () => db.query(`SELECT 1 FROM messages LIMIT 1`))).toBe(true);
  });
});

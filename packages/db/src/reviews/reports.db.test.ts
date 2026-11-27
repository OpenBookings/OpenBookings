/**
 * Reports (0061) against Postgres: who can report what, one open report per
 * reporter per item, a reply's review taken from the reply, and the inserts
 * as the app roles, where a public reporter can't read a report back.
 *
 * Each test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { TextCheck } from "@openbookings/pricing";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedGuest, seedProperty } from "../testing/db-harness";
import { deleteGuestReview, postReviewReply, submitReview } from "./index";
import { decideItem, type ModerationItem } from "./moderation";
import { createReviewReport, loadReportTarget, type ReportReporter } from "./reports";

const HOUR = 3_600_000;
const CHECK_IN = "2031-11-10";
const WRITTEN = new Date(Date.parse("2031-11-12T10:00:00Z") + 48 * HOUR);
const later = (ms: number) => new Date(WRITTEN.getTime() + ms);

const CLEAN: TextCheck = { verdict: "clean", rules: [], fragments: [], source: "regex" };
const NAMED: TextCheck = { verdict: "flagged", rules: ["personal_details"], fragments: ["Jan Jansen"], source: "mistral" };

describeWithDb("review reports against Postgres", () => {
  let db: Client;
  let ids: Awaited<ReturnType<typeof seedProperty>>;
  let hostId: string;

  const one = async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0] as T;

  async function review(check: TextCheck = CLEAN, body = "Jan Jansen at the desk was rude.") {
    const { bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    const guestId = (await one<{ user_id: string }>(`SELECT user_id FROM bookings WHERE id = $1`, [bookingId])).user_id;
    const result = await submitReview(db, { bookingId, via: "session", score: 3, body, check, now: WRITTEN });
    if (!result.ok) throw new Error(`review failed: ${result.error}`);
    return { bookingId, guestId, item: { kind: "review", id: result.reviewId } as ModerationItem };
  }

  async function reply(reviewId: string, check: TextCheck = CLEAN): Promise<ModerationItem> {
    const result = await postReviewReply(db, { reviewId, role: "host", authorUserId: hostId, body: "That is not true.", check, now: later(HOUR) });
    if (!result.ok) throw new Error(`reply failed: ${result.error}`);
    return { kind: "reply", id: result.replyId };
  }

  const host = (userId = hostId): ReportReporter => ({ kind: "host", userId });
  const report = (item: ModerationItem, reporter: ReportReporter, rule: unknown = "personal_details", note: unknown = null) =>
    createReviewReport(db, { item, reporter, rule, note, now: later(2 * HOUR) });
  const stored = (id: string) =>
    one<Record<string, unknown>>(
      `SELECT review_id, reply_id, reporter_kind, reporter_user_id, reporter_org_id, reporter_email, rule, note, status, created_at
         FROM review_reports WHERE id = $1`,
      [id],
    );

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
    hostId = await seedGuest(db);
    await db.query(`UPDATE properties SET owner_user_id = $2 WHERE id = $1`, [ids.propertyId, hostId]);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("a host reports a review once; a second open report is already_open", async () => {
    const orgId = `org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, now())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $2 WHERE id = $1`, [ids.propertyId, orgId]);
    const { item } = await review();

    const first = await report(item, host(), "personal_details", "  Names our receptionist.  ");
    expect(first).toEqual({ ok: true, reportId: expect.any(String) });
    if (!first.ok) throw new Error("report failed");
    expect(await stored(first.reportId)).toEqual({
      review_id: item.id,
      reply_id: null,
      reporter_kind: "host",
      reporter_user_id: hostId,
      reporter_org_id: orgId,
      reporter_email: null,
      rule: "personal_details",
      note: "Names our receptionist.",
      status: "open",
      created_at: later(2 * HOUR),
    });

    // Again, or by a colleague of the same organization: one open report per organization.
    expect(await report(item, host(), "abuse")).toEqual({ ok: false, error: "already_open" });
    expect(await report(item, host(await seedGuest(db)))).toEqual({ ok: false, error: "already_open" });

    // Once it's decided (kept), the host may report it again, and that reopens it.
    expect(await decideItem(db, { item, decision: "kept", rules: [], note: null, decidedBy: "staff-1", now: later(3 * HOUR) })).toMatchObject({ ok: true });
    const again = await createReviewReport(db, { item, reporter: host(), rule: "personal_details", note: null, now: later(4 * HOUR) });
    expect(again).toMatchObject({ ok: true });
    expect(
      await decideItem(db, { item, decision: "removed", rules: ["personal_details"], note: null, decidedBy: "staff-1", now: later(5 * HOUR) }),
    ).toMatchObject({ ok: true, reportsClosed: 1 });
  });

  test("a pending or removed review cannot be reported, nor a deleted one", async () => {
    const held = await review(NAMED);
    expect(await report(held.item, host())).toEqual({ ok: false, error: "not_found" });

    const removed = await review();
    await decideItem(db, { item: removed.item, decision: "removed", rules: ["abuse"], note: null, decidedBy: "staff-1", now: later(HOUR) });
    expect(await report(removed.item, host())).toEqual({ ok: false, error: "not_found" });

    const deleted = await review();
    await deleteGuestReview(db, { bookingId: deleted.bookingId, guestUserId: deleted.guestId, now: later(HOUR) });
    expect(await report(deleted.item, { kind: "public", userId: null, email: null })).toEqual({ ok: false, error: "not_found" });

    expect(await report({ kind: "review", id: crypto.randomUUID() }, host())).toEqual({ ok: false, error: "not_found" });
    expect(await report({ kind: "review", id: "not-a-uuid" }, host())).toEqual({ ok: false, error: "not_found" });
    expect(Number((await one<{ n: string }>(`SELECT count(*) AS n FROM review_reports`)).n)).toBe(0);
  });

  test("a reply's review comes from the reply; a held reply, or one on a held review, can't be reported", async () => {
    const published = await review();
    const live = await reply(published.item.id);
    const result = await report(live, { kind: "public", userId: null, email: null }, "abuse");
    if (!result.ok) throw new Error(`report failed: ${result.error}`);
    expect(await stored(result.reportId)).toMatchObject({ review_id: published.item.id, reply_id: live.id, reporter_kind: "public" });

    const heldReply = await reply((await review()).item.id, NAMED);
    expect(await report(heldReply, host())).toEqual({ ok: false, error: "not_found" });
  });

  test("an unknown rule, a long note or a malformed email is invalid", async () => {
    const { item } = await review();
    expect(await report(item, host(), "spam")).toEqual({ ok: false, error: "invalid" });
    expect(await report(item, host(), "abuse", "x".repeat(1001))).toEqual({ ok: false, error: "invalid" });
    expect(await report(item, { kind: "public", userId: null, email: "not an email" })).toEqual({ ok: false, error: "invalid" });
    expect(await report(item, host(), "abuse", "x".repeat(1000))).toMatchObject({ ok: true });
  });

  test("the public: one open report per email or account; a signed-out reporter leaves nothing to match on", async () => {
    const { item } = await review();
    const anonymous = { kind: "public", userId: null, email: null } as const;
    expect(await report(item, anonymous)).toMatchObject({ ok: true });
    expect(await report(item, anonymous)).toMatchObject({ ok: true });

    const reader = await seedGuest(db);
    const withEmail = { kind: "public", userId: reader, email: `${reader}@example.test` } as const;
    expect(await report(item, withEmail)).toMatchObject({ ok: true });
    expect(await report(item, withEmail)).toEqual({ ok: false, error: "already_open" });
    const signedIn = { kind: "public", userId: await seedGuest(db), email: null } as const;
    expect(await report(item, signedIn)).toMatchObject({ ok: true });
    expect(await report(item, signedIn)).toEqual({ ok: false, error: "already_open" });
  });

  test("loadReportTarget shows the published words, masked where the deadline masked them", async () => {
    const { item } = await review();
    await db.query(`UPDATE reviews SET masked_body = 'Jan [removed] at the desk.' WHERE id = $1`, [item.id]);
    expect(await loadReportTarget(db, item)).toMatchObject({
      reviewId: item.id,
      propertyId: ids.propertyId,
      propertyName: "Test Property",
      replyRole: null,
      body: "Jan [removed] at the desk.",
    });
    expect(await loadReportTarget(db, (await review(NAMED)).item)).toBeNull();
  });

  // ── The app roles (0049, 0061) ────────────────────────────────────────────

  /** Run `fn` as an app role for one user. On an error the caller rolls back to a savepoint, which undoes both settings. */
  async function asApp<T>(role: "ob_web" | "ob_business", userId: string, fn: () => Promise<T>): Promise<T> {
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await db.query(`SET LOCAL ROLE ${role}`);
    const result = await fn();
    await db.query("RESET ROLE");
    await db.query(`SELECT set_config('app.user_id', '', true)`);
    return result;
  }
  /** What 0049 sets up for the app roles, for this suite's tables (a schema dump lacks it). Rolled back with the rest. */
  const grantAppRoles = () =>
    db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_web') THEN CREATE ROLE ob_web; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_business') THEN CREATE ROLE ob_business; END IF;
      GRANT ob_app TO ob_web, ob_business;
      EXECUTE format('GRANT ob_web, ob_business TO %I WITH INHERIT FALSE, SET TRUE', current_user);
      GRANT USAGE ON SCHEMA public, app TO ob_app;
      GRANT EXECUTE ON FUNCTION app.user_id(), app.readable_property_ids() TO ob_app;
      GRANT SELECT ON properties TO ob_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON reviews, review_replies, review_reports TO ob_app;
    END $$`);

  test("as the app roles: the public inserts without reading back, a host only on a property it reads", async () => {
    await grantAppRoles();
    const published = await review();
    const live = await reply(published.item.id);

    // Signed out, or signed in with updates: insert-only, and the second is still already_open.
    const anonymous = await asApp("ob_web", "", () => report(published.item, { kind: "public", userId: null, email: null }));
    expect(anonymous).toMatchObject({ ok: true });
    const reader = await seedGuest(db);
    const withEmail = { kind: "public", userId: reader, email: `${reader}@example.test` } as const;
    expect(await asApp("ob_web", reader, () => report(live, withEmail, "abuse"))).toMatchObject({ ok: true });
    expect(await asApp("ob_web", reader, () => report(live, withEmail, "abuse"))).toEqual({ ok: false, error: "already_open" });
    // ...and can't see what they reported, which is why createReviewReport never uses RETURNING.
    expect((await asApp("ob_web", reader, () => db.query(`SELECT id FROM review_reports`))).rows).toEqual([]);
    await db.query("SAVEPOINT read_back");
    await expect(
      asApp("ob_web", "", () =>
        db.query(`INSERT INTO review_reports (review_id, reporter_kind, rule) VALUES ($1, 'public', 'abuse') RETURNING id`, [published.item.id]),
      ),
    ).rejects.toThrow(/row-level security/);
    await db.query("ROLLBACK TO SAVEPOINT read_back");

    // The host of the property reports and reads its own report back; a stranger's host report is refused by the policy.
    const own = await asApp("ob_business", hostId, () => report(published.item, host()));
    expect(own).toMatchObject({ ok: true });
    expect((await asApp("ob_business", hostId, () => db.query(`SELECT reporter_kind FROM review_reports`))).rows).toEqual([
      { reporter_kind: "host" },
    ]);
    const stranger = await seedGuest(db);
    await db.query("SAVEPOINT stranger");
    await expect(asApp("ob_business", stranger, () => report(published.item, host(stranger)))).rejects.toThrow(/row-level security/);
    await db.query("ROLLBACK TO SAVEPOINT stranger");
  });
});

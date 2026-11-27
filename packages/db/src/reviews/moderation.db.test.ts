/**
 * Moderation (0061) against Postgres: how a check's outcome is stored, the
 * 72-hour deadline with masking, Keep and Remove as compare-and-set, the
 * one rewrite after a removal, and the 12-month purge. The admin console's
 * roles run the loaders and decideItem at the end.
 *
 * Each test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import type { TextCheck } from "@openbookings/pricing";
import {
  applyPendingMigrations,
  connectionString,
  describeWithDb,
  pendingMigrationSql,
  seedBooking,
  seedGuest,
  seedProperty,
} from "../testing/db-harness";
import {
  deleteGuestReview,
  getReviewContext,
  loadPropertyReviews,
  loadReviewReplies,
  postReviewReply,
  submitReview,
} from "./index";
import {
  applyRecheck,
  decideItem,
  publishOverdue,
  purgeModerationRecords,
  uncheckedItems,
  type ModerationItem,
} from "./moderation";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CHECK_IN = "2031-11-10";
const CHECK_OUT_AT = Date.parse("2031-11-12T10:00:00Z");
const at = (ms: number) => new Date(CHECK_OUT_AT + ms);
/** When the reviews in these tests are written: two days after check-out. */
const WRITTEN = at(2 * DAY);
const later = (ms: number) => new Date(WRITTEN.getTime() + ms);

const CLEAN: TextCheck = { verdict: "clean", rules: [], fragments: [], source: "regex" };
const NAMED: TextCheck = { verdict: "flagged", rules: ["personal_details"], fragments: ["Jan Jansen"], source: "mistral" };
const UNCHECKED: TextCheck = { verdict: "unchecked", rules: [], fragments: [], source: "mistral" };
const RUDE = "Jan Jansen at the desk was rude to us.";

describeWithDb("review moderation against Postgres", () => {
  let db: Client;
  let ids: Awaited<ReturnType<typeof seedProperty>>;
  let hostId: string;

  const one = async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0] as T;

  /** A stay that ended at CHECK_OUT_AT, ready to be reviewed. */
  async function stay(): Promise<{ bookingId: string; guestId: string }> {
    const { bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    const guestId = (await one<{ user_id: string }>(`SELECT user_id FROM bookings WHERE id = $1`, [bookingId])).user_id;
    return { bookingId, guestId };
  }

  /** A review written at WRITTEN (or `now`) with `check`'s outcome. */
  async function review(check: TextCheck, body = RUDE, now = WRITTEN) {
    const { bookingId, guestId } = await stay();
    const result = await submitReview(db, { bookingId, via: "session", score: 4, body, check, now });
    if (!result.ok) throw new Error(`review failed: ${result.error}`);
    return { bookingId, guestId, reviewId: result.reviewId, item: { kind: "review", id: result.reviewId } as ModerationItem };
  }

  const reviewRow = (id: string) =>
    one<Record<string, unknown>>(
      `SELECT status, body, masked_body, flagged_reason, flagged_fragments, check_source, checked_at, published_at,
              published_by_deadline, decision, decision_rules, decision_note, decided_by, decided_at, rewrite_used
         FROM reviews WHERE id = $1`,
      [id],
    );

  async function report(reviewId: string, replyId: string | null = null, org = `org-${crypto.randomUUID()}`) {
    return (
      await one<{ id: string }>(
        `INSERT INTO review_reports (review_id, reply_id, reporter_kind, reporter_user_id, reporter_org_id, rule, note)
         VALUES ($1, $2, 'host', $3, $4, 'personal_details', 'Names our staff') RETURNING id`,
        [reviewId, replyId, hostId, org],
      )
    ).id;
  }
  const reportStatus = async (id: string) =>
    one<{ status: string; decided: boolean }>(`SELECT status, decided_at IS NOT NULL AS decided FROM review_reports WHERE id = $1`, [id]);

  const decide = (item: ModerationItem, decision: "kept" | "removed", now: Date, rules: TextCheck["rules"] = ["personal_details"]) =>
    decideItem(db, { item, decision, rules, note: "Names a member of staff.", decidedBy: "staff-1", now });

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

  test("a clean check publishes, a flagged check holds with fragments", async () => {
    const clean = await review(CLEAN, "Lovely stay.");
    expect(await reviewRow(clean.reviewId)).toMatchObject({
      status: "published",
      flagged_reason: null,
      flagged_fragments: [],
      check_source: "regex",
      checked_at: WRITTEN,
      published_at: WRITTEN,
    });

    const held = await review(NAMED);
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "pending",
      flagged_reason: "personal_details",
      flagged_fragments: ["Jan Jansen"],
      check_source: "mistral",
      checked_at: WRITTEN,
      published_at: null,
    });

    // Replies store the same.
    const replied = await postReviewReply(db, {
      reviewId: clean.reviewId,
      role: "host",
      authorUserId: hostId,
      body: "Mail us at desk@example.com",
      check: { verdict: "flagged", rules: ["links_contact"], fragments: ["desk@example.com"], source: "regex" },
      now: later(HOUR),
    });
    expect(replied).toMatchObject({ ok: true, status: "pending" });
    if (!replied.ok) throw new Error("reply failed");
    expect(
      await one(`SELECT status, flagged_reason, flagged_fragments, check_source FROM review_replies WHERE id = $1`, [replied.replyId]),
    ).toEqual({ status: "pending", flagged_reason: "links_contact", flagged_fragments: ["desk@example.com"], check_source: "regex" });
  });

  test("an unchecked check holds with check_source unchecked", async () => {
    const held = await review(UNCHECKED, "Fine.");
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "pending",
      flagged_reason: null,
      check_source: "unchecked",
      checked_at: null,
    });
    expect(await uncheckedItems(db, 10)).toEqual([{ kind: "review", id: held.reviewId, body: "Fine." }]);

    // The recheck publishes it once the model answers clean.
    await applyRecheck(db, held.item, { ...CLEAN, source: "mistral" }, later(HOUR));
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "published",
      check_source: "mistral",
      checked_at: later(HOUR),
      published_at: later(HOUR),
    });
    expect(await uncheckedItems(db, 10)).toEqual([]);

    // Or holds it with what the model found.
    const other = await review(UNCHECKED);
    await applyRecheck(db, other.item, NAMED, later(HOUR));
    expect(await reviewRow(other.reviewId)).toMatchObject({
      status: "pending",
      flagged_reason: "personal_details",
      flagged_fragments: ["Jan Jansen"],
      check_source: "mistral",
    });
  });

  test("publishOverdue publishes at 72 hours with fragments masked, not at 71", async () => {
    const held = await review(NAMED);
    expect(await publishOverdue(db, later(71 * HOUR))).toBe(0);
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "pending", masked_body: null });

    expect(await publishOverdue(db, later(72 * HOUR))).toBe(1);
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "published",
      published_at: later(72 * HOUR),
      published_by_deadline: true,
      body: RUDE,
      masked_body: "[removed] at the desk was rude to us.",
      decided_at: null,
    });
    // Once only.
    expect(await publishOverdue(db, later(73 * HOUR))).toBe(0);

    // A held item without fragments publishes as written.
    const plain = await review(UNCHECKED, "Fine.", later(DAY));
    expect(await publishOverdue(db, later(DAY + 72 * HOUR))).toBe(1);
    expect(await reviewRow(plain.reviewId)).toMatchObject({ status: "published", masked_body: null, published_by_deadline: true });
  });

  test("the public loader shows the masked text, never the original", async () => {
    const held = await review(NAMED);
    const reply = await postReviewReply(db, {
      reviewId: held.reviewId,
      role: "host",
      authorUserId: hostId,
      body: "We spoke to Jan Jansen about it.",
      check: { verdict: "flagged", rules: ["personal_details"], fragments: ["Jan Jansen"], source: "mistral" },
      now: later(HOUR),
    });
    if (!reply.ok) throw new Error("reply failed");
    await publishOverdue(db, later(73 * HOUR));

    const page = await loadPropertyReviews(db, ids.propertyId, later(80 * HOUR));
    expect(page.reviews.map((r) => r.body)).toEqual(["[removed] at the desk was rude to us."]);
    expect(page.reviews[0]!.replies.map((r) => r.body)).toEqual(["We spoke to [removed] about it."]);
    expect(JSON.stringify(page)).not.toContain("Jansen");
    const threads = await loadReviewReplies(db, [held.reviewId], { publicOnly: true });
    expect(JSON.stringify([...threads.values()])).not.toContain("Jansen");
  });

  test("decideItem keeps once; a second decision is already_decided", async () => {
    const held = await review(NAMED);
    expect(await decide(held.item, "kept", later(HOUR), [])).toEqual({ ok: true, reportsClosed: 0, reportIds: [] });
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "published",
      published_at: later(HOUR),
      decision: "kept",
      decision_rules: [],
      decided_by: "staff-1",
      decided_at: later(HOUR),
    });
    expect(await decide(held.item, "removed", later(2 * HOUR))).toEqual({ ok: false, error: "already_decided" });
    expect(await decide(held.item, "kept", later(2 * HOUR), [])).toEqual({ ok: false, error: "already_decided" });
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "published", decision: "kept", decided_at: later(HOUR) });

    // And the deadline never overrides a decision.
    expect(await publishOverdue(db, later(80 * HOUR))).toBe(0);
    expect(await reviewRow(held.reviewId)).toMatchObject({ published_by_deadline: false, masked_body: null });
  });

  test("Remove needs a rule; unknown items are not_found", async () => {
    const held = await review(NAMED);
    expect(await decide(held.item, "removed", later(HOUR), [])).toEqual({ ok: false, error: "rules_required" });
    expect(await decide({ kind: "review", id: crypto.randomUUID() }, "kept", later(HOUR), [])).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await decide({ kind: "reply", id: "not-a-uuid" }, "kept", later(HOUR), [])).toEqual({ ok: false, error: "not_found" });
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "pending", decided_at: null });
  });

  test("decideItem after publish-by-deadline may still remove", async () => {
    const held = await review(NAMED);
    await publishOverdue(db, later(72 * HOUR));
    expect(await decide(held.item, "removed", later(80 * HOUR))).toMatchObject({ ok: true });
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "removed",
      decision: "removed",
      decision_rules: ["personal_details"],
      decision_note: "Names a member of staff.",
      published_by_deadline: true,
    });
    expect((await loadPropertyReviews(db, ids.propertyId, later(81 * HOUR))).reviews).toEqual([]);
    expect(await decide(held.item, "kept", later(81 * HOUR), [])).toEqual({ ok: false, error: "already_decided" });
  });

  test("removing closes open reports as upheld", async () => {
    const published = await review(CLEAN, "Jan Jansen stole my bag.");
    const first = await report(published.reviewId);
    const second = await report(published.reviewId);
    const result = await decide(published.item, "removed", later(DAY));
    expect(result).toMatchObject({ ok: true, reportsClosed: 2 });
    if (!result.ok) throw new Error("decide failed");
    expect(result.reportIds.sort()).toEqual([first, second].sort());
    expect(await reportStatus(first)).toEqual({ status: "upheld", decided: true });
    expect(await reportStatus(second)).toEqual({ status: "upheld", decided: true });
  });

  test("keeping closes them as dismissed", async () => {
    const published = await review(CLEAN, "Lovely.");
    const reply = await postReviewReply(db, {
      reviewId: published.reviewId,
      role: "host",
      authorUserId: hostId,
      body: "Thank you.",
      check: CLEAN,
      now: later(HOUR),
    });
    if (!reply.ok) throw new Error("reply failed");
    const onReview = await report(published.reviewId);
    const onReply = await report(published.reviewId, reply.replyId);

    expect(await decide({ kind: "reply", id: reply.replyId }, "kept", later(DAY), [])).toMatchObject({
      ok: true,
      reportsClosed: 1,
      reportIds: [onReply],
    });
    expect(await reportStatus(onReply)).toEqual({ status: "dismissed", decided: true });
    // The review's own report waits for the review's decision.
    expect(await reportStatus(onReview)).toEqual({ status: "open", decided: false });
  });

  test("one open report per reporter per item", async () => {
    const published = await review(CLEAN, "Lovely.");
    await report(published.reviewId, null, "org-a");
    await db.query("SAVEPOINT dup");
    await expect(report(published.reviewId, null, "org-a")).rejects.toThrow(/uq_review_reports_open_per_reporter/);
    await db.query("ROLLBACK TO SAVEPOINT dup");
  });

  test("a removed review can be rewritten once; after a second removal it cannot", async () => {
    const first = await review(NAMED);
    await decide(first.item, "removed", later(HOUR));
    const context = await getReviewContext(db, first.bookingId, later(2 * HOUR));
    expect(context?.eligibility).toMatchObject({ ok: true });
    expect(context?.review?.status).toBe("removed");

    const rewritten = await submitReview(db, {
      bookingId: first.bookingId,
      via: "session",
      score: 5,
      body: "The desk staff were rude.",
      check: CLEAN,
      now: later(DAY),
    });
    expect(rewritten).toMatchObject({ ok: true, reviewId: first.reviewId, status: "published" });
    expect(await reviewRow(first.reviewId)).toMatchObject({
      status: "published",
      body: "The desk staff were rude.",
      flagged_reason: null,
      flagged_fragments: [],
      published_at: later(DAY),
      decision: null,
      decision_rules: null,
      decision_note: null,
      decided_by: null,
      decided_at: null,
      rewrite_used: true,
    });
    expect(await one(`SELECT score, created_at FROM reviews WHERE id = $1`, [first.reviewId])).toEqual({
      score: 5,
      created_at: later(DAY),
    });

    expect(await decide(first.item, "removed", later(2 * DAY))).toMatchObject({ ok: true });
    expect((await getReviewContext(db, first.bookingId, later(3 * DAY)))?.eligibility).toEqual({
      ok: false,
      reason: "already_reviewed",
    });
    expect(
      await submitReview(db, { bookingId: first.bookingId, via: "session", score: 5, body: "Again", check: CLEAN, now: later(3 * DAY) }),
    ).toEqual({ ok: false, error: "already_reviewed" });
  });

  test("a deleted review drops out: decideItem returns not_found and its open reports are dismissed", async () => {
    const held = await review(UNCHECKED);
    const open = await report(held.reviewId);
    expect(await deleteGuestReview(db, { bookingId: held.bookingId, guestUserId: held.guestId, now: later(HOUR) })).toBe(true);

    expect(await reportStatus(open)).toEqual({ status: "dismissed", decided: true });
    expect(await decide(held.item, "removed", later(2 * HOUR))).toEqual({ ok: false, error: "not_found" });
    expect(await uncheckedItems(db, 10)).toEqual([]);
    expect(await publishOverdue(db, later(80 * HOUR))).toBe(0);
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "deleted", body: null, masked_body: null, flagged_fragments: [] });
  });

  test("purge removes reports and original text 12 months after the decision, not before", async () => {
    // A removed review with an upheld report.
    const removed = await review(NAMED);
    const upheld = await report(removed.reviewId);
    // A review published masked by the deadline, then kept.
    const masked = await review(NAMED);
    // A removed host reply under it.
    const reply = await postReviewReply(db, {
      reviewId: masked.reviewId,
      role: "host",
      authorUserId: hostId,
      body: "Call me on +31 6 1234 5678.",
      check: { verdict: "flagged", rules: ["links_contact"], fragments: ["+31 6 1234 5678"], source: "regex" },
      now: later(HOUR),
    });
    if (!reply.ok) throw new Error("reply failed");
    await publishOverdue(db, later(72 * HOUR));
    const decidedAt = later(80 * HOUR);
    await decide(removed.item, "removed", decidedAt);
    await decide(masked.item, "kept", decidedAt, []);
    await decide({ kind: "reply", id: reply.replyId }, "removed", decidedAt, ["links_contact"]);
    // Still open: not purged however old.
    const open = await report(masked.reviewId);

    const yearLater = new Date(decidedAt);
    yearLater.setUTCMonth(yearLater.getUTCMonth() + 12);
    expect(await purgeModerationRecords(db, new Date(yearLater.getTime() - 1))).toEqual({ reports: 0, texts: 0 });
    expect(await reviewRow(removed.reviewId)).toMatchObject({ body: RUDE });

    expect(await purgeModerationRecords(db, yearLater)).toEqual({ reports: 1, texts: 3 });
    expect(await one(`SELECT count(*)::int AS n FROM review_reports WHERE id = $1`, [upheld])).toEqual({ n: 0 });
    expect(await reportStatus(open)).toEqual({ status: "open", decided: false });
    // Removed: the text goes, the score and the row stay.
    expect(await reviewRow(removed.reviewId)).toMatchObject({ status: "removed", body: null, masked_body: null, flagged_fragments: [] });
    expect(await one(`SELECT score FROM reviews WHERE id = $1`, [removed.reviewId])).toEqual({ score: 4 });
    // Masked: the masked text becomes the text.
    expect(await reviewRow(masked.reviewId)).toMatchObject({
      status: "published",
      body: "[removed] at the desk was rude to us.",
      masked_body: null,
      flagged_fragments: [],
    });
    // The removed reply keeps its place in the thread, without its text.
    expect(await one(`SELECT status, body, masked_body FROM review_replies WHERE id = $1`, [reply.replyId])).toEqual({
      status: "removed",
      body: null,
      masked_body: null,
    });
    // Nothing left to do.
    expect(await purgeModerationRecords(db, yearLater)).toEqual({ reports: 0, texts: 0 });
  });

  // ── The admin console's roles (0054) ──────────────────────────────────────

  /** Run `fn` as `role`, then return to the owner. */
  async function as<T>(role: "ob_admin_read" | "ob_admin_write", fn: () => Promise<T>): Promise<T> {
    await db.query(`SET LOCAL ROLE ${role}`);
    const result = await fn();
    await db.query("RESET ROLE");
    return result;
  }
  async function denied(role: "ob_admin_read" | "ob_admin_write", sql: string, values: unknown[]): Promise<boolean> {
    await db.query("SAVEPOINT denied");
    await db.query(`SET LOCAL ROLE ${role}`);
    try {
      await db.query(sql, values);
      return false;
    } catch (error) {
      return /permission denied/.test((error as Error).message);
    } finally {
      await db.query("ROLLBACK TO SAVEPOINT denied");
    }
  }
  /** A schema dump carries the roles without BYPASSRLS: give it back, as the admin suites do. */
  const replayAdminRoles = () =>
    db.query(
      pendingMigrationSql("0054_admin_roles.sql").replace("accommodation_amount, tourist_tax_amount", "accommodation_cents, tourist_tax_cents"),
    );

  test("the loaders run as ob_admin_read, which cannot decide", async () => {
    await replayAdminRoles();
    const held = await review(UNCHECKED, "Fine.");
    const published = await review(CLEAN, "Lovely.");
    const open = await report(published.reviewId);
    await as("ob_admin_read", async () => {
      expect((await loadPropertyReviews(db, ids.propertyId, later(HOUR))).reviews.map((r) => r.id)).toEqual([published.reviewId]);
      expect((await loadReviewReplies(db, [published.reviewId], { publicOnly: false })).size).toBe(0);
      expect(await uncheckedItems(db, 10)).toEqual([{ kind: "review", id: held.reviewId, body: "Fine." }]);
      expect((await db.query(`SELECT id, status, rule, note FROM review_reports WHERE id = $1`, [open])).rows).toHaveLength(1);
    });
    expect(
      await denied("ob_admin_read", `UPDATE reviews SET decision = 'kept', decided_at = now() WHERE id = $1`, [held.reviewId]),
    ).toBe(true);
  });

  test("decideItem runs as ob_admin_write, which cannot touch the text", async () => {
    await replayAdminRoles();
    const held = await review(NAMED);
    const published = await review(CLEAN, "Jan Jansen stole my bag.");
    const reply = await postReviewReply(db, {
      reviewId: published.reviewId,
      role: "host",
      authorUserId: hostId,
      body: "Not true.",
      check: CLEAN,
      now: later(HOUR),
    });
    if (!reply.ok) throw new Error("reply failed");
    const open = await report(published.reviewId);
    await as("ob_admin_write", async () => {
      expect(await decide(held.item, "kept", later(DAY), [])).toMatchObject({ ok: true });
      expect(await decide(published.item, "removed", later(DAY))).toMatchObject({ ok: true, reportsClosed: 1 });
      expect(await decide({ kind: "reply", id: reply.replyId }, "removed", later(DAY))).toMatchObject({ ok: true });
      expect(await decide(held.item, "removed", later(DAY))).toEqual({ ok: false, error: "already_decided" });
    });
    expect(await reportStatus(open)).toEqual({ status: "upheld", decided: true });
    for (const sql of [
      `UPDATE reviews SET body = 'edited' WHERE id = $1`,
      `UPDATE reviews SET score = 10 WHERE id = $1`,
      `UPDATE review_replies SET body = 'edited' WHERE review_id = $1`,
      `DELETE FROM review_reports WHERE review_id = $1`,
    ]) {
      expect(await denied("ob_admin_write", sql, [published.reviewId])).toBe(true);
    }
  });
});

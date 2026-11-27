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
  deleteHostReply,
  getReviewContext,
  loadPropertyReviews,
  loadReviewReplies,
  postReviewReply,
  submitReview,
} from "./index";
import {
  applyRecheck,
  decideItem,
  moderationVersionSql,
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

  /** A host's report, made an hour after the reviews were written unless `createdAt` says otherwise. */
  async function report(reviewId: string, replyId: string | null = null, org = `org-${crypto.randomUUID()}`, createdAt = later(HOUR)) {
    return (
      await one<{ id: string }>(
        `INSERT INTO review_reports (review_id, reply_id, reporter_kind, reporter_user_id, reporter_org_id, rule, note, created_at)
         VALUES ($1, $2, 'host', $3, $4, 'personal_details', 'Names our staff', $5) RETURNING id`,
        [reviewId, replyId, hostId, org, createdAt],
      )
    ).id;
  }
  /** A report from the public form, with an email for the outcome. */
  async function publicReport(reviewId: string, replyId: string | null = null) {
    return (
      await one<{ id: string }>(
        `INSERT INTO review_reports (review_id, reply_id, reporter_kind, reporter_email, rule, created_at)
         VALUES ($1, $2, 'public', $3, 'abuse', $4) RETURNING id`,
        [reviewId, replyId, `reporter-${crypto.randomUUID()}@example.test`, later(HOUR)],
      )
    ).id;
  }
  const reportStatus = async (id: string) =>
    one<{ status: string; decided: boolean }>(`SELECT status, decided_at IS NOT NULL AS decided FROM review_reports WHERE id = $1`, [id]);

  /** The version of an item the admin queue loads, as moderationVersionSql reads it. */
  const moderationVersion = async (item: ModerationItem) =>
    (
      await one<{ v: string }>(
        `SELECT ${moderationVersionSql(item.kind, "t")} AS v FROM ${item.kind === "review" ? "reviews" : "review_replies"} t WHERE t.id = $1`,
        [item.id],
      )
    ).v;

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

  test("a recheck that fails again sends the item to the back of the line", async () => {
    const first = await review(UNCHECKED, "One.");
    const second = await review(UNCHECKED, "Two.", later(HOUR / 2));
    const ids = async (limit = 10) => (await uncheckedItems(db, limit)).map((i) => i.id);
    expect(await ids()).toEqual([first.reviewId, second.reviewId]);
    expect(await ids(1)).toEqual([first.reviewId]);

    // The model fails on the first again: nothing is stored, but the second now goes first.
    expect(await applyRecheck(db, first.item, UNCHECKED, later(HOUR))).toEqual({ stored: false, publishedPropertyId: null });
    expect(await ids(1)).toEqual([second.reviewId]);
    expect(await reviewRow(first.reviewId)).toMatchObject({ status: "pending", check_source: "unchecked", checked_at: null });

    await applyRecheck(db, second.item, UNCHECKED, later(2 * HOUR));
    expect(await ids()).toEqual([first.reviewId, second.reviewId]);
  });

  test("publishOverdue publishes at 72 hours with fragments masked, not at 71", async () => {
    const held = await review(NAMED);
    expect((await publishOverdue(db, later(71 * HOUR))).published).toBe(0);
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "pending", masked_body: null });

    expect((await publishOverdue(db, later(72 * HOUR))).published).toBe(1);
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "published",
      published_at: later(72 * HOUR),
      published_by_deadline: true,
      body: RUDE,
      masked_body: "[removed] at the desk was rude to us.",
      decided_at: null,
    });
    // Once only.
    expect((await publishOverdue(db, later(73 * HOUR))).published).toBe(0);

    // A held item without fragments publishes as written.
    const plain = await review(UNCHECKED, "Fine.", later(DAY));
    expect((await publishOverdue(db, later(DAY + 72 * HOUR))).published).toBe(1);
    expect(await reviewRow(plain.reviewId)).toMatchObject({ status: "published", masked_body: null, published_by_deadline: true });
  });

  test("publishOverdue stores no mask when the fragments aren't in the text, and sends no notice", async () => {
    // The model quoted words the text doesn't hold (paraphrased, or another case): nothing to mask.
    const held = await review({ ...NAMED, fragments: ["jan jansen"] });
    const result = await publishOverdue(db, later(72 * HOUR));
    expect(result).toMatchObject({ published: 1, masked: [] });
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "published", published_by_deadline: true, masked_body: null });
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
    expect(await decide(held.item, "kept", later(HOUR), [])).toEqual({ ok: true, reportsClosed: 0, reportIds: [], propertyId: ids.propertyId });
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
    expect((await publishOverdue(db, later(80 * HOUR))).published).toBe(0);
    expect(await reviewRow(held.reviewId)).toMatchObject({ published_by_deadline: false, masked_body: null });
  });

  test("decideItem refuses a decision on a version of the item the moderator didn't see", async () => {
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
    const replyItem: ModerationItem = { kind: "reply", id: reply.replyId };
    const seen = await moderationVersion(replyItem);

    // The host edits the reply after the moderator opened the queue.
    await db.query(`UPDATE review_replies SET body = 'We spoke to him.', edited_at = $2 WHERE id = $1`, [reply.replyId, later(2 * HOUR)]);
    const stale = { item: replyItem, decision: "removed" as const, rules: ["personal_details" as const], note: null, decidedBy: "staff-1", now: later(3 * HOUR) };
    expect(await decideItem(db, { ...stale, version: seen })).toEqual({ ok: false, error: "changed" });
    expect(await one(`SELECT status, decided_at FROM review_replies WHERE id = $1`, [reply.replyId])).toEqual({ status: "pending", decided_at: null });

    // Reloaded, the moderator sees the new version and may decide it.
    expect(await decideItem(db, { ...stale, version: await moderationVersion(replyItem) })).toMatchObject({ ok: true });

    // The review's version is its submission: unchanged, the decision goes through.
    expect(await decideItem(db, { ...stale, item: held.item, version: await moderationVersion(held.item) })).toMatchObject({ ok: true });
    // Decided meanwhile wins over changed: the moderator learns it's done.
    expect(await decideItem(db, { ...stale, item: held.item, version: "1" })).toEqual({ ok: false, error: "already_decided" });
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

  test("keeping a deadline-published item shows the original text", async () => {
    const held = await review(NAMED);
    await publishOverdue(db, later(72 * HOUR));
    expect((await loadPropertyReviews(db, ids.propertyId, later(73 * HOUR))).reviews[0]?.body).toBe(
      "[removed] at the desk was rude to us.",
    );

    expect(await decide(held.item, "kept", later(80 * HOUR), [])).toMatchObject({ ok: true });
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "published",
      published_at: later(72 * HOUR),
      published_by_deadline: true,
      masked_body: null,
      decision: "kept",
    });
    expect((await loadPropertyReviews(db, ids.propertyId, later(81 * HOUR))).reviews[0]?.body).toBe(RUDE);
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
    expect((await publishOverdue(db, later(80 * HOUR))).published).toBe(0);
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "deleted", body: null, masked_body: null, flagged_fragments: [] });
  });

  test("purge removes reports and original text 12 months after the decision, not before", async () => {
    // A removed review with an upheld report.
    const removed = await review(NAMED);
    const upheld = await report(removed.reviewId);
    // A review published masked by the deadline, then kept: shown as written.
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
    // Still open, and made less than 12 months before: stays.
    const open = await report(masked.reviewId, null, undefined, later(300 * DAY));

    const yearLater = new Date(decidedAt);
    yearLater.setUTCMonth(yearLater.getUTCMonth() + 12);
    expect(await purgeModerationRecords(db, new Date(yearLater.getTime() - 1))).toEqual({ reports: 0, texts: 0 });
    expect(await reviewRow(removed.reviewId)).toMatchObject({ body: RUDE });

    expect(await purgeModerationRecords(db, yearLater)).toEqual({ reports: 1, texts: 2 });
    expect(await one(`SELECT count(*)::int AS n FROM review_reports WHERE id = $1`, [upheld])).toEqual({ n: 0 });
    expect(await reportStatus(open)).toEqual({ status: "open", decided: false });
    // Removed: the text goes, the score and the row stay.
    expect(await reviewRow(removed.reviewId)).toMatchObject({ status: "removed", body: null, masked_body: null, flagged_fragments: [] });
    expect(await one(`SELECT score FROM reviews WHERE id = $1`, [removed.reviewId])).toEqual({ score: 4 });
    // Kept: a person judged it fine, so there is nothing to purge.
    expect(await reviewRow(masked.reviewId)).toMatchObject({ status: "published", body: RUDE, masked_body: null });
    // The removed reply keeps its place in the thread, without its text.
    expect(await one(`SELECT status, body, masked_body FROM review_replies WHERE id = $1`, [reply.replyId])).toEqual({
      status: "removed",
      body: null,
      masked_body: null,
    });
    // Nothing left to do.
    expect(await purgeModerationRecords(db, yearLater)).toEqual({ reports: 0, texts: 0 });
  });

  test("purge keeps only the masked text of a deadline-published item nobody decided, 12 months after publication", async () => {
    const held = await review(NAMED);
    const publishedAt = later(72 * HOUR);
    await publishOverdue(db, publishedAt);
    const yearLater = new Date(publishedAt);
    yearLater.setUTCMonth(yearLater.getUTCMonth() + 12);

    expect(await purgeModerationRecords(db, new Date(yearLater.getTime() - 1))).toEqual({ reports: 0, texts: 0 });
    expect(await reviewRow(held.reviewId)).toMatchObject({ body: RUDE, masked_body: "[removed] at the desk was rude to us." });

    expect(await purgeModerationRecords(db, yearLater)).toEqual({ reports: 0, texts: 1 });
    expect(await reviewRow(held.reviewId)).toMatchObject({
      status: "published",
      body: "[removed] at the desk was rude to us.",
      masked_body: null,
      flagged_fragments: [],
      published_by_deadline: true,
      decided_at: null,
    });
    expect((await loadPropertyReviews(db, ids.propertyId, yearLater)).reviews[0]?.body).toBe("[removed] at the desk was rude to us.");
    expect(await purgeModerationRecords(db, yearLater)).toEqual({ reports: 0, texts: 0 });
  });

  test("purge deletes a report nobody decided 12 months after it was made", async () => {
    const published = await review(CLEAN, "Lovely.");
    const madeAt = later(DAY);
    const open = await report(published.reviewId, null, undefined, madeAt);
    const yearLater = new Date(madeAt);
    yearLater.setUTCMonth(yearLater.getUTCMonth() + 12);

    expect(await purgeModerationRecords(db, new Date(yearLater.getTime() - 1))).toEqual({ reports: 0, texts: 0 });
    expect(await reportStatus(open)).toEqual({ status: "open", decided: false });
    expect(await purgeModerationRecords(db, yearLater)).toEqual({ reports: 1, texts: 0 });
    expect(await one(`SELECT count(*)::int AS n FROM review_reports WHERE id = $1`, [open])).toEqual({ n: 0 });
  });

  test("an item held before 0061 is marked unchecked for the recheck, and never published unmasked", async () => {
    const held = await review(NAMED);
    // As 0038's code left it: held by the regex, no fragments, no check source.
    await db.query(
      `UPDATE reviews SET flagged_reason = 'url', flagged_fragments = '[]', check_source = NULL, checked_at = NULL WHERE id = $1`,
      [held.reviewId],
    );
    expect((await publishOverdue(db, later(30 * DAY))).published).toBe(0);
    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "pending", masked_body: null });

    // 0061's backfill (its UPDATE statements only: replaying the whole file
    // would take table locks other suites may be waiting on).
    const backfill = pendingMigrationSql("0061_review_moderation.sql")
      .split("\n")
      .filter((line) => /^UPDATE (reviews|review_replies) SET check_source = 'unchecked'/.test(line));
    expect(backfill).toHaveLength(2);
    for (const statement of backfill) await db.query(statement);

    expect(await reviewRow(held.reviewId)).toMatchObject({ status: "pending", check_source: "unchecked" });
    expect(await uncheckedItems(db, 10)).toEqual([{ kind: "review", id: held.reviewId, body: RUDE }]);
    // The recheck finds the fragments, so the deadline masks them.
    await applyRecheck(db, held.item, NAMED, later(30 * DAY));
    expect((await publishOverdue(db, later(30 * DAY))).published).toBe(1);
    expect(await reviewRow(held.reviewId)).toMatchObject({ masked_body: "[removed] at the desk was rude to us." });
  });

  test("the deadline doesn't publish an item edited after it was picked up", async () => {
    const published = await review(CLEAN, "Lovely.");
    const reply = await postReviewReply(db, {
      reviewId: published.reviewId,
      role: "host",
      authorUserId: hostId,
      body: "Ask Jan Jansen.",
      check: NAMED,
      now: later(HOUR),
    });
    if (!reply.ok) throw new Error("reply failed");
    // The host's edit lands between the deadline run's SELECT and its UPDATE:
    // new text, new clock. (One connection, so the edit is run right after
    // the SELECT returns, where another connection's would commit.)
    const racing = {
      query: async (text: string, values?: unknown[]) => {
        const result = await db.query(text, values);
        if (/FROM review_replies rr/.test(text) && /SKIP LOCKED/.test(text)) {
          await db.query(`UPDATE review_replies SET body = 'Ask the desk.', edited_at = $2 WHERE id = $1`, [
            reply.replyId,
            later(80 * HOUR),
          ]);
        }
        return result;
      },
    };
    expect((await publishOverdue(racing, later(80 * HOUR))).published).toBe(0);
    expect(await one(`SELECT status, masked_body FROM review_replies WHERE id = $1`, [reply.replyId])).toEqual({
      status: "pending",
      masked_body: null,
    });
  });

  test("decideItem leaves hidden and pre-moderation removed items alone", async () => {
    const hidden = await review(CLEAN, "Lovely.");
    await db.query(`UPDATE reviews SET status = 'hidden' WHERE id = $1`, [hidden.reviewId]);
    const legacyRemoved = await review(CLEAN, "Bad.");
    await db.query(`UPDATE reviews SET status = 'removed' WHERE id = $1`, [legacyRemoved.reviewId]);
    for (const item of [hidden.item, legacyRemoved.item]) {
      expect(await decide(item, "kept", later(DAY), [])).toEqual({ ok: false, error: "not_found" });
    }
    expect(await reviewRow(hidden.reviewId)).toMatchObject({ status: "hidden", decided_at: null });
    expect(await reviewRow(legacyRemoved.reviewId)).toMatchObject({ status: "removed", decided_at: null });
  });

  // ── The app roles (0049): deleting closes every report ────────────────────

  /** Run `fn` as an app role for one user, as packages/authz/src/rls.db.test.ts does. */
  async function asApp<T>(role: "ob_web" | "ob_business", userId: string, fn: () => Promise<T>): Promise<T> {
    await db.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await db.query(`SET LOCAL ROLE ${role}`);
    const result = await fn();
    await db.query("RESET ROLE");
    await db.query(`SELECT set_config('app.user_id', '', true)`);
    return result;
  }
  /**
   * What 0049 sets up for the app roles, for this suite's tables. A database
   * rebuilt from a schema dump has the roles without their memberships (and,
   * locally, without these grants). Rolled back with the rest.
   */
  const grantAppRoles = () =>
    db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_web') THEN CREATE ROLE ob_web; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_business') THEN CREATE ROLE ob_business; END IF;
      GRANT ob_app TO ob_web, ob_business;
      EXECUTE format('GRANT ob_web, ob_business TO %I WITH INHERIT FALSE, SET TRUE', current_user);
      GRANT USAGE ON SCHEMA public, app TO ob_app;
      GRANT EXECUTE ON FUNCTION app.user_id(), app.readable_property_ids() TO ob_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON reviews, review_replies, review_reports TO ob_app;
    END $$`);

  test("as the app roles, a deleted reply and a deleted review close every open report, public ones included", async () => {
    await grantAppRoles();
    const published = await review(CLEAN, "Jan stole my bag.");
    const reply = await postReviewReply(db, {
      reviewId: published.reviewId,
      role: "host",
      authorUserId: hostId,
      body: "That is not true.",
      check: CLEAN,
      now: later(HOUR),
    });
    if (!reply.ok) throw new Error("reply failed");
    const onReply = [await report(published.reviewId, reply.replyId, "org-other"), await publicReport(published.reviewId, reply.replyId)];
    const onReview = [await report(published.reviewId, null, "org-other"), await publicReport(published.reviewId)];

    // The host deletes their reply: its reports close, the review's stay open.
    expect(await asApp("ob_business", hostId, () => deleteHostReply(db, { replyId: reply.replyId, now: later(DAY) }))).toMatchObject({
      ok: true,
    });
    for (const id of onReply) expect(await reportStatus(id)).toEqual({ status: "dismissed", decided: true });
    for (const id of onReview) expect(await reportStatus(id)).toEqual({ status: "open", decided: false });

    // The guest deletes their review: the rest close.
    expect(
      await asApp("ob_web", published.guestId, () =>
        deleteGuestReview(db, { bookingId: published.bookingId, guestUserId: published.guestId, now: later(2 * DAY) }),
      ),
    ).toBe(true);
    for (const id of onReview) expect(await reportStatus(id)).toEqual({ status: "dismissed", decided: true });
  });

  test("the dismissal function closes nothing for a stranger, or on an item that isn't deleted", async () => {
    await grantAppRoles();
    const published = await review(CLEAN, "Lovely.");
    const open = await publicReport(published.reviewId);
    const dismiss = () =>
      db.query(`SELECT app.dismiss_deleted_review_reports($1::uuid, NULL, $2) AS n`, [published.reviewId, later(DAY)]);

    // Not deleted: nothing to close, even for the guest.
    expect((await asApp("ob_web", published.guestId, dismiss)).rows[0]).toEqual({ n: 0 });
    await db.query(`UPDATE reviews SET status = 'deleted', score = NULL, body = NULL WHERE id = $1`, [published.reviewId]);
    // A stranger may not.
    await db.query("SAVEPOINT stranger");
    await expect(asApp("ob_web", `stranger-${crypto.randomUUID()}`, dismiss)).rejects.toThrow(/not allowed/);
    await db.query("ROLLBACK TO SAVEPOINT stranger");
    expect(await reportStatus(open)).toEqual({ status: "open", decided: false });
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

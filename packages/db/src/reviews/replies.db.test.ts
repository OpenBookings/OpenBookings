import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedGuest, seedProperty } from "../testing/db-harness";
import {
  deleteGuestReview,
  deleteHostReply,
  editHostReply,
  getReviewContext,
  insertPrivateReviewReply,
  loadPropertyReviews,
  postReviewReply,
  submitReview,
  type ReplyRole,
} from "./index";

const DAY = 86_400_000;
const CHECK_IN = "2031-11-10";
const CHECK_OUT_AT = Date.parse("2031-11-12T10:00:00Z");
const at = (ms: number) => new Date(CHECK_OUT_AT + ms);
const NOW = at(3 * DAY);

describeWithDb("review replies against Postgres", () => {
  let db: Client;
  let propertyId: string;
  let bookingId: string;
  let guestId: string;
  let hostId: string;
  let reviewId: string;

  const one = async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0] as T;
  // Each reply a minute after the last, as in real life: the thread is ordered by time.
  let tick = 0;
  const reply = (role: ReplyRole, extra: Partial<Parameters<typeof postReviewReply>[1]> = {}) =>
    postReviewReply(db, {
      reviewId,
      role,
      authorUserId: role === "host" ? hostId : guestId,
      body: role === "host" ? "Thank you for staying." : "Glad to.",
      flaggedReason: null,
      now: new Date(NOW.getTime() + ++tick * 60_000),
      ...extra,
    });
  const publicReplies = async () => (await loadPropertyReviews(db, propertyId, NOW)).reviews[0]?.replies ?? [];

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    tick = 0;
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    const ids = await seedProperty(db);
    propertyId = ids.propertyId;
    hostId = await seedGuest(db);
    await db.query(`UPDATE properties SET owner_user_id = $2 WHERE id = $1`, [propertyId, hostId]);
    ({ bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 }));
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    guestId = (await one<{ user_id: string }>(`SELECT user_id FROM bookings WHERE id = $1`, [bookingId])).user_id;
    await db.query(`UPDATE "user" SET name = 'Anna de Vries' WHERE id = $1`, [guestId]);
    const submitted = await submitReview(db, {
      bookingId,
      via: "session",
      score: 6,
      body: "Small room.",
      flaggedReason: null,
      now: at(2 * DAY),
    });
    if (!submitted.ok) throw new Error(`seed review failed: ${submitted.error}`);
    reviewId = submitted.reviewId;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("a host reply publishes and the guest may answer once", async () => {
    expect(await reply("host")).toMatchObject({ ok: true, status: "published", propertyId });
    expect(await reply("host")).toEqual({ ok: false, error: "not_your_turn" });
    expect(await reply("guest")).toMatchObject({ ok: true, status: "published" });
    expect(await reply("host")).toMatchObject({ ok: true });
    expect(await reply("guest")).toEqual({ ok: false, error: "thread_closed" });
    expect((await publicReplies()).map((r) => r.role)).toEqual(["host", "guest", "host"]);
  });

  test("a guest can't open the thread", async () => {
    expect(await reply("guest")).toEqual({ ok: false, error: "not_your_turn" });
  });

  test("a second host reply in a row is refused", async () => {
    expect((await reply("host")).ok).toBe(true);
    expect(await reply("host")).toEqual({ ok: false, error: "not_your_turn" });
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM review_replies WHERE review_id = $1`, [reviewId]);
    expect(n.n).toBe(1);
  });

  test("empty and over-long replies are invalid", async () => {
    expect(await reply("host", { body: "   " })).toEqual({ ok: false, error: "invalid" });
    expect(await reply("host", { body: "x".repeat(1001) })).toEqual({ ok: false, error: "invalid" });
    expect((await reply("host", { body: "x".repeat(1000) })).ok).toBe(true);
  });

  test("a flagged reply is held, not refused", async () => {
    expect(await reply("host", { flaggedReason: "url" })).toMatchObject({ ok: true, status: "pending" });
    expect(await publicReplies()).toEqual([]);
  });

  test("replies to a pending review show once it is published", async () => {
    await db.query(`UPDATE reviews SET status = 'pending', published_at = NULL WHERE id = $1`, [reviewId]);
    expect((await reply("host")).ok).toBe(true);
    expect(await loadPropertyReviews(db, propertyId, NOW)).toMatchObject({ reviews: [] });
    await db.query(`UPDATE reviews SET status = 'published', published_at = $2 WHERE id = $1`, [reviewId, NOW]);
    expect(await publicReplies()).toHaveLength(1);
  });

  test("editing marks the reply edited and re-screens it", async () => {
    const posted = await reply("host");
    if (!posted.ok) throw new Error("post failed");
    const later = new Date(NOW.getTime() + DAY);
    expect(
      await editHostReply(db, { replyId: posted.replyId, authorUserId: hostId, body: "Call +31 6 1234 5678", flaggedReason: "phone_number", now: later }),
    ).toEqual({ ok: true, status: "pending", propertyId });
    const row = await one<{ status: string; edited_at: Date; body: string }>(
      `SELECT status, edited_at, body FROM review_replies WHERE id = $1`,
      [posted.replyId],
    );
    expect(row.status).toBe("pending");
    expect(row.edited_at.toISOString()).toBe(later.toISOString());
    expect(row.body).toBe("Call +31 6 1234 5678");
  });

  test("a guest's answer can't be edited as a host reply", async () => {
    await reply("host");
    const answered = await reply("guest");
    if (!answered.ok) throw new Error("answer failed");
    expect(
      await editHostReply(db, { replyId: answered.replyId, authorUserId: hostId, body: "Changed", flaggedReason: null, now: NOW }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  test("only the latest reply can be deleted, and the host may then reply again", async () => {
    const first = await reply("host");
    await reply("guest");
    if (!first.ok) throw new Error("post failed");
    expect(await deleteHostReply(db, { replyId: first.replyId, now: NOW })).toEqual({ ok: false, error: "not_last" });
    const last = await reply("host");
    if (!last.ok) throw new Error("post failed");
    expect(await deleteHostReply(db, { replyId: last.replyId, now: NOW })).toEqual({ ok: true, propertyId });
    const row = await one<{ status: string; body: string | null }>(`SELECT status, body FROM review_replies WHERE id = $1`, [last.replyId]);
    expect(row).toEqual({ status: "deleted", body: null });
    expect((await reply("host")).ok).toBe(true);
  });

  test("a deleted review closes the thread", async () => {
    await reply("host");
    await deleteGuestReview(db, { bookingId, guestUserId: guestId, now: NOW });
    expect(await reply("guest")).toEqual({ ok: false, error: "review_deleted" });
    expect(await loadPropertyReviews(db, propertyId, NOW)).toMatchObject({ reviews: [] });
  });

  test("the guest sees published replies and their own held answer", async () => {
    await reply("host");
    await reply("guest", { flaggedReason: "url" });
    const context = await getReviewContext(db, bookingId, NOW);
    expect(context?.review?.replies.map((r) => [r.role, r.status])).toEqual([
      ["host", "published"],
      ["guest", "pending"],
    ]);
    expect(await publicReplies()).toHaveLength(1);
  });

  test("a private reply lands in the booking's conversation", async () => {
    const first = await insertPrivateReviewReply(db, { reviewId, senderUserId: hostId, body: "Sorry about the room.", flaggedReason: null, now: NOW });
    expect(first).toMatchObject({ ok: true, guestUserId: guestId });
    if (!first.ok) throw new Error("private reply failed");
    const thread = await one<{ booking_id: string; host_id: string; guest_id: string }>(
      `SELECT booking_id, host_id, guest_id FROM message_threads WHERE id = $1`,
      [first.threadId],
    );
    expect(thread).toEqual({ booking_id: bookingId, host_id: hostId, guest_id: guestId });
    expect(first.message).toMatchObject({ review_id: reviewId, sender_role: "host", sender_id: hostId, body: "Sorry about the room." });
    const second = await insertPrivateReviewReply(db, { reviewId, senderUserId: hostId, body: "One more thing.", flaggedReason: null, now: NOW });
    expect(second.ok && second.threadId).toBe(first.threadId);
  });

  test("a private reply needs a property owner to address the thread", async () => {
    await db.query(`UPDATE properties SET owner_user_id = NULL WHERE id = $1`, [propertyId]);
    expect(
      await insertPrivateReviewReply(db, { reviewId, senderUserId: hostId, body: "Hello", flaggedReason: null, now: NOW }),
    ).toEqual({ ok: false, error: "no_thread_host" });
  });
});

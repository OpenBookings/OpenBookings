import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "../testing/db-harness";
import {
  anonymizeGuestReviews,
  bookingForReviewToken,
  createReviewToken,
  deleteGuestReview,
  getReviewContext,
  loadPropertyReviews,
  runReviewInvitations,
  setReviewEmails,
  submitReview,
  type ReviewMail,
} from "./index";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Check-in 10 Nov 2031, two nights; the property checks out at 11:00 Amsterdam (10:00 UTC).
const CHECK_IN = "2031-11-10";
const CHECK_OUT_AT = Date.parse("2031-11-12T10:00:00Z");
const at = (ms: number) => new Date(CHECK_OUT_AT + ms);

describeWithDb("guest reviews against Postgres", () => {
  let db: Client;
  let ids: Awaited<ReturnType<typeof seedProperty>>;
  let bookingId: string;
  let guestId: string;

  const one = async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0] as T;

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
    ({ bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 }));
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    guestId = (await one<{ user_id: string }>(`SELECT user_id FROM bookings WHERE id = $1`, [bookingId])).user_id;
    await db.query(`UPDATE "user" SET name = 'Anna de Vries' WHERE id = $1`, [guestId]);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const submit = (now: Date, extra: Partial<Parameters<typeof submitReview>[1]> = {}) =>
    submitReview(db, { bookingId, via: "session", score: 9, body: "Lovely stay.", flaggedReason: null, now, ...extra });

  test("a stay opens for review 24 hours after check-out, without being marked as checked in", async () => {
    expect(await submit(at(DAY - 1))).toEqual({ ok: false, error: "too_early" });
    const result = await submit(at(DAY));
    expect(result.ok).toBe(true);
    const row = await one<Record<string, unknown>>(`SELECT * FROM reviews WHERE booking_id = $1`, [bookingId]);
    expect(row).toMatchObject({
      score: 9,
      body: "Lovely stay.",
      author_name: "Anna",
      status: "published",
      room_label: "Double",
      submitted_via: "session",
    });
    expect((row.stay_month as Date).toISOString().slice(0, 10)).toBe("2031-11-01");
  });

  test("one review per booking", async () => {
    expect((await submit(at(2 * DAY))).ok).toBe(true);
    expect(await submit(at(2 * DAY))).toEqual({ ok: false, error: "already_reviewed" });
  });

  test("a no-show can't be reviewed", async () => {
    await db.query(`UPDATE bookings SET status = 'no_show', no_show_reported_at = $2 WHERE id = $1`, [bookingId, at(0)]);
    expect(await submit(at(2 * DAY))).toEqual({ ok: false, error: "no_show" });
  });

  test("a flagged review waits for a person instead of publishing", async () => {
    const result = await submit(at(2 * DAY), { flaggedReason: "url" });
    expect(result).toMatchObject({ ok: true, status: "pending" });
    expect(await one(`SELECT status, published_at FROM reviews WHERE booking_id = $1`, [bookingId])).toEqual({
      status: "pending",
      published_at: null,
    });
  });

  test("rejects scores outside 1–10 and over-long text", async () => {
    expect(await submit(at(2 * DAY), { score: 0 })).toEqual({ ok: false, error: "invalid" });
    expect(await submit(at(2 * DAY), { score: 7.5 })).toEqual({ ok: false, error: "invalid" });
    expect(await submit(at(2 * DAY), { body: "x".repeat(2001) })).toEqual({ ok: false, error: "invalid" });
  });

  test("an emailed token finds its booking until it expires, and is spent by the review", async () => {
    const token = await createReviewToken(db, bookingId, at(30 * DAY));
    expect(await bookingForReviewToken(db, token, at(2 * DAY))).toBe(bookingId);
    expect(await bookingForReviewToken(db, token, at(31 * DAY))).toBeNull();
    expect(await bookingForReviewToken(db, "not-a-token", at(2 * DAY))).toBeNull();
    expect((await submit(at(2 * DAY), { via: "token" })).ok).toBe(true);
    expect(await bookingForReviewToken(db, token, at(2 * DAY))).toBeNull();
  });

  test("the author can delete a review, and the booking stays reviewed", async () => {
    await submit(at(2 * DAY));
    expect(await deleteGuestReview(db, { bookingId, guestUserId: "someone-else", now: at(3 * DAY) })).toBe(false);
    expect(await deleteGuestReview(db, { bookingId, guestUserId: guestId, now: at(3 * DAY) })).toBe(true);
    expect(await one(`SELECT status, score, body FROM reviews WHERE booking_id = $1`, [bookingId])).toEqual({
      status: "deleted",
      score: null,
      body: null,
    });
    expect(await submit(at(3 * DAY))).toEqual({ ok: false, error: "already_reviewed" });
  });

  test("account deletion anonymizes the review", async () => {
    await submit(at(2 * DAY));
    expect(await anonymizeGuestReviews(db, guestId)).toBe(1);
    expect(await one(`SELECT guest_user_id, author_name FROM reviews WHERE booking_id = $1`, [bookingId])).toEqual({
      guest_user_id: null,
      author_name: "Former guest",
    });
  });

  test("the property page lists published reviews and averages from three", async () => {
    await submit(at(2 * DAY), { score: 8 });
    let page = await loadPropertyReviews(db, ids.propertyId, at(3 * DAY));
    expect(page).toMatchObject({ recentCount: 1, average: null });
    for (const score of [10, 9]) {
      const { bookingId: other } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
      await db.query(`UPDATE bookings SET status = 'checked_in' WHERE id = $1`, [other]);
      await submitReview(db, { bookingId: other, via: "session", score, body: null, flaggedReason: null, now: at(2 * DAY) });
    }
    page = await loadPropertyReviews(db, ids.propertyId, at(3 * DAY));
    expect(page.recentCount).toBe(3);
    expect(page.total).toBe(3);
    expect(page.average).toBe(9);
    expect(page.reviews[0]!.body).toBe("Lovely stay."); // text first
  });

  describe("the invitation job", () => {
    let sent: ReviewMail[];
    const run = (now: Date, send?: (m: ReviewMail) => Promise<void>) =>
      runReviewInvitations({
        db,
        now,
        testing: true,
        send:
          send ??
          (async (m) => {
            sent.push(m);
          }),
      });

    beforeEach(() => {
      sent = [];
    });

    test("warns the host at check-out about stays never marked as arrived, once", async () => {
      expect(await run(at(-HOUR))).toMatchObject({ hostWarnings: 0 });
      expect(await run(at(HOUR))).toMatchObject({ hostWarnings: 1, invitations: 0 });
      expect(sent[0]).toMatchObject({ kind: "host_warning", propertyId: ids.propertyId });
      expect(await run(at(2 * HOUR))).toMatchObject({ hostWarnings: 0 });
    });

    test("does not warn about stays that were marked as arrived", async () => {
      await db.query(`UPDATE bookings SET status = 'checked_in' WHERE id = $1`, [bookingId]);
      expect(await run(at(HOUR))).toMatchObject({ hostWarnings: 0 });
    });

    test("invites the guest 24 hours after check-out, once, with a working link", async () => {
      expect(await run(at(DAY - HOUR))).toMatchObject({ invitations: 0 });
      expect(await run(at(DAY))).toMatchObject({ invitations: 1 });
      const mail = sent.find((m) => m.kind === "invitation");
      expect(mail).toMatchObject({ kind: "invitation", bookingId, guestFirstName: "Anna" });
      if (mail?.kind !== "invitation") throw new Error("no invitation");
      expect(await bookingForReviewToken(db, mail.token, at(DAY))).toBe(bookingId);
      expect(await run(at(DAY + HOUR))).toMatchObject({ invitations: 0 });
    });

    test("waits for daytime on the property's clock", async () => {
      // 23:00 Amsterdam: not a time to email anyone.
      await db.query(`UPDATE properties SET check_out_time = '23:00' WHERE id = $1`, [ids.propertyId]);
      const lateCheckOut = Date.parse("2031-11-12T22:00:00Z");
      expect(await run(new Date(lateCheckOut + DAY))).toMatchObject({ invitations: 0 });
      expect(await run(new Date(lateCheckOut + DAY + 10 * HOUR))).toMatchObject({ invitations: 1 }); // 09:00
    });

    test("skips no-shows, reviewed stays and guests who opted out", async () => {
      await setReviewEmails(db, guestId, false, at(0));
      expect(await run(at(DAY))).toMatchObject({ invitations: 0 });
      await setReviewEmails(db, guestId, true, at(0));
      await db.query(`UPDATE bookings SET status = 'no_show', no_show_reported_at = $2 WHERE id = $1`, [bookingId, at(0)]);
      expect(await run(at(DAY))).toMatchObject({ invitations: 0 });
    });

    test("reminds once, six days after the invitation, unless reviewed", async () => {
      await run(at(DAY));
      expect(await run(at(DAY + 6 * DAY - HOUR))).toMatchObject({ reminders: 0 });
      expect(await run(at(DAY + 6 * DAY))).toMatchObject({ reminders: 1 });
      expect(await run(at(DAY + 6 * DAY + HOUR))).toMatchObject({ reminders: 0 });
    });

    test("no reminder once the guest has reviewed", async () => {
      await run(at(DAY));
      await submit(at(2 * DAY));
      expect(await run(at(7 * DAY))).toMatchObject({ reminders: 0 });
    });

    test("a failed send is retried on the next run, and its link removed", async () => {
      const result = await run(at(DAY), async (m) => {
        if (m.kind === "invitation") throw new Error("mail provider down");
      });
      expect(result).toMatchObject({ invitations: 0, failed: 1 });
      expect(await one(`SELECT count(*)::int AS n FROM review_tokens WHERE booking_id = $1`, [bookingId])).toEqual({ n: 0 });
      expect(await one(`SELECT attempts, last_error, sent_at FROM review_invitations WHERE booking_id = $1`, [bookingId])).toEqual({
        attempts: 1,
        last_error: "mail provider down",
        sent_at: null,
      });
      expect(await run(at(DAY + HOUR))).toMatchObject({ invitations: 1 });
    });

    test("invites stays that ended before the job existed, while their window is open", async () => {
      expect(await run(at(20 * DAY))).toMatchObject({ invitations: 1 });
      sent = [];
      const { bookingId: old } = await seedBooking(db, ids, { checkIn: "2031-10-01", nights: 2 });
      await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [old]);
      expect(await run(at(20 * DAY))).toMatchObject({ invitations: 0 }); // checked out 42 days earlier
    });

    test("the review context reflects the window", async () => {
      expect((await getReviewContext(db, bookingId, at(2 * DAY)))?.eligibility.ok).toBe(true);
      expect((await getReviewContext(db, bookingId, at(31 * DAY)))?.eligibility).toEqual({ ok: false, reason: "window_closed" });
    });
  });
});

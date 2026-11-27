/**
 * The host reviews query against a real Postgres: which reviews a team
 * member sees, with their threads. Same harness as the reservations suite:
 * a throwaway Neon branch in CI, rolled back per test, skipped locally
 * without DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import type { SessionLike } from "@openbookings/authz";
import { applyPendingMigrations } from "@/app/(dashboard)/dashboard/listings/_lib/pending-migrations";
import { countReviewsNeedingReply, loadHostReviews } from "./query";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.CI) {
  throw new Error("DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.");
}
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb("loadHostReviews against Postgres", () => {
  let db: Client;
  let owner: string;
  let stranger: string;
  let guest: string;
  let propertyId: string;

  const session = (id: string): SessionLike => ({ user: { id, account_type: "business" } });
  /** getPropertyScopedDb's shape, bound to this transaction and the test property. */
  const propertyDb = (s: SessionLike) => ({
    query: async <T,>(sql: string, values: unknown[] = []) =>
      (await db.query(sql, [s.user.id, propertyId, ...values])).rows as T[],
  });
  const one = async (sql: string, values: unknown[]) => (await db.query(sql, values)).rows[0] as { id: string };

  async function createUser(accountType: "private" | "business", name = "Emma Test") {
    const id = `test-${accountType}-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, $2, $3, true, $4::account_type)`,
      [id, name, `${id}@example.test`, accountType],
    );
    return id;
  }

  async function addReview(status: string, score = 8, body: string | null = "Lovely.") {
    const bookingId = (
      await one(
        `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, rooms_total_cents, total_cents)
         VALUES ($1, $2, CURRENT_DATE - 10, CURRENT_DATE - 8, 'confirmed', 40000, 40000) RETURNING id`,
        [propertyId, guest],
      )
    ).id;
    return (
      await one(
        `INSERT INTO reviews (booking_id, property_id, guest_user_id, score, body, author_name, author_country,
                              stay_month, room_label, status, submitted_via, published_at)
         VALUES ($1, $2, $3, $4, $5, 'Anna', 'NL', date_trunc('month', CURRENT_DATE)::date, 'Deluxe', $6, 'session',
                 CASE WHEN $6 = 'published' THEN NOW() END)
         RETURNING id`,
        [bookingId, propertyId, guest, status === "deleted" ? null : score, status === "deleted" ? null : body, status],
      )
    ).id;
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
    owner = await createUser("business");
    stranger = await createUser("business");
    guest = await createUser("private", "Anna de Vries");
    propertyId = (
      await one(
        `INSERT INTO properties (name, slug, address_line_1, city, country, timezone, location,
           check_in_time, check_out_time, owner_user_id, is_active, cancellation_tier)
         VALUES ('Canal House', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
                 ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326), '15:00', '11:00', $2, true, 'flex')
         RETURNING id`,
        [`test-property-${crypto.randomUUID()}`, owner],
      )
    ).id;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("the owner sees published and pending reviews, with replies and private replies", async () => {
    const published = await addReview("published", 6);
    const pending = await addReview("pending", 9);
    await db.query(
      `INSERT INTO review_replies (review_id, author_role, author_user_id, body, status, published_at, created_at)
       VALUES ($1, 'host', $2, 'Thanks', 'published', NOW() - interval '2 minutes', NOW() - interval '2 minutes'),
              ($1, 'guest', $3, 'Welcome', 'published', NOW() - interval '1 minute', NOW() - interval '1 minute')`,
      [published, owner, guest],
    );
    const thread = await one(
      `INSERT INTO message_threads (booking_id, property_id, host_id, guest_id)
       SELECT booking_id, property_id, $2, $3 FROM reviews WHERE id = $1 RETURNING id`,
      [pending, owner, guest],
    );
    await db.query(`INSERT INTO messages (thread_id, sender_id, sender_role, body, review_id) VALUES ($1, $2, 'host', 'Hi', $3)`, [
      thread.id,
      owner,
      pending,
    ]);

    const list = await loadHostReviews(session(owner), propertyId, propertyDb(session(owner)));
    const a = list.find((r) => r.id === published);
    const b = list.find((r) => r.id === pending);
    expect(a).toMatchObject({ status: "published", score: 6, propertyName: "Canal House", authorName: "Anna", nextRole: "host", privateReplyAt: null });
    expect(a?.replies.map((r) => r.role)).toEqual(["host", "guest"]);
    expect(b).toMatchObject({ status: "pending", nextRole: "host" });
    expect(b?.privateReplyAt).not.toBeNull();
  });

  test("a stranger sees nothing", async () => {
    await addReview("published");
    expect(await loadHostReviews(session(stranger), propertyId, propertyDb(session(stranger)))).toEqual([]);
  });

  test("a front-desk member without access to the property sees nothing", async () => {
    await addReview("published");
    const orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $1 WHERE id = $2`, [orgId, propertyId]);
    await db.query(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, 'frontdesk', NOW())`,
      [orgId, stranger],
    );
    expect(await loadHostReviews(session(stranger), propertyId, propertyDb(session(stranger)), false)).toEqual([]);
  });

  test("deleted and hidden reviews are left out", async () => {
    await addReview("deleted");
    await addReview("hidden");
    expect(await loadHostReviews(session(owner), propertyId, propertyDb(session(owner)))).toEqual([]);
  });

  test("the property's own report shows: being checked, upheld (the removed review stays listed) or not upheld", async () => {
    const orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $1 WHERE id = $2`, [orgId, propertyId]);
    await db.query(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, 'owner', NOW())`,
      [orgId, owner],
    );
    const hostReport = (reviewId: string, status: string, decidedAt: string | null, org: string | null = orgId) =>
      db.query(
        `INSERT INTO review_reports (review_id, reporter_kind, reporter_user_id, reporter_org_id, rule, status, decided_at, created_at)
         VALUES ($1, 'host', $2, $3, 'abuse', $4, $5::timestamptz, NOW() - interval '1 day')`,
        [reviewId, owner, org, status, decidedAt],
      );
    const decide = (reviewId: string, status: string, decision: string, at: string) =>
      db.query(`UPDATE reviews SET status = $2, decision = $3, decided_by = 'staff', decided_at = $4::timestamptz WHERE id = $1`, [
        reviewId,
        status,
        decision,
        at,
      ]);

    const open = await addReview("published");
    await hostReport(open, "open", null);
    const upheld = await addReview("published");
    await decide(upheld, "removed", "removed", "2031-01-02T10:00:00Z");
    await hostReport(upheld, "upheld", "2031-01-02T10:00:00Z");
    const kept = await addReview("published");
    await decide(kept, "published", "kept", "2031-01-02T10:00:00Z");
    await hostReport(kept, "dismissed", "2031-01-02T10:00:00Z");
    // Removed without the property's report (another organization's, or the public's): not listed.
    const removedByOthers = await addReview("published");
    await decide(removedByOthers, "removed", "removed", "2031-01-02T10:00:00Z");
    await hostReport(removedByOthers, "upheld", "2031-01-02T10:00:00Z", null);
    // An old outcome a later decision (a rewrite cleared it) no longer counts.
    const rewritten = await addReview("pending");
    await hostReport(rewritten, "upheld", "2031-01-01T10:00:00Z");

    const list = await loadHostReviews(session(owner), propertyId, propertyDb(session(owner)));
    const byId = (id: string) => list.find((r) => r.id === id);
    expect(byId(open)).toMatchObject({ status: "published", report: "open" });
    expect(byId(upheld)).toMatchObject({ status: "removed", report: "upheld" });
    expect(byId(kept)).toMatchObject({ status: "published", report: "dismissed" });
    expect(byId(removedByOthers)).toBeUndefined();
    expect(byId(rewritten)).toMatchObject({ status: "pending", report: null });
  });

  test("the property's reports on guests' answers show by reply, a removed one's outcome included", async () => {
    const reviewId = await addReview("published");
    const answer = async (status: string, decidedAt: string | null) =>
      (
        await one(
          `INSERT INTO review_replies (review_id, author_role, author_user_id, body, status, published_at, decision, decided_at)
           VALUES ($1, 'guest', $2, 'Not true.', $3, NOW(), CASE WHEN $4::timestamptz IS NULL THEN NULL WHEN $3 = 'removed' THEN 'removed' ELSE 'kept' END, $4::timestamptz)
           RETURNING id`,
          [reviewId, guest, status, decidedAt],
        )
      ).id;
    const report = (replyId: string, status: string, decidedAt: string | null) =>
      db.query(
        `INSERT INTO review_reports (review_id, reply_id, reporter_kind, reporter_user_id, rule, status, decided_at)
         VALUES ($1, $2, 'host', $3, 'abuse', $4, $5::timestamptz)`,
        [reviewId, replyId, owner, status, decidedAt],
      );
    const open = await answer("published", null);
    await report(open, "open", null);
    const removed = await answer("removed", "2031-01-02T10:00:00Z");
    await report(removed, "upheld", "2031-01-02T10:00:00Z");

    const [listed] = await loadHostReviews(session(owner), propertyId, propertyDb(session(owner)));
    expect(listed?.replyReports).toEqual({ [open]: "open", [removed]: "upheld" });
    expect(listed?.replies.map((r) => r.id)).toEqual([open]);
  });

  test("the host's own replies carry what moderation did; a removed one stays in the thread and keeps its turn", async () => {
    const removedOn = await addReview("published");
    const removedReply = (
      await one(
        `INSERT INTO review_replies (review_id, author_role, author_user_id, body, status, flagged_reason, decision, decision_rules,
                                     decision_note, decided_at, created_at)
         VALUES ($1, 'host', $2, 'Call Jan Jansen.', 'removed', 'personal_details', 'removed', '{personal_details,abuse}',
                 'First names only.', '2031-01-02T10:00:00Z', '2031-01-01T10:00:00Z')
         RETURNING id`,
        [removedOn, owner],
      )
    ).id;
    const maskedOn = await addReview("published");
    await db.query(
      `INSERT INTO review_replies (review_id, author_role, author_user_id, body, masked_body, status, flagged_reason,
                                   published_by_deadline, published_at, created_at)
       VALUES ($1, 'host', $2, 'Thanks, Jan Jansen.', 'Thanks, [removed].', 'published', 'personal_details', true, NOW(), NOW() - interval '4 days'),
              ($1, 'guest', $3, 'You too.', NULL, 'published', NULL, false, NOW(), NOW())`,
      [maskedOn, owner, guest],
    );

    const list = await loadHostReviews(session(owner), propertyId, propertyDb(session(owner)));
    const removed = list.find((r) => r.id === removedOn);
    expect(removed).toMatchObject({ timeZone: "Europe/Amsterdam", nextRole: "guest" });
    expect(removed?.replies).toEqual([
      expect.objectContaining({
        id: removedReply,
        role: "host",
        status: "removed",
        moderation: expect.objectContaining({
          written: "Call Jan Jansen.",
          decision: "removed",
          decisionRules: ["personal_details", "abuse"],
          decisionNote: "First names only.",
          decidedAt: "2031-01-02T10:00:00.000Z",
          heldSince: "2031-01-01T10:00:00.000Z",
        }),
      }),
    ]);

    const masked = list.find((r) => r.id === maskedOn);
    expect(masked?.replies.map((r) => [r.role, r.body, r.moderation?.maskedBody ?? null, r.moderation?.written ?? null])).toEqual([
      ["host", "Thanks, [removed].", "Thanks, [removed].", "Thanks, Jan Jansen."],
      // The guest's answer is theirs: no moderation details, never the original.
      ["guest", "You too.", null, null],
    ]);
    expect(masked?.replies[0]?.moderation).toMatchObject({ publishedByDeadline: true, flaggedRules: ["personal_details"] });
  });

  test("countReviewsNeedingReply counts the open ones", async () => {
    await addReview("published");
    await addReview("published");
    const replied = await addReview("published");
    await addReview("pending");
    await db.query(
      `INSERT INTO review_replies (review_id, author_role, author_user_id, body, status, published_at) VALUES ($1, 'host', $2, 'Thanks', 'published', NOW())`,
      [replied, owner],
    );
    expect(await countReviewsNeedingReply(session(owner), propertyId, propertyDb(session(owner)))).toBe(2);
  });
});

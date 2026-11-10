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
  const hostDb = (s: SessionLike) => ({
    query: async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, [s.user.id, ...values])).rows as T[],
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
        `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, total_amount)
         VALUES ($1, $2, CURRENT_DATE - 10, CURRENT_DATE - 8, 'confirmed', 400) RETURNING id`,
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

    const list = await loadHostReviews(session(owner), hostDb(session(owner)));
    const a = list.find((r) => r.id === published);
    const b = list.find((r) => r.id === pending);
    expect(a).toMatchObject({ status: "published", score: 6, propertyName: "Canal House", authorName: "Anna", nextRole: "host", privateReplyAt: null });
    expect(a?.replies.map((r) => r.role)).toEqual(["host", "guest"]);
    expect(b).toMatchObject({ status: "pending", nextRole: "host" });
    expect(b?.privateReplyAt).not.toBeNull();
  });

  test("a stranger sees nothing", async () => {
    await addReview("published");
    expect(await loadHostReviews(session(stranger), hostDb(session(stranger)))).toEqual([]);
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
    expect(await loadHostReviews(session(stranger), hostDb(session(stranger)), false)).toEqual([]);
  });

  test("deleted and hidden reviews are left out", async () => {
    await addReview("deleted");
    await addReview("hidden");
    expect(await loadHostReviews(session(owner), hostDb(session(owner)))).toEqual([]);
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
    expect(await countReviewsNeedingReply(session(owner), hostDb(session(owner)))).toBe(2);
  });
});

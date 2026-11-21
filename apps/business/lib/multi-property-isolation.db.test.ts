/**
 * One hotel never shows another's data, against a real Postgres, through the
 * console's own loaders.
 *
 * User U is front desk in org X (assigned hotel X1) and manager in org Y
 * (assigned hotel Y1). Every hotel and org has its own booking, review, guest
 * thread (both stamped for U), room, rate plan, pricing rule, invoice,
 * support ticket and second member. The current hotel comes from the session
 * row (currentPropertyFor), exactly as the pages get it, and the session's
 * cookie-side `activeOrganizationId` is deliberately left on the *other* org,
 * as it can be for up to a minute after a switch.
 *
 * @openbookings/db's query/queryOne are pointed at this test's transaction,
 * so the real getPropertyScopedDb / getOrgScopedDb run the real SQL; each
 * test is rolled back. The resolver itself is covered in
 * packages/authz/src/current-property.db.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedGuest, seedProperty } from "@openbookings/db/testing";
import { mockModules } from "@/lib/mock-modules";

let db: Client;

const realDb = await import("@openbookings/db");
await mockModules(import.meta.dir, {
  "@openbookings/db": () => ({
    ...realDb,
    query: async (text: string, values: unknown[] = []) => (await run(text, values)).rows,
    queryOne: async (text: string, values: unknown[] = []) => (await run(text, values)).rows[0] ?? null,
  }),
});

/** One client, so the loaders' parallel queries take turns (pg warns on overlap). */
let queue: Promise<unknown> = Promise.resolve();
function run(text: string, values: unknown[]) {
  const result = queue.then(() => db.query(text, values));
  queue = result.catch(() => undefined);
  return result;
}

const { setCurrentProperty } = await import("@openbookings/authz");
const { currentPropertyFor } = await import("./current-property");
const { loadHostReservations } = await import("./reservations/query");
const { loadHostReviews } = await import("./reviews/query");
const { loadThreads } = await import("../app/(dashboard)/dashboard/bookings/messages/_lib/threads");
const { loadEditorData } = await import("../app/(dashboard)/dashboard/listings/property/_lib/query");
const { loadRoomsIndex, loadRoomEditor } = await import("../app/(dashboard)/dashboard/listings/rooms/_lib/query");
const { loadPricingRules, loadRuleGroup } = await import("../app/(dashboard)/dashboard/listings/pricing-rules/_lib/query");
const { loadAriGrid } = await import("../app/(dashboard)/dashboard/listings/rates-availability/_lib/ari-query");
const { billingAccess } = await import("./billing/scope");
const { listInvoices } = await import("./billing/queries");
const { teamScope, loadTeam } = await import("./team/server");
const { supportScope, listTickets, searchLinkables, defaultPropertyId } = await import("./support/server/tickets");

const CHECK_IN = "2031-03-10";

/** Everything seeded for one org and its one hotel: every id a screen could leak. */
type Side = {
  orgId: string;
  propertyId: string;
  roomId: string;
  ratePlanId: string;
  bookingId: string;
  reviewId: string;
  threadId: string;
  ruleGroupId: string;
  invoiceNumber: string;
  ticketId: string;
  colleagueMemberId: string;
  hotelName: string;
};

describeWithDb("one hotel at a time, through the console's loaders", () => {
  let u: string;
  let sessionId: string;
  let x: Side;
  let y: Side;
  let seq = 900;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const one = async (sql: string, values: unknown[]) => (await db.query(sql, values)).rows[0] as { id: string };

  async function user(name: string): Promise<string> {
    const id = `test-iso-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, $2, $3, true, 'business'::account_type)`,
      [id, name, `${id}@example.test`],
    );
    return id;
  }

  async function member(orgId: string, userId: string, role: string, propertyIds: string[]): Promise<string> {
    const id = `test-iso-member-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`,
      [id, orgId, userId, role],
    );
    for (const propertyId of propertyIds) {
      await db.query(`INSERT INTO property_access (member_id, property_id) VALUES ($1, $2)`, [id, propertyId]);
    }
    return id;
  }

  /** One org with one hotel and one of everything, U a `role` member assigned to the hotel. */
  async function side(orgName: string, hotelName: string, role: string): Promise<Side> {
    const orgId = `test-iso-org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $1, now())`, [orgId, orgName]);
    const ids = await seedProperty(db);
    await db.query(`UPDATE properties SET organization_id = $2, name = $3 WHERE id = $1`, [ids.propertyId, orgId, hotelName]);
    await member(orgId, u, role, [ids.propertyId]);
    const colleague = await user(`${orgName} Owner`);
    const colleagueMemberId = await member(orgId, colleague, "owner", []);

    const guest = await seedGuest(db);
    const { bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2, userId: guest });
    await realDb.confirmBookingPolicy(db, { bookingId, confirmedAt: new Date() });
    await db.query(`UPDATE bookings SET status = 'completed' WHERE id = $1`, [bookingId]);

    const reviewId = (
      await one(
        `INSERT INTO reviews (booking_id, property_id, guest_user_id, score, body, author_name, author_country,
                              stay_month, room_label, status, submitted_via, published_at)
         VALUES ($1, $2, $3, 9, 'Lovely stay', 'Anna', 'NL', date_trunc('month', CURRENT_DATE)::date, 'Double',
                 'published', 'session', now())
         RETURNING id`,
        [bookingId, ids.propertyId, guest],
      )
    ).id;
    // Threads are stamped for U at both hotels: only the hotel scope keeps them apart.
    const threadId = (
      await one(
        `INSERT INTO message_threads (booking_id, property_id, host_id, guest_id, status)
         VALUES ($1, $2, $3, $4, 'open') RETURNING id`,
        [bookingId, ids.propertyId, u, guest],
      )
    ).id;
    await db.query(
      `INSERT INTO messages (thread_id, sender_id, sender_role, body) VALUES ($1, $2, 'guest', 'Hello from ${hotelName}')`,
      [threadId, guest],
    );
    const ruleGroupId = (
      await one(
        `INSERT INTO rate_modifiers (rate_plan_id, type, trigger_condition, adjustment_type, adjustment_value)
         VALUES ($1, 'day_of_week', '{"days_of_week": [5, 6]}', 'flat', 30) RETURNING rule_group_id AS id`,
        [ids.ratePlanId],
      )
    ).id;

    seq += 1;
    // OB-2099: never a real series (see billing/queries.db.test.ts).
    const invoiceNumber = `OB-2099-${String(seq).padStart(4, "0")}`;
    await db.query(
      `INSERT INTO invoices (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number,
         issued_on, seller, buyer, vat_treatment, vat_rate_bp, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
       VALUES ($1, '2099-10-01', '2099-10-31', 'invoice', 'issued', 'OB-2099', $2, $3, '2099-11-05', '{}'::jsonb, '{}'::jsonb,
               'NL_DOMESTIC', 2100, 893, 187, 1080, 187, 0)`,
      [orgId, seq, invoiceNumber],
    );
    const ticketId = (
      await one(
        `INSERT INTO support_tickets (organization_id, property_id, opened_by_user_id, chatwoot_conversation_id,
                                      category, title, status)
         VALUES ($1, $2, $3, $4, 'other', $5, 'open') RETURNING id`,
        [orgId, ids.propertyId, u, 990_000_000 + seq, `Question about ${hotelName}`],
      )
    ).id;

    return {
      orgId,
      ...ids,
      bookingId,
      reviewId,
      threadId,
      ruleGroupId,
      invoiceNumber,
      ticketId,
      colleagueMemberId,
      hotelName,
    };
  }

  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    u = await user("Uma Frontdesk");
    x = await side("Alpha Hotels", "Hotel Xanadu", "frontdesk");
    y = await side("Bravo Hotels", "Hotel Yonder", "manager");
    sessionId = `test-iso-session-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "session" (id, "expiresAt", token, "updatedAt", "userId")
       VALUES ($1, now() + interval '1 day', $1, now(), $2)`,
      [sessionId, u],
    );
  });

  /** The session as the console holds it; the cookie's active org is the given (possibly stale) one. */
  const session = (cookieOrg: string) => ({
    user: { id: u, email: `${u}@example.test`, name: "Uma Frontdesk", account_type: "business" },
    session: { id: sessionId, activeOrganizationId: cookieOrg },
  });

  /** Every id and name of `theirs` that could appear on a screen. */
  const leakables = (s: Side) => [
    s.orgId,
    s.propertyId,
    s.roomId,
    s.ratePlanId,
    s.bookingId,
    s.reviewId,
    s.threadId,
    s.ruleGroupId,
    s.invoiceNumber,
    s.ticketId,
    s.colleagueMemberId,
    s.hotelName,
  ];

  /** Everything a loader returned, as text (the editor carries bigint cents). */
  const text = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "";

  function expectNone(label: string, value: unknown, theirs: Side) {
    const all = text(value);
    for (const id of leakables(theirs)) {
      if (all.includes(id)) throw new Error(`${label} shows ${id} of the other org`);
    }
  }

  /** Load every screen on the current hotel and check it shows `mine` and nothing of `theirs`. */
  async function expectOnly(mine: Side, theirs: Side) {
    const s = session(theirs.orgId);
    const current = await currentPropertyFor(s);
    expect(current).toMatchObject({ propertyId: mine.propertyId, organizationId: mine.orgId });
    const pid = current!.propertyId;

    const reservations = await loadHostReservations(s, pid);
    expect(reservations.map((r) => r.id)).toEqual([mine.bookingId]);
    expectNone("reservations", reservations, theirs);

    const reviews = await loadHostReviews(s, pid);
    expect(reviews.map((r) => r.id)).toEqual([mine.reviewId]);
    expectNone("reviews", reviews, theirs);

    const threads = await loadThreads(s, pid);
    expect(threads.map((t) => t.id)).toEqual([mine.threadId]);
    expectNone("messages", threads, theirs);

    const editor = await loadEditorData(s, pid);
    expect(editor?.property.id).toBe(mine.propertyId);
    expectNone("property editor", editor, theirs);

    const rooms = await loadRoomsIndex(s, pid);
    expect(rooms?.property.id).toBe(mine.propertyId);
    expect(text(rooms)).toContain(mine.roomId);
    expectNone("rooms", rooms, theirs);
    expect(await loadRoomEditor(s, pid, mine.roomId)).not.toBeNull();
    expect(await loadRoomEditor(s, pid, theirs.roomId)).toBeNull();

    const ari = await loadAriGrid(s, pid, { start: "2031-03-08", end: "2031-03-14" });
    expect(ari?.propertyId).toBe(mine.propertyId);
    expect(text(ari)).toContain(mine.ratePlanId);
    expectNone("rates & availability", ari, theirs);

    const rules = await loadPricingRules(s, pid);
    expect(rules?.rules.map((r) => r.id)).toEqual([mine.ruleGroupId]);
    expectNone("pricing rules", rules, theirs);
    expect(await loadRuleGroup(s, pid, mine.ruleGroupId)).not.toBeNull();
    expect(await loadRuleGroup(s, pid, theirs.ruleGroupId)).toBeNull();

    // Membership only (null permission): neither role here holds billing.
    const billing = await billingAccess(s, null, { testing: false });
    expect(billing?.organizationId).toBe(mine.orgId);
    const invoices = await listInvoices(billing!);
    expect(invoices.map((i) => i.number)).toEqual([mine.invoiceNumber]);
    expectNone("billing", invoices, theirs);

    const team = await teamScope(s);
    expect(team?.orgId).toBe(mine.orgId);
    const roster = await loadTeam(team!);
    expect(roster.members.map((m) => m.memberId)).toContain(mine.colleagueMemberId);
    expect(roster.properties.map((p) => p.id)).toEqual([mine.propertyId]);
    expectNone("team", roster, theirs);

    const support = await supportScope(s);
    expect(support?.orgId).toBe(mine.orgId);
    const tickets = await listTickets(support!, { tab: "all", page: 1 });
    expect(tickets.tickets.map((t) => t.id)).toEqual([mine.ticketId]);
    expectNone("support tickets", tickets, theirs);
    const listings = await searchLinkables(support!, "listing", "");
    expect(listings.map((l) => l.id)).toEqual([mine.propertyId]);
    const bookings = await searchLinkables(support!, "booking", "");
    expect(bookings.map((b) => b.id)).toEqual([mine.bookingId]);
    expectNone("support pickers", [listings, bookings], theirs);
    expect(await defaultPropertyId(support!)).toBe(mine.propertyId);
  }

  test("on X1, every screen shows X and nothing of Y", async () => {
    await setCurrentProperty({ userId: u, sessionId }, x.propertyId);
    await expectOnly(x, y);
  });

  test("switched to Y1, every screen shows Y and nothing of X", async () => {
    await setCurrentProperty({ userId: u, sessionId }, x.propertyId);
    expect((await setCurrentProperty({ userId: u, sessionId }, y.propertyId))?.organizationId).toBe(y.orgId);
    await expectOnly(y, x);
  });

  test("removed from Y while Y1 is current: the next request is on X1, with nothing of Y", async () => {
    await setCurrentProperty({ userId: u, sessionId }, y.propertyId);
    await db.query(`DELETE FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [y.orgId, u]);
    await expectOnly(x, y);
    // The fallback is written back, so the next request is stable.
    const row = (await db.query(`SELECT "activePropertyId", "activeOrganizationId" FROM "session" WHERE id = $1`, [sessionId]))
      .rows[0];
    expect(row).toEqual({ activePropertyId: x.propertyId, activeOrganizationId: x.orgId });
  });
});

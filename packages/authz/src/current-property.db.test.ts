/**
 * The current hotel against a real Postgres: listSwitchableProperties,
 * resolveCurrentProperty and setCurrentProperty, and the one-hotel scope
 * (currentPropertySql, as getPropertyScopedDb binds it) on real rows.
 *
 * One user U is front desk in org X (assigned hotel X1, not X2) and manager
 * in org Y (assigned Y1). Separately, a host who owns a real hotel and is
 * also in the demo org (testing mode on and off). Each test runs in a
 * transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { DEMO_ORG_ID } from "@openbookings/mode";
import { listSwitchableProperties, resolveCurrentProperty, setCurrentProperty } from "./current-property";
import { currentPropertySql, type AuthzDeps } from "./index";

const CHECK_IN = "2031-03-10";

describeWithDb("the current hotel against Postgres", () => {
  let db: Client;

  const deps = (testing = false): AuthzDeps => ({
    query: async <T,>(text: string, values?: unknown[]) => (await db.query(text, values)).rows as T[],
    queryOne: async <T,>(text: string, values?: unknown[]) => ((await db.query(text, values)).rows[0] ?? null) as T | null,
    testing,
  });

  async function user(): Promise<string> {
    const id = `test-cp-user-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, 'Test Host', $2, true, 'business'::account_type)`,
      [id, `${id}@example.test`],
    );
    return id;
  }

  async function org(name: string, id = `test-cp-org-${crypto.randomUUID()}`): Promise<string> {
    await db.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $1, now())
       ON CONFLICT (id) DO NOTHING`,
      [id, name],
    );
    return id;
  }

  async function member(orgId: string, userId: string, role: string, propertyIds: string[] = []): Promise<string> {
    const id = `test-cp-member-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`,
      [id, orgId, userId, role],
    );
    for (const propertyId of propertyIds) {
      await db.query(`INSERT INTO property_access (member_id, property_id) VALUES ($1, $2)`, [id, propertyId]);
    }
    return id;
  }

  async function hotel(orgId: string, name: string) {
    const ids = await seedProperty(db);
    await db.query(`UPDATE properties SET organization_id = $2, name = $3 WHERE id = $1`, [ids.propertyId, orgId, name]);
    const { bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2 });
    return { ...ids, bookingId };
  }

  async function session(userId: string): Promise<string> {
    const id = `test-cp-session-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "session" (id, "expiresAt", token, "updatedAt", "userId")
       VALUES ($1, now() + interval '1 day', $1, now(), $2)`,
      [id, userId],
    );
    return id;
  }

  const stored = async (sessionId: string) =>
    (await db.query(`SELECT "activePropertyId", "activeOrganizationId" FROM "session" WHERE id = $1`, [sessionId]))
      .rows[0] as { activePropertyId: string | null; activeOrganizationId: string | null };

  /** What a getPropertyScopedDb query sees: bookings at `$2`, read as `$1`. */
  const bookingsOn = async (userId: string, propertyId: string) =>
    (
      await db.query(
        `SELECT b.id::text AS id, b.hotel_id::text AS hotel_id
         FROM bookings b JOIN properties p ON p.id = b.hotel_id
         WHERE ${currentPropertySql(false)}`,
        [userId, propertyId],
      )
    ).rows as { id: string; hotel_id: string }[];

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
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  /** U: front desk in X (X1 only), manager in Y (Y1). Org names fix the switcher order. */
  async function twoOrgs() {
    const orgX = await org("Alpha Hotels");
    const orgY = await org("Bravo Hotels");
    const x1 = await hotel(orgX, "Hotel X1");
    const x2 = await hotel(orgX, "Hotel X2");
    const y1 = await hotel(orgY, "Hotel Y1");
    const u = await user();
    await member(orgX, u, "frontdesk", [x1.propertyId]);
    await member(orgY, u, "manager", [y1.propertyId]);
    const sessionId = await session(u);
    return { orgX, orgY, x1, x2, y1, u, ptr: { userId: u, sessionId } };
  }

  test("the switcher lists exactly the hotels U can read, one per hotel, X before Y", async () => {
    const { orgX, orgY, x1, y1, u } = await twoOrgs();
    const list = await listSwitchableProperties(u, deps());
    expect(list.map((h) => [h.propertyId, h.organizationId, h.role, h.hasPropertyAccess])).toEqual([
      [x1.propertyId, orgX, "frontdesk", true],
      [y1.propertyId, orgY, "manager", true],
    ]);
  });

  test("on X1, a hotel-scoped read returns X1's rows and none of Y's", async () => {
    const { orgX, x1, y1, ptr } = await twoOrgs();
    expect((await setCurrentProperty(ptr, x1.propertyId, deps()))?.propertyId).toBe(x1.propertyId);
    expect(await stored(ptr.sessionId)).toEqual({ activePropertyId: x1.propertyId, activeOrganizationId: orgX });

    const { current } = await resolveCurrentProperty(ptr, deps());
    expect(current?.propertyId).toBe(x1.propertyId);
    const rows = await bookingsOn(ptr.userId, current!.propertyId);
    expect(rows.map((r) => r.id)).toEqual([x1.bookingId]);
    expect(rows.some((r) => r.hotel_id === y1.propertyId)).toBe(false);
  });

  test("switching to Y1 mirrors it: Y1's rows, none of X's", async () => {
    const { orgY, x1, y1, ptr } = await twoOrgs();
    await setCurrentProperty(ptr, x1.propertyId, deps());
    expect((await setCurrentProperty(ptr, y1.propertyId, deps()))?.organizationId).toBe(orgY);
    expect(await stored(ptr.sessionId)).toEqual({ activePropertyId: y1.propertyId, activeOrganizationId: orgY });

    const { current } = await resolveCurrentProperty(ptr, deps());
    expect(current?.propertyId).toBe(y1.propertyId);
    const rows = await bookingsOn(ptr.userId, current!.propertyId);
    expect(rows.map((r) => r.id)).toEqual([y1.bookingId]);
    expect(rows.some((r) => r.hotel_id === x1.propertyId)).toBe(false);
  });

  test("a hotel U cannot read is neither switchable nor readable, and nothing is written", async () => {
    const { orgX, x1, x2, ptr } = await twoOrgs();
    const strangerOrg = await org("Charlie Hotels");
    const z1 = await hotel(strangerOrg, "Hotel Z1");
    await setCurrentProperty(ptr, x1.propertyId, deps());

    // X2: same org, but front desk has no property_access row for it.
    expect(await setCurrentProperty(ptr, x2.propertyId, deps())).toBeNull();
    expect(await setCurrentProperty(ptr, z1.propertyId, deps())).toBeNull();
    expect(await stored(ptr.sessionId)).toEqual({ activePropertyId: x1.propertyId, activeOrganizationId: orgX });
    expect(await bookingsOn(ptr.userId, x2.propertyId)).toEqual([]);
    expect(await bookingsOn(ptr.userId, z1.propertyId)).toEqual([]);
  });

  test("another user's session row is never switched", async () => {
    const { x1, y1, ptr } = await twoOrgs();
    const other = await user();
    const otherSession = await session(other);
    expect(await setCurrentProperty({ userId: ptr.userId, sessionId: otherSession }, y1.propertyId, deps())).toBeNull();
    expect(await stored(otherSession)).toEqual({ activePropertyId: null, activeOrganizationId: null });
    // And the user's own row, never set, resolves to the first hotel.
    expect((await resolveCurrentProperty(ptr, deps())).current?.propertyId).toBe(x1.propertyId);
  });

  test("forged pointers (a hotel of an org U is not in) fall back to a hotel U can read", async () => {
    const { x1, ptr } = await twoOrgs();
    const strangerOrg = await org("Charlie Hotels");
    const z1 = await hotel(strangerOrg, "Hotel Z1");
    await db.query(`UPDATE "session" SET "activePropertyId" = $2, "activeOrganizationId" = $3 WHERE id = $1`, [
      ptr.sessionId,
      z1.propertyId,
      strangerOrg,
    ]);
    const { current, stored: was } = await resolveCurrentProperty(ptr, deps());
    expect(was.activePropertyId).toBe(z1.propertyId);
    expect(current?.propertyId).toBe(x1.propertyId);
  });

  test("removed from Y while Y1 is current: the next resolve lands on X1, not on Y", async () => {
    const { orgX, orgY, x1, y1, ptr } = await twoOrgs();
    await setCurrentProperty(ptr, y1.propertyId, deps());
    await db.query(`DELETE FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [orgY, ptr.userId]);

    const { current, stored: was } = await resolveCurrentProperty(ptr, deps());
    expect(was).toEqual({ activePropertyId: y1.propertyId, activeOrganizationId: orgY });
    expect(current).toMatchObject({ propertyId: x1.propertyId, organizationId: orgX });
    expect((await listSwitchableProperties(ptr.userId, deps())).map((h) => h.organizationId)).toEqual([orgX]);
    expect(await bookingsOn(ptr.userId, y1.propertyId)).toEqual([]);
    // Switching back to Y1 is refused too.
    expect(await setCurrentProperty(ptr, y1.propertyId, deps())).toBeNull();
  });

  test("removed from every org: no current hotel, no error", async () => {
    const { ptr } = await twoOrgs();
    await db.query(`DELETE FROM "member" WHERE "userId" = $1`, [ptr.userId]);
    expect((await resolveCurrentProperty(ptr, deps())).current).toBeNull();
  });

  describe("a host in a real org and the demo org", () => {
    /** The real org's name sorts after the demo org's, so the order is not just by name. */
    async function demoHost() {
      const own = await org("Zulu Hotels");
      const demoOrg = await org("Demo hotels", DEMO_ORG_ID);
      const r1 = await hotel(own, "Zeezicht");
      const d1 = await hotel(demoOrg, "Aaa Demo Hotel");
      const h = await user();
      await member(own, h, "owner");
      await member(demoOrg, h, "owner");
      const sessionId = await session(h);
      return { own, r1, d1, ptr: { userId: h, sessionId } };
    }

    test("testing mode on: own hotel first, demo last; a fresh session lands on the own hotel", async () => {
      const { own, r1, d1, ptr } = await demoHost();
      const list = await listSwitchableProperties(ptr.userId, deps(true));
      const ids = list.map((h) => h.propertyId);
      expect(ids[0]).toBe(r1.propertyId);
      expect(ids).toContain(d1.propertyId);
      expect(list.findIndex((h) => h.organizationId === DEMO_ORG_ID)).toBeGreaterThan(
        list.findLastIndex((h) => h.organizationId === own),
      );
      expect((await resolveCurrentProperty(ptr, deps(true))).current?.propertyId).toBe(r1.propertyId);
      // The demo hotel can still be picked on purpose.
      expect((await setCurrentProperty(ptr, d1.propertyId, deps(true)))?.organizationId).toBe(DEMO_ORG_ID);
      expect((await resolveCurrentProperty(ptr, deps(true))).current?.propertyId).toBe(d1.propertyId);
    });

    test("testing mode off: the demo org is not listed, a stored demo hotel falls back, and cannot be picked", async () => {
      const { own, r1, d1, ptr } = await demoHost();
      const list = await listSwitchableProperties(ptr.userId, deps(false));
      expect(list.map((h) => h.organizationId)).toEqual([own]);
      expect(list.map((h) => h.propertyId)).toEqual([r1.propertyId]);

      await setCurrentProperty(ptr, d1.propertyId, deps(true));
      expect((await resolveCurrentProperty(ptr, deps(false))).current?.propertyId).toBe(r1.propertyId);
      expect(await setCurrentProperty(ptr, d1.propertyId, deps(false))).toBeNull();
    });
  });
});

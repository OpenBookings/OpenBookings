/**
 * The database's own tenant isolation (packages/db/drizzle/0049_rls_guest_data.sql)
 * checked against the app's (propertyReadAccessSql), as the apps will meet it:
 * connected as ob_web or ob_business, with app.user_id set per transaction.
 *
 * Two organizations, a legacy pre-org property and a demo-org property, one
 * member of every role. Each test runs in a transaction that is rolled back.
 */
import { afterAll, beforeAll, beforeEach, afterEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { DEMO_ORG_ID } from "@openbookings/mode";
import { propertyReadAccessSql } from "./index";
import { HOST_ROLES, type HostRole } from "./permissions";

const CHECK_IN = "2031-03-10";

type Fixture = {
  orgA: string;
  orgB: string;
  a1: string;
  a2: string;
  b1: string;
  legacy: string;
  demo: string;
  members: Record<HostRole, string>;
  ownerB: string;
  legacyOwner: string;
  demoOwner: string;
  guest1: string;
  guest2: string;
  bookingA1: string;
  bookingA2: string;
  bookingB1: string;
  bookingLegacy: string;
  roomA1: string;
};

describeWithDb("row-level security on guest data", () => {
  let db: Client;
  let f: Fixture;

  const rows = async <T,>(sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows as T[];

  /** Run `fn` as an app role for one user, then return to the owner. */
  async function as<T>(role: "ob_web" | "ob_business", userId: string | null, fn: () => Promise<T>, testing = false): Promise<T> {
    await db.query(`SELECT set_config('app.user_id', $1, true), set_config('app.testing', $2, true)`, [
      userId ?? "",
      testing ? "on" : "off",
    ]);
    await db.query(`SET LOCAL ROLE ${role}`);
    try {
      return await fn();
    } finally {
      await db.query("RESET ROLE");
      await db.query(`SELECT set_config('app.user_id', '', true)`);
    }
  }

  async function user(kind: "business" | "private"): Promise<string> {
    const id = `test-rls-${kind}-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, 'Test User', $2, true, $3::account_type)`,
      [id, `${id}@example.test`, kind],
    );
    return id;
  }

  async function org(id = `test-rls-org-${crypto.randomUUID()}`): Promise<string> {
    await db.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, now())
       ON CONFLICT (id) DO NOTHING`,
      [id],
    );
    return id;
  }

  async function member(orgId: string, userId: string, role: string, propertyIds: string[] = []): Promise<void> {
    const id = `test-rls-member-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`,
      [id, orgId, userId, role],
    );
    for (const propertyId of propertyIds) {
      await db.query(`INSERT INTO property_access (member_id, property_id) VALUES ($1, $2)`, [id, propertyId]);
    }
  }

  async function property(orgId: string | null, ownerUserId: string | null) {
    const ids = await seedProperty(db);
    await db.query(`UPDATE properties SET organization_id = $2, owner_user_id = $3 WHERE id = $1`, [
      ids.propertyId,
      orgId,
      ownerUserId,
    ]);
    return ids;
  }

  async function booking(ids: Awaited<ReturnType<typeof property>>, guestId: string): Promise<string> {
    const { bookingId } = await seedBooking(db, ids, { checkIn: CHECK_IN, nights: 2, userId: guestId });
    await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
    return bookingId;
  }

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

  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    // CI rebuilds roles from a schema dump: only those the dump grants to
    // exist (ob_app, not the login roles under it), with no memberships.
    // Put back what 0049 sets up; rolled back with the rest.
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_web') THEN CREATE ROLE ob_web; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ob_business') THEN CREATE ROLE ob_business; END IF;
      GRANT ob_app TO ob_web, ob_business;
      EXECUTE format('GRANT ob_web, ob_business TO %I WITH INHERIT FALSE, SET TRUE', current_user);
    END $$`);

    const orgA = await org();
    const orgB = await org();
    const demoOrg = await org(DEMO_ORG_ID);
    const ownerA = await user("business");
    const ownerB = await user("business");
    const legacyOwner = await user("business");
    const demoOwner = await user("business");
    const guest1 = await user("private");
    const guest2 = await user("private");

    const a1 = await property(orgA, ownerA);
    const a2 = await property(orgA, ownerA);
    const b1 = await property(orgB, ownerB);
    const legacy = await property(null, legacyOwner);
    const demo = await property(demoOrg, demoOwner);

    // One member of every role in org A. The property-scoped ones get A1 only.
    const members = {} as Record<HostRole, string>;
    for (const role of HOST_ROLES) {
      members[role] = role === "owner" ? ownerA : await user("business");
      await member(orgA, members[role], role, [a1.propertyId]);
    }
    await member(orgB, ownerB, "owner");
    await member(demoOrg, demoOwner, "owner");

    await db.query(
      `INSERT INTO guest_profile (user_id, phone, city) VALUES ($1, '+31 6 0000 0001', 'Utrecht'), ($2, '+31 6 0000 0002', 'Gent')`,
      [guest1, guest2],
    );

    f = {
      orgA,
      orgB,
      a1: a1.propertyId,
      a2: a2.propertyId,
      b1: b1.propertyId,
      legacy: legacy.propertyId,
      demo: demo.propertyId,
      members,
      ownerB,
      legacyOwner,
      demoOwner,
      guest1,
      guest2,
      bookingA1: await booking(a1, guest1),
      bookingA2: await booking(a2, guest1),
      bookingB1: await booking(b1, guest2),
      bookingLegacy: await booking(legacy, guest2),
      roomA1: a1.roomId,
    };
    await booking(demo, guest2);
    await db.query(`INSERT INTO message_threads (booking_id, property_id, host_id, guest_id) VALUES ($1, $2, $3, $4)`, [
      f.bookingA1,
      f.a1,
      ownerA,
      guest1,
    ]);
  });

  const fixtureProperties = () => [f.a1, f.a2, f.b1, f.legacy, f.demo];

  /** What the app's predicate says this user may read, among the fixture properties. */
  async function appReadable(userId: string, testing: boolean): Promise<string[]> {
    const found = await rows<{ id: string }>(
      `SELECT p.id FROM properties p WHERE p.id = ANY($2::uuid[]) AND ${propertyReadAccessSql("$1", testing)} ORDER BY p.id`,
      [userId, fixtureProperties()],
    );
    return found.map((r) => r.id);
  }

  async function dbReadable(userId: string, testing: boolean): Promise<string[]> {
    return as(
      "ob_business",
      userId,
      async () =>
        (
          await rows<{ id: string }>(
            `SELECT x AS id FROM unnest(app.readable_property_ids()) x WHERE x = ANY($1::uuid[]) ORDER BY x`,
            [fixtureProperties()],
          )
        ).map((r) => r.id),
      testing,
    );
  }

  test("the database agrees with propertyReadAccessSql for every role, in and out of testing mode", async () => {
    const everyone = [...Object.values(f.members), f.ownerB, f.legacyOwner, f.demoOwner, f.guest1, f.guest2];
    for (const testing of [false, true]) {
      for (const userId of everyone) {
        expect({ userId, testing, readable: await dbReadable(userId, testing) }).toEqual({
          userId,
          testing,
          readable: await appReadable(userId, testing),
        });
      }
    }
    // Sanity: the fixture covers the interesting cases.
    expect(await appReadable(f.members.finance, false)).toHaveLength(2);
    expect(await appReadable(f.members.frontdesk, false)).toEqual([f.a1]);
    expect(await appReadable(f.legacyOwner, false)).toEqual([f.legacy]);
    expect(await appReadable(f.demoOwner, false)).toEqual([]);
    expect(await appReadable(f.demoOwner, true)).toEqual([f.demo]);
  });

  test("a host cannot read another organization's booking, guest or messages by id", async () => {
    await as("ob_business", f.ownerB, async () => {
      expect(await rows(`SELECT id FROM bookings WHERE id = $1`, [f.bookingA1])).toEqual([]);
      expect(await rows(`SELECT id FROM reservations WHERE booking_id = $1`, [f.bookingA1])).toEqual([]);
      expect(await rows(`SELECT user_id FROM guest_profile WHERE user_id = $1`, [f.guest1])).toEqual([]);
      expect(await rows(`SELECT id FROM "user" WHERE id = $1`, [f.guest1])).toEqual([]);
      expect(await rows(`SELECT id FROM message_threads WHERE property_id = $1`, [f.a1])).toEqual([]);
      // Their own guest, at their own property, is visible.
      expect(await rows(`SELECT id FROM bookings WHERE id = $1`, [f.bookingB1])).toHaveLength(1);
      expect(await rows(`SELECT user_id FROM guest_profile WHERE user_id = $1`, [f.guest2])).toHaveLength(1);
      expect(await rows(`SELECT id, name, email FROM "user" WHERE id = $1`, [f.guest2])).toHaveLength(1);
    });
  });

  test("a host cannot change another organization's booking", async () => {
    const updated = await as("ob_business", f.ownerB, () =>
      db.query(`UPDATE bookings SET guest_notes = 'x' WHERE id = $1`, [f.bookingA1]),
    );
    expect(updated.rowCount).toBe(0);
  });

  test("property-scoped roles see only the properties they were given", async () => {
    const visible = (userId: string) =>
      as("ob_business", userId, async () =>
        (await rows<{ id: string }>(`SELECT id FROM bookings WHERE id = ANY($1::uuid[])`, [[f.bookingA1, f.bookingA2]])).map(
          (r) => r.id,
        ),
      );
    expect((await visible(f.members.finance)).sort()).toEqual([f.bookingA1, f.bookingA2].sort());
    expect(await visible(f.members.manager)).toEqual([f.bookingA1]);
    expect(await visible(f.members.frontdesk)).toEqual([f.bookingA1]);
  });

  test("a guest sees only their own bookings and profile, and cannot book in someone else's name", async () => {
    await as("ob_web", f.guest1, async () => {
      expect((await rows<{ id: string }>(`SELECT id FROM bookings`)).map((r) => r.id).sort()).toEqual(
        [f.bookingA1, f.bookingA2].sort(),
      );
      expect(await rows(`SELECT user_id FROM guest_profile`)).toEqual([{ user_id: f.guest1 }]);
      expect(await rows(`SELECT id FROM "user" WHERE id = $1`, [f.guest2])).toEqual([]);

      await db.query("SAVEPOINT forged");
      const forged = db.query(
        `INSERT INTO bookings (hotel_id, user_id, check_in_date, check_out_date, status, total_cents)
         VALUES ($1, $2, '2031-04-01', '2031-04-02', 'pending', 10000)`,
        [f.b1, f.guest2],
      );
      await expect(forged).rejects.toThrow(/row-level security/);
      await db.query("ROLLBACK TO SAVEPOINT forged");
    });
  });

  test("without a user, nothing private is visible", async () => {
    await as("ob_web", null, async () => {
      expect(await rows(`SELECT id FROM bookings WHERE id = $1`, [f.bookingA1])).toEqual([]);
      expect(await rows(`SELECT user_id FROM guest_profile WHERE user_id = $1`, [f.guest1])).toEqual([]);
      expect(await rows(`SELECT id FROM "user" WHERE id = $1`, [f.guest1])).toEqual([]);
    });
  });

  test("app roles cannot read password hashes, session tokens or 2FA secrets", async () => {
    await as("ob_web", f.guest1, async () => {
      for (const sql of [
        `SELECT password FROM account`,
        `SELECT token FROM session`,
        `SELECT secret FROM "twoFactor"`,
        `SELECT value FROM verification`,
      ]) {
        await db.query("SAVEPOINT secret");
        await expect(db.query(sql)).rejects.toThrow(/permission denied/);
        await db.query("ROLLBACK TO SAVEPOINT secret");
      }
    });
  });

  test("availability still counts other guests' rooms, without exposing them", async () => {
    const taken = await as("ob_web", f.guest2, () =>
      rows<{ night: string; booked_units: number }>(
        `SELECT night::text, booked_units FROM app.room_units_taken($1::uuid[], $2::date, $3::date, now(), NULL) ORDER BY night`,
        [[f.roomA1], CHECK_IN, "2031-03-12"],
      ),
    );
    expect(taken).toEqual([
      { night: "2031-03-10", booked_units: 1 },
      { night: "2031-03-11", booked_units: 1 },
    ]);
  });
});

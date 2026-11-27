/**
 * The admin console's roles (drizzle/0054_admin_roles.sql): their attributes
 * and the exact privileges each holds, so a later migration that widens them
 * has to change this list too. apps/admin/lib/db-roles.db.test.ts runs the
 * console's own loaders and actions as these roles.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "./testing/db-harness";
import { pendingMigrationSql } from "./testing/pending-migrations";

const READ = [
  // 0060: step-up credentials, without the TOTP secret or a step-up's challenge.
  "admin_credentials.counter: SELECT",
  "admin_credentials.created_at: SELECT",
  "admin_credentials.credential_id: SELECT",
  "admin_credentials.id: SELECT",
  "admin_credentials.kind: SELECT",
  "admin_credentials.label: SELECT",
  "admin_credentials.last_used_at: SELECT",
  "admin_credentials.public_key: SELECT",
  "admin_credentials.transports: SELECT",
  "admin_credentials.user_id: SELECT",
  "admin_step_ups.action: SELECT",
  "admin_step_ups.created_at: SELECT",
  "admin_step_ups.expires_at: SELECT",
  "admin_step_ups.id: SELECT",
  "admin_step_ups.target_id: SELECT",
  "admin_step_ups.used_at: SELECT",
  "admin_step_ups.user_id: SELECT",
  "admin_step_ups.verified_at: SELECT",
  "admin_step_ups.verified_kind: SELECT",
  "audit_log: SELECT",
  "booking_events: SELECT",
  "booking_intents: SELECT",
  "bookings: SELECT",
  "invoice_runs: SELECT",
  "invoices: SELECT",
  "member: SELECT",
  "message_threads: SELECT",
  "messages: SELECT",
  "organization: SELECT",
  "properties: SELECT",
  "rate_plans: SELECT",
  "refunds: SELECT",
  "reservations: SELECT",
  "rooms: SELECT",
  "support_tickets: SELECT",
  "transactions: SELECT",
  "user.email: SELECT",
  "user.first_name: SELECT",
  "user.id: SELECT",
  "user.last_name: SELECT",
  "user.name: SELECT",
  "user.role: SELECT", // 0060: the staff lookup
];

const WRITE = [
  // 0060: enrolling step-up credentials and running step-ups.
  "admin_credentials.counter: UPDATE",
  "admin_credentials.last_used_at: UPDATE",
  "admin_credentials: INSERT",
  "admin_credentials: SELECT",
  "admin_step_ups.used_at: UPDATE",
  "admin_step_ups.verified_at: UPDATE",
  "admin_step_ups.verified_kind: UPDATE",
  "admin_step_ups: INSERT",
  "admin_step_ups: SELECT",
  "audit_log: INSERT",
  "audit_log: SELECT",
  "booking_events: INSERT",
  "booking_events: SELECT",
  "booking_intents: SELECT",
  "bookings.cancellation_reason: UPDATE",
  "bookings.cancelled_at: UPDATE",
  "bookings.departed_early_on: UPDATE",
  "bookings.no_show_reported_at: UPDATE",
  "bookings.status: UPDATE",
  "bookings.updated_at: UPDATE",
  "bookings: SELECT",
  "member: SELECT",
  "properties: SELECT",
  "property_content: SELECT",
  "rate_plans: SELECT",
  "refunds.accommodation_cents: UPDATE",
  "refunds.last_attempt_at: UPDATE",
  "refunds.split_explained_at: UPDATE",
  "refunds.split_explained_by: UPDATE",
  "refunds.status: UPDATE",
  "refunds.stripe_refund_id: UPDATE",
  "refunds.tourist_tax_cents: UPDATE",
  "refunds: DELETE",
  "refunds: INSERT",
  "refunds: SELECT",
  "reservations.cancelled_at: UPDATE",
  "reservations: SELECT",
  "rooms: SELECT",
  "user.email: SELECT",
  "user.first_name: SELECT",
  "user.id: SELECT",
  "user.last_name: SELECT",
  "user.name: SELECT",
];

describeWithDb("admin console roles (0054)", () => {
  let db: Client;

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
    // Again, even where CI applied it up front: a database rebuilt from a
    // schema dump has the roles without their attributes. Rolled back.
    // 0058 renamed the refund columns 0054 grants on; replay its grants on the new names.
    await db.query(
      pendingMigrationSql("0054_admin_roles.sql").replace(
        "accommodation_amount, tourist_tax_amount",
        "accommodation_cents, tourist_tax_cents",
      ),
    );
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  /** Every privilege the role holds on a table, view or column in public. */
  async function privileges(role: string): Promise<string[]> {
    const { rows } = await db.query(
      `SELECT c.relname || ': ' || a.privilege_type AS p
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname = 'public' AND a.grantee = $1::regrole
       UNION ALL
       SELECT c.relname || '.' || att.attname || ': ' || a.privilege_type
         FROM pg_attribute att
         JOIN pg_class c ON c.oid = att.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(att.attacl) a
        WHERE n.nspname = 'public' AND a.grantee = $1::regrole`,
      [role],
    );
    return (rows as { p: string }[]).map((r) => r.p).sort();
  }

  test("ob_admin_read holds SELECT on what the pages show, and nothing else", async () => {
    expect(await privileges("ob_admin_read")).toEqual(READ);
  });

  test("ob_admin_write holds what the actions change, and nothing else", async () => {
    expect(await privileges("ob_admin_write")).toEqual(WRITE);
  });

  test("both are NOLOGIN, bypass RLS, and can create nothing", async () => {
    const { rows } = await db.query(
      `SELECT rolname, rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolreplication,
              has_schema_privilege(oid, 'public', 'USAGE') AS usage,
              has_schema_privilege(oid, 'public', 'CREATE') AS can_create,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS member_of,
              (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns
         FROM pg_roles r WHERE rolname IN ('ob_admin_read', 'ob_admin_write') ORDER BY rolname`,
    );
    const expected = {
      rolcanlogin: false,
      rolbypassrls: true,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      usage: true,
      can_create: false,
      member_of: 0,
      owns: 0,
    };
    expect(rows).toEqual([
      { rolname: "ob_admin_read", ...expected },
      { rolname: "ob_admin_write", ...expected },
    ]);
  });

  test("neither reaches the login secrets or the app tables they were not given", async () => {
    const denied = async (role: string, sql: string) => {
      await db.query("SAVEPOINT denied");
      await db.query(`SET LOCAL ROLE ${role}`);
      try {
        await db.query(sql);
        return false;
      } catch (error) {
        return /permission denied/.test((error as Error).message);
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT denied");
      }
    };
    for (const role of ["ob_admin_read", "ob_admin_write"]) {
      expect(await denied(role, `SELECT password FROM account LIMIT 1`)).toBe(true);
      expect(await denied(role, `SELECT token FROM session LIMIT 1`)).toBe(true);
      expect(await denied(role, `SELECT * FROM "user" LIMIT 1`)).toBe(true);
      expect(await denied(role, `SELECT 1 FROM guest_profile LIMIT 1`)).toBe(true);
      expect(await denied(role, `CREATE TABLE ob_admin_probe (id int)`)).toBe(true);
    }
    expect(await denied("ob_admin_read", `INSERT INTO audit_log (action) VALUES ('probe')`)).toBe(true);
    expect(await denied("ob_admin_read", `UPDATE bookings SET status = status`)).toBe(true);
    expect(await denied("ob_admin_write", `UPDATE bookings SET total_cents = total_cents`)).toBe(true);
    expect(await denied("ob_admin_write", `DELETE FROM bookings`)).toBe(true);
    expect(await denied("ob_admin_write", `DELETE FROM audit_log`)).toBe(true);
  });
});

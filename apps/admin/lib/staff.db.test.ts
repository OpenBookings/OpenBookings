/**
 * Staff lookup, run as ob_admin_read like the pages that use it
 * (packages/db/drizzle/0060_admin_production.sql grants it the role column).
 * Each test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, pendingMigrationSql } from "@openbookings/db/testing";
import { lookupStaff } from "./staff";

describeWithDb("staff lookup as ob_admin_read", () => {
  let db: Client;
  let suffix: string;

  const insertUser = (role: string | null, email: string) =>
    db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type, role)
       VALUES ($1, 'Staff', $2, true, 'business'::account_type, $3)`,
      [`staff-${crypto.randomUUID()}`, email, role],
    );

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
    // The role and its schema/table grants, again: a database rebuilt from a
    // schema dump may lack them. 0058 renamed columns 0054 grants on. Rolled back.
    await db.query(
      pendingMigrationSql("0054_admin_roles.sql").replace(
        "accommodation_amount, tourist_tax_amount",
        "accommodation_cents, tourist_tax_cents",
      ),
    );
    suffix = crypto.randomUUID().slice(0, 8);
    await db.query("SET LOCAL ROLE ob_admin_read");
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("finds a user with role admin by email, ignoring case", async () => {
    await db.query("RESET ROLE");
    await insertUser("admin", `Staff-${suffix}@Example.test`);
    await db.query("SET LOCAL ROLE ob_admin_read");
    const staff = await lookupStaff(db, `STAFF-${suffix}@example.TEST`);
    expect(staff?.email).toBe(`staff-${suffix}@example.test`);
    expect(typeof staff?.userId).toBe("string");
  });

  test("returns null for a user without the admin role", async () => {
    await db.query("RESET ROLE");
    await insertUser(null, `plain-${suffix}@example.test`);
    await insertUser("user", `user-${suffix}@example.test`);
    await db.query("SET LOCAL ROLE ob_admin_read");
    expect(await lookupStaff(db, `plain-${suffix}@example.test`)).toBeNull();
    expect(await lookupStaff(db, `user-${suffix}@example.test`)).toBeNull();
  });

  test("returns null for an unknown email", async () => {
    expect(await lookupStaff(db, `nobody-${suffix}@example.test`)).toBeNull();
  });
});

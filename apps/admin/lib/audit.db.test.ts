/**
 * The /audit loader, run as ob_admin_read like the page. Each test runs in a
 * transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, pendingMigrationSql } from "@openbookings/db/testing";
import { listAdminAudit } from "./audit";

describeWithDb("audit listing as ob_admin_read", () => {
  let db: Client;
  let target: string;

  const insert = async (action: string, detail: Record<string, unknown>, reason = "a good reason") => {
    await db.query("RESET ROLE");
    await db.query(`INSERT INTO audit_log (action, reason, detail) VALUES ($1, $2, $3::jsonb)`, [
      action,
      reason,
      JSON.stringify(detail),
    ]);
    await db.query("SET LOCAL ROLE ob_admin_read");
  };

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
    await db.query(
      pendingMigrationSql("0054_admin_roles.sql").replace(
        "accommodation_amount, tourist_tax_amount",
        "accommodation_cents, tourist_tax_cents",
      ),
    );
    target = crypto.randomUUID();
    await db.query("SET LOCAL ROLE ob_admin_read");
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("lists admin rows with their outcome rows, and no others", async () => {
    await insert("admin.booking.cancel_rooms", {
      target_type: "booking",
      target_id: target,
      step_up: "totp",
      actor_email: "staff@example.test",
    });
    await insert("admin.booking.cancel_rooms.failed", {
      target_type: "booking",
      target_id: target,
      step_up: "totp",
      actor_email: "staff@example.test",
      error: "card_declined",
    });
    await insert("host.something_else", { target_id: target });

    const rows = await listAdminAudit(db, target);
    expect(rows.map((r) => r.action).sort()).toEqual([
      "admin.booking.cancel_rooms",
      "admin.booking.cancel_rooms.failed",
    ]);
    const failed = rows.find((r) => r.action.endsWith(".failed"))!;
    expect(failed).toMatchObject({
      actorEmail: "staff@example.test",
      targetType: "booking",
      targetId: target,
      reason: "a good reason",
      stepUp: "totp",
      outcome: "card_declined",
    });
  });

  test("filters by target id", async () => {
    await insert("admin.booking.mark_no_show", { target_type: "booking", target_id: target });
    await insert("admin.booking.mark_no_show", { target_type: "booking", target_id: crypto.randomUUID() });
    expect(await listAdminAudit(db, target)).toHaveLength(1);
    expect((await listAdminAudit(db)).length).toBeGreaterThanOrEqual(2);
  });
});

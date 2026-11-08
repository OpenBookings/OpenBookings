import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedGuest } from "@openbookings/db/testing";
import { listInvoices } from "./queries";
import { billingAccess, type BillingAccessDeps } from "./scope";

describeWithDb("billing access", () => {
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
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const deps: () => BillingAccessDeps = () => ({
    query: async <T>(text: string, values?: unknown[]) => (await db.query(text, values)).rows as T[],
    queryOne: async <T>(text: string, values?: unknown[]) => ((await db.query(text, values)).rows[0] ?? null) as T | null,
    testing: false,
    db: { query: async (text, values) => ({ rows: (await db.query(text, values)).rows }) },
  });
  const org = async (userId: string, role: string) => {
    const id = `org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [id]);
    await db.query(`INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())`, [id, userId, role]);
    return id;
  };
  const session = (userId: string, active: string | null = null) => ({
    user: { id: userId, account_type: "business" },
    session: { activeOrganizationId: active },
  });

  test("an owner with no active organization and one membership may read billing and sees that organization's invoices", async () => {
    const user = await seedGuest(db);
    const orgId = await org(user, "owner");
    await db.query(
      `INSERT INTO invoices (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number, issued_on,
         seller, buyer, vat_treatment, vat_rate_bp, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
       VALUES ($1, '2026-10-01', '2026-10-31', 'invoice', 'issued', 'OB-2026', 1, 'OB-2026-0001', '2026-11-05', '{}'::jsonb, '{}'::jsonb,
               'NL_DOMESTIC', 2100, 893, 187, 1080, 187, 0)`,
      [orgId],
    );
    const access = await billingAccess(session(user), { billing: ["read"] }, deps());
    expect(access?.organizationId).toBe(orgId);
    expect((await listInvoices(access!)).map((i) => i.number)).toEqual(["OB-2026-0001"]);
  });

  test("two memberships and no active organization is refused", async () => {
    const user = await seedGuest(db);
    await org(user, "owner");
    await org(user, "owner");
    expect(await billingAccess(session(user), { billing: ["read"] }, deps())).toBeNull();
  });

  test("a role without the permission is refused, and the active organization is honoured", async () => {
    const user = await seedGuest(db);
    const a = await org(user, "manager");
    const b = await org(user, "finance");
    expect(await billingAccess(session(user, a), { billing: ["read"] }, deps())).toBeNull();
    expect((await billingAccess(session(user, b), { billing: ["update"] }, deps()))?.organizationId).toBe(b);
  });
});

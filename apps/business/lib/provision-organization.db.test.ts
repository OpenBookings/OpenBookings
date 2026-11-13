import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client, type PoolClient } from "pg";
import { DEMO_ORG_ID } from "@openbookings/mode";
import { provisionOrganizationTx } from "./provision-organization";

const connectionString = process.env.DATABASE_URL;
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb("provisionOrganizationTx", () => {
  let db: Client;
  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(() => db.query("BEGIN"));
  afterEach(() => db.query("ROLLBACK"));

  const user = async () => {
    const id = `prov-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'U', $2, true, 'business')`,
      [id, `${id}@example.test`],
    );
    return id;
  };
  const join = (orgId: string, userId: string) =>
    db.query(
      `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, 'owner', NOW())`,
      [orgId, userId],
    );
  const ensureDemoOrg = () =>
    db.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Demo', 'demo-provision-test', NOW()) ON CONFLICT (id) DO NOTHING`,
      [DEMO_ORG_ID],
    );
  const legal = () => ({
    legalCompanyName: `Provision Test ${crypto.randomUUID()}`,
    fullName: "Test Owner",
    roleTitle: "Owner",
    vatNumber: "",
  });

  test("a host who only owns the demo org gets their own organisation", async () => {
    const userId = await user();
    await ensureDemoOrg();
    await join(DEMO_ORG_ID, userId);

    const result = await provisionOrganizationTx(db as unknown as PoolClient, {
      userId,
      legal: legal(),
      stripeAccountId: "acct_test_provision",
    });

    expect(result.organizationId).not.toBe(DEMO_ORG_ID);
    expect(result.alreadyProvisioned).toBe(false);
    const profile = await db.query(
      `SELECT 1 FROM org_profile WHERE organization_id = $1 AND stripe_account_id = 'acct_test_provision'`,
      [result.organizationId],
    );
    expect(profile.rowCount).toBe(1);
  });

  test("an existing real org is still returned", async () => {
    const userId = await user();
    await ensureDemoOrg();
    const realOrg = crypto.randomUUID();
    await db.query(
      `INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Real', $1, NOW())`,
      [realOrg],
    );
    await join(DEMO_ORG_ID, userId);
    await join(realOrg, userId);

    const result = await provisionOrganizationTx(db as unknown as PoolClient, {
      userId,
      legal: legal(),
      stripeAccountId: null,
    });

    expect(result.organizationId).toBe(realOrg);
    expect(result.alreadyProvisioned).toBe(true);
  });
});

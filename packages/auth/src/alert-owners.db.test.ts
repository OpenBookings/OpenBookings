import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import { DEMO_ORG_ID } from "@openbookings/mode";
import { alertOwnerEmails } from "./alert-owners";

const connectionString = process.env.DATABASE_URL;
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb("new-device alert recipients", () => {
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

  const user = async (tag: string) => {
    const id = `alert-${tag}-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'U', $2, true, 'business')`, [id, `${id}@example.test`]);
    return { id, email: `${id}@example.test` };
  };
  const join = (orgId: string, userId: string, role: string) =>
    db.query(`INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())`, [orgId, userId, role]);

  test("a real co-owner is alerted, a demo co-owner is not", async () => {
    const me = await user("me");
    const realOwner = await user("real");
    const demoOwner = await user("demo");
    const realOrg = crypto.randomUUID();
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Real', $1, NOW())`, [realOrg]);
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Demo', 'demo-alert-test', NOW()) ON CONFLICT (id) DO NOTHING`, [DEMO_ORG_ID]);
    await join(realOrg, me.id, "member");
    await join(realOrg, realOwner.id, "owner");
    await join(DEMO_ORG_ID, me.id, "owner");
    await join(DEMO_ORG_ID, demoOwner.id, "owner");

    const emails = await alertOwnerEmails(db, me.id);
    expect(emails).toContain(realOwner.email);
    expect(emails).not.toContain(demoOwner.email);
    expect(emails).not.toContain(me.email);
  });
});

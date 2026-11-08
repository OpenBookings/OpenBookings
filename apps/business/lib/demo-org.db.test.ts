import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedGuest } from "@openbookings/db/testing";
import { DEMO_ORG_ID, ensureDemoMembership } from "@openbookings/demo";
import { activeOrgId } from "./active-org";
import { getOnboardingFacts } from "./onboarding-facts";

describeWithDb("the demo organisation on the host side", () => {
  let db: Client;
  const run = async <T>(text: string, values?: unknown[]) => (await db.query(text, values)).rows as T[];
  const runOne = async <T>(text: string, values?: unknown[]) => (await run<T>(text, values))[0] ?? null;

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

  const realOrg = async (userId: string) => {
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Real', $1, NOW())`, [id]);
    await db.query(`INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, 'owner', NOW())`, [id, userId]);
    return id;
  };
  const session = (userId: string, active?: string) => ({ user: { id: userId }, session: active ? { activeOrganizationId: active } : {} });

  test("demo only: active in testing mode, none outside it, stored demo id included", async () => {
    const user = await seedGuest(db);
    await ensureDemoMembership(db, { userId: user });
    expect(await activeOrgId(session(user), { query: run, testing: true })).toBe(DEMO_ORG_ID);
    expect(await activeOrgId(session(user), { query: run, testing: false })).toBeNull();
    expect(await activeOrgId(session(user, DEMO_ORG_ID), { query: run, testing: false })).toBeNull();
    expect(await activeOrgId(session(user, DEMO_ORG_ID), { query: run, testing: true })).toBe(DEMO_ORG_ID);
  });

  test("demo plus one real organisation: the real one; real only: unchanged", async () => {
    const user = await seedGuest(db);
    const real = await realOrg(user);
    expect(await activeOrgId(session(user), { query: run, testing: true })).toBe(real);
    await ensureDemoMembership(db, { userId: user });
    expect(await activeOrgId(session(user), { query: run, testing: true })).toBe(real);
    expect(await activeOrgId(session(user), { query: run, testing: false })).toBe(real);
  });

  test("getOnboardingFacts reports the demo membership and does not count it as a completed organisation", async () => {
    const user = await seedGuest(db);
    expect((await getOnboardingFacts(user, runOne)).hasDemoMembership).toBe(false);
    await ensureDemoMembership(db, { userId: user });
    const facts = await getOnboardingFacts(user, runOne);
    expect(facts.hasDemoMembership).toBe(true);
    expect(facts.hasCompletedOrg).toBe(false);
  });
});

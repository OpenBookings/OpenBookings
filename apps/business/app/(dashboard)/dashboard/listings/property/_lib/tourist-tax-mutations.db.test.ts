/**
 * The tourist tax rules' date and duplicate rules, against a real Postgres.
 *
 * Same harness as the Rooms suite: a throwaway Neon branch in CI, every test
 * inside a transaction that is rolled back, skipped locally without
 * DATABASE_URL. "Today" is the property's own date, read from the database,
 * so the tests do not depend on the machine's clock or time zone.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "pg";
import type { SessionLike } from "@openbookings/authz";
import { applyPendingMigrations } from "../../_lib/pending-migrations";
import { addTouristTaxRule, deleteTouristTaxRule, type TouristTaxDeps } from "./tourist-tax-mutations";

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.CI) {
  throw new Error(
    "DATABASE_URL is not set but CI is. The Verify job must provide a database for this suite.",
  );
}

const describeWithDb = connectionString ? describe : describe.skip;

const session = (id: string): SessionLike => ({ user: { id, account_type: "business" } });

describeWithDb("Tourist tax rules against Postgres", () => {
  let db: Client;
  let deps: TouristTaxDeps;
  let owner: string;
  let propertyId: string;
  let today: string;

  const one = async <T,>(sql: string, values: unknown[] = []) =>
    ((await db.query(sql, values)).rows[0] ?? null) as T | null;

  /** "YYYY-MM-DD" a number of days from the property's today. */
  const day = async (offset: number) =>
    (await one<{ d: string }>(`SELECT ($1::date + $2::int)::text AS d`, [today, offset]))!.d;

  const rule = (effectiveFrom: string) => ({
    effectiveFrom,
    charges: [{ kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false }],
    childrenExempt: true,
    maxNights: 7,
  });

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
    deps = { queryOne: one };
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);

    owner = `test-business-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", account_type)
       VALUES ($1, 'Test host', $2, true, 'business'::account_type)`,
      [owner, `${owner}@example.test`],
    );
    const orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, NOW())`,
      [orgId],
    );
    propertyId = (await one<{ id: string }>(
      `INSERT INTO properties
         (name, slug, address_line_1, city, country, timezone, location,
          check_in_time, check_out_time, owner_user_id, organization_id)
       VALUES ('Test Property', $1, '1 Test Street', 'Amsterdam', 'NL', 'Europe/Amsterdam',
               ST_SetSRID(ST_MakePoint(4.9041, 52.3676), 4326),
               '15:00', '11:00', $2, $3)
       RETURNING id`,
      [`test-property-${crypto.randomUUID()}`, owner, orgId],
    ))!.id;
    today = (await one<{ d: string }>(
      `SELECT (now() AT TIME ZONE 'Europe/Amsterdam')::date::text AS d`,
    ))!.d;
  });

  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("a rule starting today is saved with everything the host entered", async () => {
    const result = await addTouristTaxRule(session(owner), propertyId, rule(today), deps);
    expect(result.ok).toBe(true);
    const row = await one<Record<string, unknown>>(
      `SELECT effective_from::text, charges, children_exempt, max_nights, created_by
       FROM tourist_tax_rules WHERE property_id = $1`,
      [propertyId],
    );
    expect(row).toEqual({
      effective_from: today,
      charges: [
        { kind: "fixed", amount: 2.5, perPerson: true, perNight: true, perRoom: false, vatIncludedPercent: null },
      ],
      children_exempt: true,
      max_nights: 7,
      created_by: owner,
    });
  });

  test("a rule cannot start in the past", async () => {
    const result = await addTouristTaxRule(session(owner), propertyId, rule(await day(-1)), deps);
    expect(result).toEqual({ ok: false, error: "A new rule cannot start in the past." });
  });

  test("two rules cannot start on the same date", async () => {
    const date = await day(30);
    await addTouristTaxRule(session(owner), propertyId, rule(date), deps);
    const second = await addTouristTaxRule(session(owner), propertyId, rule(date), deps);
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toMatch(/already a rule starting on/);
  });

  test("only one rule can be waiting to start", async () => {
    await addTouristTaxRule(session(owner), propertyId, rule(await day(30)), deps);
    const second = await addTouristTaxRule(session(owner), propertyId, rule(await day(60)), deps);
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toMatch(/already have a rule starting on/);
  });

  test("a rule starting today can still be added while one is waiting", async () => {
    await addTouristTaxRule(session(owner), propertyId, rule(await day(30)), deps);
    const today_ = await addTouristTaxRule(session(owner), propertyId, rule(today), deps);
    expect(today_.ok).toBe(true);
  });

  test("a rule that has not started yet can be deleted", async () => {
    const added = await addTouristTaxRule(session(owner), propertyId, rule(await day(10)), deps);
    if (!added.ok) throw new Error(added.error);
    expect(await deleteTouristTaxRule(session(owner), propertyId, added.ruleId, deps)).toEqual({ ok: true });
  });

  test("a rule that has already started cannot be deleted", async () => {
    const started = (await one<{ id: string }>(
      `INSERT INTO tourist_tax_rules (property_id, effective_from) VALUES ($1, $2::date - 5) RETURNING id`,
      [propertyId, today],
    ))!.id;
    const result = await deleteTouristTaxRule(session(owner), propertyId, started, deps);
    expect(result.ok).toBe(false);
    expect(await one(`SELECT id FROM tourist_tax_rules WHERE id = $1`, [started])).not.toBeNull();
  });
});

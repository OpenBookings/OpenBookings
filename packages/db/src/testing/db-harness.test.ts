import { afterEach, describe, expect, test } from "bun:test";
import { describeWithDb, ensureCommittedMigrations } from "./db-harness";
import { PENDING_MIGRATIONS } from "./pending-migrations";

/** A connection that answers the readiness probe with `ready` and records every statement. */
function fakeDb(ready: boolean) {
  const sent: string[] = [];
  return {
    sent,
    query: (async (sql: string) => {
      sent.push(sql.trim().split("\n")[0]!);
      return { rows: [{ ready }] };
    }) as never,
  };
}

const saved = { CI: process.env.CI, APPLIED: process.env.PENDING_MIGRATIONS_APPLIED };

afterEach(() => {
  for (const [name, value] of [
    ["CI", saved.CI],
    ["PENDING_MIGRATIONS_APPLIED", saved.APPLIED],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("ensureCommittedMigrations", () => {
  test("outside CI it only looks, and says whether the schema is there", async () => {
    delete process.env.CI;
    const missing = fakeDb(false);
    expect(await ensureCommittedMigrations(missing)).toBe(false);
    expect(missing.sent).toEqual([expect.stringContaining("to_regclass('public.invoices')")]);

    const present = fakeDb(true);
    expect(await ensureCommittedMigrations(present)).toBe(true);
    expect(present.sent).toHaveLength(1);
  });

  test("in CI it applies the pending migrations for good, in one transaction", async () => {
    process.env.CI = "true";
    delete process.env.PENDING_MIGRATIONS_APPLIED;
    const db = fakeDb(false);
    expect(await ensureCommittedMigrations(db)).toBe(true);
    expect(db.sent[0]).toBe("BEGIN");
    expect(db.sent[1]).toContain("pg_advisory_xact_lock");
    expect(db.sent).toHaveLength(PENDING_MIGRATIONS.length + 3);
    expect(db.sent.at(-1)).toBe("COMMIT");
  });

  test("in CI it leaves alone what the Verify job already applied", async () => {
    process.env.CI = "true";
    process.env.PENDING_MIGRATIONS_APPLIED = "1";
    const db = fakeDb(true);
    expect(await ensureCommittedMigrations(db)).toBe(true);
    expect(db.sent).toHaveLength(1);
  });
});

describeWithDb("ensureCommittedMigrations on a connection of its own", () => {
  test("answers before it closes the connection", async () => {
    delete process.env.CI;
    expect(typeof (await ensureCommittedMigrations())).toBe("boolean");
  });
});

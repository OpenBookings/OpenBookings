import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { lastReconcileStatus, withRun } from "./runs";

describeWithDb("invoice runs against Postgres", () => {
  let db: Client;
  const period = "2026-10-01";

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

  const row = async (id: string) => (await db.query(`SELECT status, finished_at, report FROM invoice_runs WHERE id = $1`, [id])).rows[0];

  test("a succeeded step is recorded with its report", async () => {
    const r = await withRun(db, { periodStart: period, step: "draft" }, async () => ({ status: "succeeded", report: { n: 1 }, value: 7 }));
    expect(r.value).toBe(7);
    const saved = await row(r.runId);
    expect(saved.status).toBe("succeeded");
    expect(saved.finished_at).not.toBeNull();
    expect(saved.report).toEqual({ n: 1 });
  });

  test("a blocked step is recorded as blocked", async () => {
    const r = await withRun(db, { periodStart: period, step: "draft" }, async () => ({ status: "blocked", report: {}, value: null }));
    expect(r.status).toBe("blocked");
    expect((await row(r.runId)).status).toBe("blocked");
  });

  test("a thrown step is recorded as failed and rethrown", async () => {
    let runId = "";
    await expect(
      withRun(db, { periodStart: period, step: "issue" }, async (id) => {
        runId = id;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const saved = await row(runId);
    expect(saved.status).toBe("failed");
    expect(saved.report).toEqual({ error: "boom" });
    expect(saved.finished_at).not.toBeNull();
  });

  test("bigint amounts in the report are stored as strings", async () => {
    const big = 9007199254740993n;
    const r = await withRun(db, { periodStart: period, step: "draft" }, async () => ({
      status: "succeeded",
      report: { drafts: [{ grossTotal: big }] },
      value: null,
    }));
    expect((await row(r.runId)).report).toEqual({ drafts: [{ grossTotal: "9007199254740993" }] });
  });

  test("lastReconcileStatus reads the latest draft run and ignores backfill runs", async () => {
    expect(await lastReconcileStatus(db, period)).toBeNull();
    await withRun(db, { periodStart: period, step: "draft" }, async () => ({ status: "blocked", report: { reconcile: { status: "blocked" } }, value: null }));
    expect(await lastReconcileStatus(db, period)).toBe("blocked");
    await withRun(db, { periodStart: period, step: "backfill" }, async () => ({ status: "succeeded", report: { reconcile: { status: "succeeded" } }, value: null }));
    expect(await lastReconcileStatus(db, period)).toBe("blocked");
    await withRun(db, { periodStart: period, step: "draft" }, async () => ({ status: "succeeded", report: { reconcile: { status: "succeeded" } }, value: null }));
    expect(await lastReconcileStatus(db, period)).toBe("succeeded");
    await withRun(db, { periodStart: period, step: "draft" }, async () => {
      throw new Error("x");
    }).catch(() => {});
    expect(await lastReconcileStatus(db, period)).toBe("failed");
  });
});

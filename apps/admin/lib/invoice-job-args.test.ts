import { describe, expect, test } from "bun:test";
import { jobArgs, previousMonth } from "./invoice-job-args";

describe("jobArgs", () => {
  test("backfill uses --from and keeps the dry run", () => {
    expect(jobArgs({ step: "backfill", month: "2026-10", entity: "", dryRun: true })).toEqual({
      ok: true,
      args: ["--step=backfill", "--from=2026-10", "--dry-run"],
    });
  });

  test("draft uses --period and passes the organization", () => {
    expect(jobArgs({ step: "draft", month: "2026-10", entity: "org_123", dryRun: false })).toEqual({
      ok: true,
      args: ["--step=draft", "--period=2026-10", "--entity=org_123"],
    });
  });

  test("the dry run is dropped for steps that have none", () => {
    expect(jobArgs({ step: "issue", month: "2026-10", entity: "", dryRun: true })).toEqual({
      ok: true,
      args: ["--step=issue", "--period=2026-10"],
    });
  });

  test("passes --open-month when asked", () => {
    expect(jobArgs({ step: "issue", month: "2026-11", entity: "", dryRun: false, openMonth: true })).toEqual({
      ok: true,
      args: ["--step=issue", "--period=2026-11", "--open-month"],
    });
  });

  test("passes --ignore-unknown-accounts only to the steps that reconcile", () => {
    expect(jobArgs({ step: "draft", month: "2026-11", entity: "", dryRun: true, ignoreUnknownAccounts: true })).toEqual({
      ok: true,
      args: ["--step=draft", "--period=2026-11", "--dry-run", "--ignore-unknown-accounts"],
    });
    expect(jobArgs({ step: "issue", month: "2026-11", entity: "", dryRun: false, ignoreUnknownAccounts: true })).toEqual({
      ok: true,
      args: ["--step=issue", "--period=2026-11"],
    });
  });

  test("refuses an unknown step, a bad month and odd organization ids", () => {
    expect(jobArgs({ step: "report", month: "2026-10", entity: "", dryRun: false }).ok).toBe(false);
    expect(jobArgs({ step: "draft", month: "2026-13", entity: "", dryRun: false }).ok).toBe(false);
    expect(jobArgs({ step: "draft", month: "2026-10", entity: "a b; rm -rf", dryRun: false }).ok).toBe(false);
  });
});

describe("previousMonth", () => {
  test("is the month before, on the Amsterdam calendar", () => {
    expect(previousMonth(new Date("2026-11-08T12:00:00Z"))).toBe("2026-10");
    expect(previousMonth(new Date("2026-01-15T12:00:00Z"))).toBe("2025-12");
    // 23:30 UTC on 31 October is already 1 November in Amsterdam.
    expect(previousMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10");
  });
});

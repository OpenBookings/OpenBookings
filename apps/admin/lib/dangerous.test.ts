/**
 * dangerousAction: what a server action hands the confirm dialog. Every
 * refusal and failure is a value with a message (Next hides thrown text in
 * production). The database is a stub: ./dangerous.db.test.ts covers the rows.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { AdminReadOnlyError } from "./db";
import { dangerousAction, type DangerousDeps } from "./dangerous";
import type { Queryable } from "./staff";

const staff = { userId: "staff-1", email: "staff@example.test" };
const TOKEN = "0b0b0b0b-0000-4000-8000-0000000000aa";

/** A database where the step-up is spent (`stepUp` rows back) and audit rows are written. */
const stubDb = (stepUp: Record<string, unknown>[] = [{ verified_kind: "totp" }]): Queryable & { sql: string[] } => {
  const sql: string[] = [];
  return {
    sql,
    query: async (text) => {
      sql.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      return { rows: /^\s*UPDATE admin_step_ups/.test(text) ? stepUp : [] };
    },
  };
};

const deps = (db: Queryable | (() => Queryable)): DangerousDeps => ({
  staff: async () => staff,
  db: typeof db === "function" ? db : () => db,
  now: () => new Date("2026-11-27T10:00:00Z"),
});

const input = { action: "booking.mark_no_show" as const, targetType: "booking", targetId: "b-1", reason: "Guest never came", stepUpToken: TOKEN };

describe("dangerousAction", () => {
  test("the action's own result", async () => {
    const db = stubDb();
    expect(await dangerousAction(input, async () => ({ ok: false, error: "not_allowed" }), deps(db))).toEqual({
      ok: true,
      value: { ok: false, error: "not_allowed" },
    });
    // The audit row, then the .refused row for the action's own refusal.
    expect(db.sql).toEqual(["UPDATE admin_step_ups SET", "INSERT INTO audit_log", "INSERT INTO audit_log"]);
  });

  test("a `kind: refused` answer is audited as refused too", async () => {
    const db = stubDb();
    const answer = { kind: "refused", error: "Scaleway: insufficient permissions" };
    expect(await dangerousAction(input, async () => answer, deps(db))).toEqual({ ok: true, value: answer });
    expect(db.sql).toEqual(["UPDATE admin_step_ups SET", "INSERT INTO audit_log", "INSERT INTO audit_log"]);
  });

  test("no reason", async () => {
    const db = stubDb();
    expect(await dangerousAction({ ...input, reason: " no " }, async () => 1, deps(db))).toEqual({
      ok: false,
      message: "Give a reason.",
    });
    expect(db.sql).toEqual([]);
  });

  test("a step-up refused", async () => {
    expect(await dangerousAction(input, async () => 1, deps(stubDb([])))).toEqual({
      ok: false,
      message: "This confirmation was used or has expired. Confirm again.",
    });
  });

  test("a read-only console", async () => {
    const readOnly = () => {
      throw new AdminReadOnlyError();
    };
    expect(await dangerousAction(input, async () => 1, deps(readOnly))).toEqual({
      ok: false,
      message: "The console is read-only here: ADMIN_DATABASE_URL_WRITE is not set.",
    });
  });

  test("an action that throws: a fixed message, the error logged", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const db = stubDb();
      const result = await dangerousAction(
        input,
        async () => {
          throw new Error("card_declined\nat stripe.js:1");
        },
        deps(db),
      );
      expect(result).toEqual({ ok: false, message: "That didn't work. The details are in the server log and the audit trail." });
      expect(db.sql).toEqual(["UPDATE admin_step_ups SET", "INSERT INTO audit_log", "INSERT INTO audit_log"]);
      expect(logged).toHaveBeenCalledTimes(1);
      // A constant format string: the ids from the request go in as values.
      expect(logged.mock.calls[0]!.slice(0, 2)).toEqual([
        "[admin] dangerous action failed",
        { action: input.action, targetType: input.targetType, targetId: input.targetId },
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  test("Next's notFound for someone who is not staff still throws", async () => {
    const { notFound } = await import("next/navigation");
    const notStaff: DangerousDeps = { ...deps(stubDb()), staff: async () => notFound() };
    await expect(dangerousAction(input, async () => 1, notStaff)).rejects.toThrow();
  });
});

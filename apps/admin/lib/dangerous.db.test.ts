/**
 * Dangerous actions (./dangerous.ts): a reason, a step-up spent, an audit row
 * written, then the action, as ob_admin_write like the server actions that
 * run them. Each test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, pendingMigrationSql } from "@openbookings/db/testing";
import { runDangerous, type DangerousDeps } from "./dangerous";
import type { Queryable, Staff } from "./staff";
import { EnrolRefused, completeTotpEnrolment, startTotpEnrolment, type EnrolDeps } from "./step-up/enrol";
import { beginStepUp, completeStepUp, StepUpError, type StepUpDeps } from "./step-up/step-up";

const BOOTSTRAP = "correct horse battery staple";
const TOTP_KEY = randomBytes(32).toString("base64");
const ACTION = "booking.cancel_rooms";
const TARGET = "0b0b0b0b-0000-4000-8000-000000000001";

describeWithDb("dangerous actions", () => {
  let db: Client;
  let staff: Staff;
  let now: Date;

  const txDb = (): StepUpDeps["db"] => ({
    query: (text, values) => db.query(text, values),
    transaction: async (fn) => {
      await db.query("SAVEPOINT step_up_tx");
      try {
        const result = await fn(db);
        await db.query("RELEASE SAVEPOINT step_up_tx");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT step_up_tx");
        throw error;
      }
    },
  });

  const enrolDeps = (): EnrolDeps => ({
    db,
    bootstrapCode: BOOTSTRAP,
    totpKey: TOTP_KEY,
    requireStepUp: async () => {
      throw new EnrolRefused("step-up");
    },
    now: () => now,
  });

  const stepUpDeps = (): StepUpDeps => ({
    db: txDb(),
    totpKey: TOTP_KEY,
    rp: async () => ({ rpID: "admin.example.test", origin: "https://admin.example.test" }),
    now: () => now,
  });

  const deps = (over: Partial<DangerousDeps> = {}): DangerousDeps => ({
    staff: async () => staff,
    db: () => db,
    now: () => now,
    ...over,
  });

  /** A verified step-up for this action and target: its token. */
  async function stepUp(action = ACTION, targetId = TARGET): Promise<string> {
    const { uri } = await startTotpEnrolment(enrolDeps(), staff, { bootstrap: BOOTSTRAP });
    const totp = OTPAuth.URI.parse(uri) as OTPAuth.TOTP;
    await completeTotpEnrolment(enrolDeps(), staff, totp.generate({ timestamp: now.getTime() }));
    now = new Date(now.getTime() + 60_000);
    const begun = await beginStepUp(stepUpDeps(), staff, action, targetId);
    if (!begun.ok) throw new Error(begun.message);
    const done = await completeStepUp(stepUpDeps(), staff, begun.id, {
      kind: "totp",
      code: totp.generate({ timestamp: now.getTime() }),
    });
    if (!done.ok) throw new Error(done.message);
    return done.token;
  }

  const auditRows = async () =>
    (
      await db.query(
        `SELECT action, actor_user_id, reason, detail FROM audit_log WHERE actor_user_id = $1 ORDER BY created_at, action`,
        [staff.userId],
      )
    ).rows;

  const stepUpUsed = async (token: string) =>
    (await db.query(`SELECT used_at FROM admin_step_ups WHERE id = $1`, [token])).rows[0]!.used_at !== null;

  /** What it threw. Nothing is rolled back: whatever it wrote stays for the test to see. */
  async function refusal(run: () => Promise<unknown>): Promise<Error> {
    try {
      await run();
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected a refusal");
  }

  const input = (over: Partial<Parameters<typeof runDangerous>[0]> = {}) => ({
    action: ACTION as typeof ACTION,
    targetType: "booking",
    targetId: TARGET,
    reason: "Guest phoned to cancel",
    stepUpToken: "",
    ...over,
  });

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
    staff = { userId: `staff-${crypto.randomUUID()}`, email: "staff@example.test" };
    now = new Date(Math.floor(Date.now() / 30_000) * 30_000 + 15_000);
    await db.query("SET LOCAL ROLE ob_admin_write");
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("refuses an empty reason without consuming the step-up", async () => {
    const token = await stepUp();
    let acted = false;
    for (const reason of ["", "    ", " abc ", undefined as unknown as string]) {
      const error = await refusal(() =>
        runDangerous(
          input({ reason, stepUpToken: token }),
          async () => {
            acted = true;
          },
          deps(),
        ),
      );
      expect(error.message).toBe("Give a reason.");
    }
    expect(acted).toBe(false);
    expect(await stepUpUsed(token)).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  test("refuses without a valid step-up and writes no audit row", async () => {
    const token = await stepUp();
    let acted = false;
    const act = async () => {
      acted = true;
    };
    for (const over of [
      { stepUpToken: "" },
      { stepUpToken: crypto.randomUUID() },
      { stepUpToken: token, targetId: "0b0b0b0b-0000-4000-8000-000000000002" },
      { stepUpToken: token, action: "booking.goodwill_refund" as typeof ACTION },
    ]) {
      expect(await refusal(() => runDangerous(input(over), act, deps()))).toBeInstanceOf(StepUpError);
    }
    // Another staff member's token is not this one's.
    const other = staff;
    staff = { userId: `staff-${crypto.randomUUID()}`, email: "other@example.test" };
    expect(await refusal(() => runDangerous(input({ stepUpToken: token }), act, deps()))).toBeInstanceOf(StepUpError);
    staff = other;

    expect(acted).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  test("writes the audit row before acting", async () => {
    const token = await stepUp();
    let seen: Record<string, unknown>[] = [];
    let actedAs: Staff | null = null;
    const result = await runDangerous(
      input({ reason: "  Guest phoned to cancel  ", stepUpToken: token, detail: { reservation_ids: ["r1"] } }),
      async (s) => {
        actedAs = s;
        seen = await auditRows();
        return "done";
      },
      deps(),
    );
    expect(result).toBe("done");
    expect(actedAs!).toEqual(staff);
    expect(seen).toEqual([
      {
        action: "admin.booking.cancel_rooms",
        actor_user_id: staff.userId,
        reason: "Guest phoned to cancel",
        detail: {
          target_type: "booking",
          target_id: TARGET,
          step_up: "totp",
          actor_email: staff.email,
          reservation_ids: ["r1"],
        },
      },
    ]);
    expect(await auditRows()).toEqual(seen);
    // Spent: the same token cannot run it again.
    expect(await refusal(() => runDangerous(input({ stepUpToken: token }), async () => "again", deps()))).toBeInstanceOf(
      StepUpError,
    );
  });

  test("does not act when the audit insert fails", async () => {
    const token = await stepUp();
    let acted = false;
    const failingInsert: Queryable = {
      query: (text, values) =>
        /INSERT\s+INTO\s+audit_log/i.test(text) ? Promise.reject(new Error("insert refused")) : db.query(text, values),
    };
    const error = await refusal(() =>
      runDangerous(
        input({ stepUpToken: token }),
        async () => {
          acted = true;
        },
        deps({ db: () => failingInsert }),
      ),
    );
    expect(error.message).toBe("insert refused");
    expect(acted).toBe(false);
    expect(await auditRows()).toEqual([]);
  });

  test("records a .refused row when the action answers with a refusal", async () => {
    const token = await stepUp();
    const result = await runDangerous(
      input({ stepUpToken: token }),
      async () => ({ ok: false as const, error: "not_allowed" }),
      deps(),
    );
    expect(result).toEqual({ ok: false, error: "not_allowed" });
    expect((await auditRows()).map((r) => [r.action, r.detail.refusal ?? null, r.detail.target_id])).toEqual([
      ["admin.booking.cancel_rooms", null, TARGET],
      ["admin.booking.cancel_rooms.refused", "not_allowed", TARGET],
    ]);
  });

  test("records no outcome row when the action succeeds", async () => {
    const token = await stepUp();
    expect(await runDangerous(input({ stepUpToken: token }), async () => ({ ok: true }), deps())).toEqual({ ok: true });
    expect((await auditRows()).map((r) => r.action)).toEqual(["admin.booking.cancel_rooms"]);
  });

  test("records a .failed row when the action throws", async () => {
    const token = await stepUp();
    const error = await refusal(() =>
      runDangerous(
        input({ stepUpToken: token }),
        async () => {
          throw new Error("Stripe said no");
        },
        deps(),
      ),
    );
    expect(error.message).toBe("Stripe said no");
    expect((await auditRows()).map((r) => [r.action, r.reason, r.detail.error ?? null])).toEqual([
      ["admin.booking.cancel_rooms", "Guest phoned to cancel", null],
      ["admin.booking.cancel_rooms.failed", "Guest phoned to cancel", "Stripe said no"],
    ]);
  });
});

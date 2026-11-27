import { unstable_rethrow } from "next/navigation";
import { AdminReadOnlyError, writePool } from "./db";
import type { DangerousAction, DangerousResult } from "./dangerous-actions";
import { requireStaff, type Queryable, type Staff } from "./staff";
import { consumeStepUp, StepUpError } from "./step-up/step-up";

export { DANGEROUS_ACTIONS, type DangerousAction, type DangerousResult } from "./dangerous-actions";

/**
 * A dangerous action (./dangerous-actions.ts) runs only with all of:
 *
 *   1. staff (Access-verified, role admin);
 *   2. a reason of at least five characters;
 *   3. a step-up for exactly this staff member, action and target, spent here;
 *   4. an audit_log row 'admin.<action>' written first: if that write fails,
 *      the action does not run.
 *
 * Then it runs. If it throws, a second row 'admin.<action>.failed' records
 * that, and the error goes on. Refusals before the action run (no reason, a
 * step-up refused) write nothing.
 *
 * The audit row is committed on its own before the action starts, so the
 * record stays even when the action's own transaction rolls back.
 *
 * Only server actions ("use server" files) call this: it uses the write
 * connection (lib/db-usage.test.ts checks that only they import it).
 */

const MIN_REASON = 5;

export type DangerousInput = {
  action: DangerousAction;
  /** What the action changes, e.g. "booking", "refund", "payment_flag". */
  targetType: string;
  /** Its id: the step-up must have been begun for exactly this. */
  targetId: string;
  reason: string;
  stepUpToken: string;
  /** More for the audit row, e.g. the rooms or the amount. */
  detail?: Record<string, unknown>;
};

export type DangerousDeps = {
  staff: () => Promise<Staff>;
  /** The write connection. Called only once staff and the reason are checked. */
  db: () => Queryable;
  now: () => Date;
};

const liveDeps: DangerousDeps = { staff: requireStaff, db: writePool, now: () => new Date() };

/** A refusal before anything ran, with a message to show as it is. */
export class DangerousRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DangerousRefused";
  }
}

const audit = (db: Queryable, action: string, staff: Staff, reason: string, detail: Record<string, unknown>) =>
  db.query(`INSERT INTO audit_log (action, actor_user_id, reason, detail) VALUES ($1, $2, $3, $4::jsonb)`, [
    action,
    staff.userId,
    reason,
    JSON.stringify(detail),
  ]);

/** An error's first line, short enough for a message and an audit row. */
export function shortError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split("\n", 1)[0]!.trim() || "unknown error";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

export async function runDangerous<T>(
  i: DangerousInput,
  act: (staff: Staff) => Promise<T>,
  deps: DangerousDeps = liveDeps,
): Promise<T> {
  const staff = await deps.staff();
  const reason = typeof i.reason === "string" ? i.reason.trim() : "";
  if (reason.length < MIN_REASON) throw new DangerousRefused("Give a reason.");

  const db = deps.db();
  const stepUp = await consumeStepUp(db, {
    token: i.stepUpToken,
    userId: staff.userId,
    action: i.action,
    targetId: i.targetId,
    now: deps.now(),
  });

  const detail = {
    target_type: i.targetType,
    target_id: i.targetId,
    step_up: stepUp,
    actor_email: staff.email,
    ...i.detail,
  };
  await audit(db, `admin.${i.action}`, staff, reason, detail);

  try {
    return await act(staff);
  } catch (error) {
    try {
      await audit(db, `admin.${i.action}.failed`, staff, reason, { ...detail, error: shortError(error) });
    } catch (auditError) {
      console.error(`[admin] could not record that ${i.action} failed`, auditError);
    }
    throw error;
  }
}

/**
 * runDangerous for a server action: refusals and failures come back as a
 * message, because Next hides a thrown error's text from the browser in
 * production. Next's own errors (notFound for non-staff) still throw.
 */
export async function dangerousAction<T>(
  i: DangerousInput,
  act: (staff: Staff) => Promise<T>,
  deps: DangerousDeps = liveDeps,
): Promise<DangerousResult<T>> {
  try {
    return { ok: true, value: await runDangerous(i, act, deps) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof DangerousRefused || error instanceof AdminReadOnlyError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof StepUpError) {
      return { ok: false, message: "This confirmation was used or has expired. Confirm again." };
    }
    console.error(`[admin] ${i.action} on ${i.targetType} ${i.targetId} failed`, error);
    return { ok: false, message: `That didn't work: ${shortError(error)}` };
  }
}

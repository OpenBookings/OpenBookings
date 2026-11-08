import type { Queryable } from "@openbookings/db";

export type Step = "backfill" | "draft" | "issue" | "store" | "deliver" | "report";
export type RunStatus = "running" | "succeeded" | "blocked" | "failed";

/** Makes a report storable as JSON: bigint amounts become decimal strings, never numbers. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

/**
 * Records one run of a job step: a `running` row first, then `succeeded` or
 * `blocked` with the report the work returns. If the work throws, the row is
 * set to `failed` with `{ error }` and the error is rethrown. Uses `db` as
 * given, with no transaction of its own; the work manages its own.
 *
 * A dry run (`dryRun: true`) carries `{ dryRun: true }` in its report from
 * the moment the row is written, in its final report and in its failure
 * report alike, so `lastReconcileStatus` never takes a dry run, running,
 * finished or failed, for the real draft run of the period.
 */
export async function withRun<T>(
  db: Queryable,
  input: { periodStart: string; step: Step; dryRun?: boolean },
  work: (runId: string) => Promise<{ status: "succeeded" | "blocked"; report: object; value: T }>,
): Promise<{ runId: string; status: "succeeded" | "blocked"; report: object; value: T }> {
  const mark = input.dryRun ? { dryRun: true } : null;
  const { rows } = await db.query(
    `INSERT INTO invoice_runs (period_start, step, status, started_at, report)
     VALUES ($1, $2, 'running', clock_timestamp(), $3::jsonb) RETURNING id`,
    [input.periodStart, input.step, mark ? JSON.stringify(mark) : null],
  );
  const runId = (rows[0] as { id: string }).id;
  try {
    const result = await work(runId);
    const report = mark ? { ...result.report, ...mark } : result.report;
    await db.query(`UPDATE invoice_runs SET status = $2, finished_at = clock_timestamp(), report = $3::jsonb WHERE id = $1`, [
      runId,
      result.status,
      JSON.stringify(toJsonSafe(report)),
    ]);
    return { runId, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(`UPDATE invoice_runs SET status = 'failed', finished_at = clock_timestamp(), report = $2::jsonb WHERE id = $1`, [
      runId,
      JSON.stringify({ ...mark, error: message }),
    ]);
    throw err;
  }
}

/**
 * How reconciliation went in the latest draft run of the period: the run's
 * recorded reconcile status, `failed` when that run failed, null when there
 * is no draft run (or it is still running). Backfill runs and dry runs
 * (`report.dryRun` true) never count: a run that wrote nothing must never
 * unlock issuing.
 */
export async function lastReconcileStatus(db: Queryable, periodStart: string): Promise<"succeeded" | "blocked" | "failed" | null> {
  const { rows } = await db.query(
    `SELECT status, report->'reconcile'->>'status' AS reconcile
       FROM invoice_runs
      WHERE period_start = $1 AND step = 'draft' AND (report->>'dryRun') IS DISTINCT FROM 'true'
      ORDER BY started_at DESC LIMIT 1`,
    [periodStart],
  );
  const row = rows[0] as { status: RunStatus; reconcile: string | null } | undefined;
  if (!row) return null;
  if (row.status === "failed") return "failed";
  if (row.status !== "succeeded" && row.status !== "blocked") return null;
  return row.reconcile === "succeeded" || row.reconcile === "blocked" ? row.reconcile : null;
}

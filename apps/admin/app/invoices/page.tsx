import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents } from "@openbookings/pricing/money";
import { readPool } from "@/lib/db";
import { previousMonth, RUN_STARTED_ACTION } from "@/lib/invoice-job-args";
import { getJobRun, scalewayJobConfig, type JobRunState } from "@/lib/scaleway-jobs";
import { databaseHost } from "@/lib/super-admin";
import { requireStaff } from "@/lib/staff";
import { RunForm } from "./run-form";

type RunRow = { step: string; period: string; status: string; dry_run: boolean; started: string; seconds: number | null };
type InvoiceRow = { number: string | null; period: string; status: string; doc_type: string; gross: string; billing_entity_id: string };

const euro = (cents: string) =>
  formatCents(Number(cents), { whole: "always-decimals" });

type Latest = { runId: string; startedBy: string | null; at: string; run: JobRunState | null; error: string | null };

/** The run the newest 'started' audit row names, and Scaleway's word on it now (one fetch per page load). */
async function latestScalewayRun(db: ReturnType<typeof readPool>): Promise<Latest | null> {
  const { rows } = await db.query(
    `SELECT detail, to_char(created_at AT TIME ZONE 'Europe/Amsterdam', 'DD Mon HH24:MI') AS at
       FROM audit_log WHERE action = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [RUN_STARTED_ACTION],
  );
  const row = rows[0] as { detail: { run_id?: string; actor_email?: string }; at: string } | undefined;
  const runId = row?.detail?.run_id;
  if (!row || typeof runId !== "string") return null;
  const base = { runId, startedBy: row.detail.actor_email ?? null, at: row.at };
  const cfg = scalewayJobConfig();
  if (!cfg) return { ...base, run: null, error: "Scaleway settings are missing, so the state can't be read." };
  try {
    return { ...base, run: await getJobRun(cfg, runId), error: null };
  } catch (error) {
    return { ...base, run: null, error: error instanceof Error ? error.message : "Could not read the run." };
  }
}

function LatestRun({ latest }: { latest: Latest | null }) {
  if (!latest) return <p className="text-sm text-muted-foreground">No job run started from here yet.</p>;
  const { run } = latest;
  return (
    <p className="text-sm">
      Latest job run <span className="font-mono text-xs">{latest.runId}</span>, started {latest.at}
      {latest.startedBy ? ` by ${latest.startedBy}` : ""}:{" "}
      {run ? (
        <>
          <span className="font-medium">{run.state}</span>
          {run.exitCode !== undefined ? ` (exit ${run.exitCode})` : ""}
          {run.finishedAt ? `, finished ${run.finishedAt}` : ""}
        </>
      ) : (
        <span className="text-red-600">{latest.error}</span>
      )}
    </p>
  );
}

/**
 * Runs the monthly invoice job by hand. In production that starts the
 * Scaleway job and this page follows the latest run; in development it runs
 * the job here against the dev database and a Stripe test key.
 */
export default async function InvoicesPage() {
  await requireStaff();
  const db = readPool();
  const ready = (await db.query(`SELECT to_regclass('public.invoice_runs') IS NOT NULL AS ok`)).rows[0]?.ok === true;

  const production = process.env.NODE_ENV === "production";
  const latest = production ? await latestScalewayRun(db) : null;

  const [runs, invoices] = ready
    ? await Promise.all([
        db.query(
          `SELECT step, to_char(period_start, 'YYYY-MM') AS period, status,
                  COALESCE(report->>'dryRun' = 'true', false) AS dry_run,
                  to_char(started_at AT TIME ZONE 'Europe/Amsterdam', 'DD Mon HH24:MI:SS') AS started,
                  EXTRACT(EPOCH FROM finished_at - started_at)::int AS seconds
           FROM invoice_runs ORDER BY started_at DESC LIMIT 15`,
        ),
        db.query(
          `SELECT number, to_char(period_start, 'YYYY-MM') AS period, status, doc_type,
                  gross_total::text AS gross, billing_entity_id
           FROM invoices ORDER BY period_start DESC, number NULLS FIRST LIMIT 20`,
        ),
      ])
    : [{ rows: [] }, { rows: [] }];

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-lg font-semibold">Invoice job</h1>
        <p className="text-sm text-muted-foreground">
          Database {databaseHost(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL)} · INVOICE_DB_ENV{" "}
          {process.env.INVOICE_DB_ENV || "test (default here)"}. Order: backfill → draft → issue (also stores) → deliver.
          Deliver in test mode needs INVOICE_TEST_RECIPIENT.
        </p>
        {!ready && <p className="text-sm text-red-600">Migration 0036 is not on this database yet.</p>}
        {production && <LatestRun latest={latest} />}
        <RunForm defaultMonth={previousMonth()} production={production} />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Recent runs</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Step</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Took</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(runs.rows as RunRow[]).map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.started}</TableCell>
                <TableCell>
                  {r.step}
                  {r.dry_run ? " (dry run)" : ""}
                </TableCell>
                <TableCell>{r.period}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{r.seconds === null ? "—" : `${r.seconds}s`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Invoices</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Month</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Organization</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(invoices.rows as InvoiceRow[]).map((r, i) => (
              <TableRow key={i}>
                <TableCell>{r.number ?? "draft"}</TableCell>
                <TableCell>{r.period}</TableCell>
                <TableCell>{r.doc_type}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{euro(r.gross)}</TableCell>
                <TableCell className="font-mono text-xs">{r.billing_entity_id}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

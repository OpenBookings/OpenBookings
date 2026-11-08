import { getPool } from "@openbookings/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { previousMonth } from "@/lib/invoice-job-args";
import { databaseHost, requireSuperAdmin } from "@/lib/super-admin";
import { RunForm } from "./run-form";

type RunRow = { step: string; period: string; status: string; dry_run: boolean; started: string; seconds: number | null };
type InvoiceRow = { number: string | null; period: string; status: string; doc_type: string; gross: string; billing_entity_id: string };

const euro = (cents: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(cents) / 100);

/** Runs the monthly invoice job by hand, against this app's database and Stripe test key. Dev only. */
export default async function InvoicesPage() {
  requireSuperAdmin();
  const db = getPool();
  const ready = (await db.query(`SELECT to_regclass('public.invoice_runs') IS NOT NULL AS ok`)).rows[0]?.ok === true;

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
        <RunForm defaultMonth={previousMonth()} />
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

/**
 * The monthly commission-invoice job: one step per run.
 *
 *   bun run src/main.ts --step=draft|issue|store|deliver|report|backfill [options]
 *
 * See README.md for the options, the environment and the monthly runbook.
 * Every step is recorded as an `invoice_runs` row with its report. Exit code
 * 0 when the step succeeded, 2 when it was blocked (something needs a human),
 * 1 when it failed.
 */
import "./instrument";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Sentry from "@sentry/bun";
import { renderRunReport, sendRunReport } from "@openbookings/billing/notify";
import type { Period } from "@openbookings/billing/period";
import { getBillingProfile } from "@openbookings/billing/profiles";
import { loadInvoiceDocument } from "@openbookings/billing/render/document";
import { renderPdf } from "@openbookings/billing/render/pdf";
import { toJsonSafe, withRun } from "@openbookings/billing/runs";
import { sellerFromEnv } from "@openbookings/billing/seller";
import { runDeliver } from "@openbookings/billing/steps/deliver";
import { runDraft } from "@openbookings/billing/steps/draft";
import { buyerFromProfile, runIssue } from "@openbookings/billing/steps/issue";
import { reconcile, type ReconcileResult } from "@openbookings/billing/steps/reconcile";
import { runReport } from "@openbookings/billing/steps/report";
import { runStore } from "@openbookings/billing/steps/store";
import { checkVatId } from "@openbookings/billing/vies";
import { createR2Store } from "@openbookings/billing/storage/r2";
import { lettermintInvoiceMailer } from "@openbookings/billing/deliver/lettermint";
import { amsterdamDate, ArgsError, backfillMonths, parseArgs, quarterStart, USAGE, type JobArgs } from "./args";
import { jobDeps, type Env, type JobDeps } from "./deps";
import { assertModeMatch, deliverTestRecipient } from "./guards";

type Outcome = "succeeded" | "blocked";

type Context = { args: JobArgs; env: Env; mode: "live" | "test"; now: Date; deps: JobDeps };

/** Local output (draft previews, quarterly reports), relative to where the job is started. */
const OUT_DIR = "out";

const worst = (...outcomes: Outcome[]): Outcome => (outcomes.includes("blocked") ? "blocked" : "succeeded");
const month = (p: Period) => p.start.slice(0, 7);
const print = (title: string, report: unknown) => console.log(`${title}\n${JSON.stringify(toJsonSafe(report), null, 2)}`);

/** Raises something a human has to look at, on Sentry and on Slack when configured. */
async function alert(ctx: Context, message: string, extra: object): Promise<void> {
  Sentry.captureMessage(message, { level: "error", tags: { step: ctx.args.step }, extra: toJsonSafe(extra) as Record<string, unknown> });
  await ctx.deps.slack?.(`OpenBookings invoices: ${message}`).catch((error: unknown) => Sentry.captureException(error));
}

const DRAFT_MONITOR = {
  schedule: { type: "crontab", value: "0 6 1 * *" },
  timezone: "Europe/Amsterdam",
} as const;

/**
 * Reconciles the month and drafts every eligible host's document, then
 * prints the run report and, unless it is a dry run, emails it (and posts it
 * to Slack). Blocked when reconciliation blocked or any host is blocked. The
 * real run checks in with the Sentry cron monitor `invoice-draft`.
 */
async function draft(ctx: Context): Promise<Outcome> {
  if (ctx.args.preview) return preview(ctx);
  const { args, deps } = ctx;
  const notify = args.dryRun ? null : deps.runReport();
  const viesDeps = deps.viesDeps();

  const work = async (): Promise<Outcome> => {
    const run = await withRun(deps.pool, { periodStart: args.period.start, step: "draft", dryRun: args.dryRun }, async (runId) => {
      const report = await runDraft(args.period, {
        db: deps.pool,
        stripe: deps.stripeSource(),
        ledger: deps.ledger(),
        inTransaction: deps.inTransaction,
        vies: checkVatId,
        viesDeps,
        now: () => new Date(),
        entity: args.entity,
        dryRun: args.dryRun,
        runId,
      });
      const status: Outcome = report.reconcile.status === "blocked" || report.blocked.length > 0 ? "blocked" : "succeeded";
      return { status, report, value: report };
    });
    console.log(renderRunReport(run.value));
    if (notify) await sendRunReport(run.value, notify);
    return run.status;
  };
  return args.dryRun ? work() : Sentry.withMonitor("invoice-draft", work, DRAFT_MONITOR);
}

/** Renders one host's current draft to `out/DRAFT-{entity}-{period}.pdf`, watermarked; nothing is written to the database or R2. */
async function preview(ctx: Context): Promise<Outcome> {
  const { args, deps, env } = ctx;
  const entity = args.entity!;
  const { rows } = await deps.pool.query(
    `SELECT id FROM invoices WHERE billing_entity_id = $1 AND period_start = $2 AND status = 'draft'`,
    [entity, args.period.start],
  );
  const draftId = (rows[0] as { id: string } | undefined)?.id;
  if (!draftId) throw new Error(`No draft for ${entity} in ${month(args.period)}: run --step=draft first`);
  const profile = await getBillingProfile(deps.pool, entity);
  if (!profile) throw new Error(`Organization ${entity} has no billing profile`);

  // Placeholders for missing seller details: a preview is never sent.
  const doc = await loadInvoiceDocument(deps.pool, draftId, { seller: sellerFromEnv(env, "test"), buyer: buyerFromProfile(profile) });
  const pdf = await renderPdf(doc, { watermark: "DRAFT" });
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `DRAFT-${entity.replace(/[^\w.-]/g, "_")}-${month(args.period)}.pdf`);
  await writeFile(path, pdf);
  console.log(`Wrote ${path}`);
  return "succeeded";
}

/**
 * Issues the period's drafts (numbers, snapshots, linked entries), then
 * stores their files as a run of its own, so a store that fails can be
 * retried with `--step=store` without issuing again. Blocked when any draft
 * was skipped (which also alerts) or a file conflicts.
 */
async function issue(ctx: Context): Promise<Outcome> {
  const { args, deps } = ctx;
  const run = await withRun(deps.pool, { periodStart: args.period.start, step: "issue" }, async () => {
    const report = await runIssue(args.period, {
      db: deps.pool,
      inTransaction: deps.inTransaction,
      env: ctx.env,
      mode: ctx.mode,
      today: amsterdamDate(ctx.now),
      entity: args.entity,
    });
    return { status: report.skipped.length ? "blocked" : "succeeded", report, value: report };
  });
  print(`Issue ${month(args.period)}: ${run.status}`, run.report);
  if (run.value.skipped.length) {
    await alert(ctx, `${run.value.skipped.length} draft(s) skipped at issue — rerun draft for those hosts`, run.value);
  }
  return worst(run.status, await store(ctx));
}

/** Stores every issued invoice's PDF and CSV in R2 that is not stored yet. A file already there with other content stops the run and alerts. */
async function store(ctx: Context): Promise<Outcome> {
  const { args, deps } = ctx;
  const objects = createR2Store(ctx.env);
  const run = await withRun(deps.pool, { periodStart: args.period.start, step: "store" }, async () => {
    const report = await runStore(args.period, { db: deps.pool, store: objects });
    return { status: report.conflicts.length ? "blocked" : "succeeded", report, value: report };
  });
  print(`Store ${month(args.period)}: ${run.status}`, run.report);
  if (run.value.conflicts.length) {
    await alert(ctx, `stored file conflict for ${run.value.conflicts.join(", ")}: an object with other content is already in R2`, run.value);
  }
  return run.status;
}

/** Emails every stored, issued invoice of the period that is not sent yet (in test mode all to `INVOICE_TEST_RECIPIENT`, which is required there). Blocked when a send failed or an invoice has no billing email. */
async function deliver(ctx: Context): Promise<Outcome> {
  const { args, deps } = ctx;
  const testRecipient = deliverTestRecipient(ctx.mode, ctx.env);
  const objects = createR2Store(ctx.env);
  const run = await withRun(deps.pool, { periodStart: args.period.start, step: "deliver" }, async () => {
    const report = await runDeliver(args.period, { db: deps.pool, store: objects, mail: lettermintInvoiceMailer(), testRecipient });
    return { status: report.failed.length || report.skipped.length ? "blocked" : "succeeded", report, value: report };
  });
  print(`Deliver ${month(args.period)}: ${run.status}`, run.report);
  if (run.value.failed.length || run.value.skipped.length) {
    await alert(ctx, `${run.value.failed.length} invoice(s) failed to send, ${run.value.skipped.length} have no billing email`, run.value);
  }
  return run.status;
}

/** Writes the quarter's VAT-return, ICP, DAC7, returned-payments and Stripe-reconciliation CSVs under `out/`. */
async function report(ctx: Context): Promise<Outcome> {
  const { args, deps } = ctx;
  const quarter = args.quarter!;
  const run = await withRun(deps.pool, { periodStart: quarterStart(quarter), step: "report" }, async () => {
    const files = await runReport(quarter, { db: deps.pool, outDir: OUT_DIR });
    return { status: "succeeded", report: { quarter, files }, value: files };
  });
  console.log(`Report ${quarter}:\n${run.value.map((f) => `  ${f}`).join("\n")}`);
  return run.status;
}

const blockers = (r: ReconcileResult) =>
  r.missingInStripe.length + r.amountMismatches.length + r.unknownAccounts.length + r.unsettled.length + r.missingProfiles.length + r.notYetReturned.length;

/**
 * Reconciles every month from `--from` through last month, one run per month
 * (step `backfill`), and prints a line per month. Drafts nothing, and never
 * stands in for a draft run: issuing still needs one. Stops at the first
 * month that fails.
 */
async function backfill(ctx: Context): Promise<Outcome> {
  const { args, deps } = ctx;
  const source = deps.stripeSource();
  const ledger = deps.ledger();
  const outcomes: Outcome[] = [];
  if (args.dryRun) console.log("DRY RUN: nothing is written and no money moves.");
  for (const period of backfillMonths(args.from!, ctx.now, args.openMonth)) {
    const run = await withRun(deps.pool, { periodStart: period.start, step: "backfill", dryRun: args.dryRun }, async () => {
      const result = await reconcile(period, { db: deps.pool, stripe: source, ledger, dryRun: args.dryRun, inTransaction: deps.inTransaction });
      return { status: result.status, report: { dryRun: args.dryRun, reconcile: result }, value: result };
    });
    const r = run.value;
    console.log(`${month(period)}: ${run.status}, backfilled ${r.backfilled.length}, returned ${r.returned.length}, blockers ${blockers(r)}`);
    if (run.status === "blocked") {
      const detail = {
        unknownAccounts: r.unknownAccounts,
        unsettled: r.unsettled,
        missingProfiles: r.missingProfiles,
        missingInStripe: r.missingInStripe,
        amountMismatches: r.amountMismatches,
        notYetReturned: r.notYetReturned,
      };
      for (const [name, list] of Object.entries(detail)) if (list.length) console.log(`  ${name}: ${JSON.stringify(list)}`);
    }
    outcomes.push(run.status);
  }
  return worst(...outcomes);
}

const STEPS = { draft, issue, store, deliver, report, backfill } satisfies Record<JobArgs["step"], (ctx: Context) => Promise<Outcome>>;

/**
 * Runs the step the command line asks for and returns the exit code: 0
 * succeeded, 2 blocked, 1 failed (bad arguments, a guard refused, or the
 * step threw). Refuses a live Stripe key against a non-production database
 * and the reverse before touching either. Every failure is reported to Sentry.
 */
export async function main(argv: string[], env: Env, now = new Date()): Promise<number> {
  let args: JobArgs;
  try {
    args = parseArgs(argv, now);
  } catch (error) {
    if (!(error instanceof ArgsError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  Sentry.setTag("step", args.step);
  try {
    const mode = assertModeMatch(env);
    Sentry.setTag("mode", mode);
    if (args.openMonth && mode !== "test") throw new Error("--open-month is for test mode only: a live month is invoiced once it is over");
    console.log(`invoice-job: --step=${args.step} ${args.quarter ?? month(args.from ?? args.period)}${args.dryRun ? " (dry run)" : ""}, ${mode} mode`);
    const outcome = await STEPS[args.step]({ args, env, mode, now, deps: jobDeps(env) });
    return outcome === "blocked" ? 2 : 0;
  } catch (error) {
    Sentry.captureException(error, { tags: { step: args.step } });
    console.error(`${args.step} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2), process.env);
  await Sentry.flush(5_000);
  if (process.env.DATABASE_URL) {
    const { getPool } = await import("@openbookings/db");
    await getPool()
      .end()
      .catch(() => {});
  }
  process.exit(code);
}

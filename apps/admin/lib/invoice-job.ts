"use server";

import { spawn } from "node:child_process";
import path from "node:path";
import { dangerousAction } from "./dangerous";
import type { Confirmation, DangerousResult } from "./dangerous-actions";
import { adminDbConfig, writePool } from "./db";
import { isDryRun, jobArgs, RUN_STARTED_ACTION, runSummary, runTarget, type JobInput } from "./invoice-job-args";
import { missingJobSettings, scalewayJobConfig, startJobRun } from "./scaleway-jobs";
import { stripeKeyAllowed } from "./super-admin";
import { requireStaff, type Staff } from "./staff";

export type JobRun =
  | { kind: "done"; command: string; code: number | null; timedOut: boolean; seconds: number; output: string }
  | { kind: "started"; runId: string; dryRun: boolean }
  | { kind: "refused"; error: string };

/** Long enough for a real month; a run that takes longer is stuck, and its output so far shows where. */
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 200_000;

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Runs one step of the invoice job (apps/invoice-job).
 *
 * Production: starts the Scaleway Serverless Job (./scaleway-jobs.ts) with
 * the step's arguments, because this app has no full-access database URL.
 * Only a dry run starts here; any other run sends or changes real records and
 * goes through runInvoiceJobConfirmed (reason and step-up). Missing Scaleway
 * settings are a refusal that names them.
 *
 * Development: runs the job as a child process with this app's environment
 * and returns everything it printed, each line stamped with the seconds since
 * start. A live Stripe key is refused here, and the job itself also refuses a
 * live key against a test database and the reverse.
 */
export async function runInvoiceJob(_prev: JobRun | null, form: FormData): Promise<JobRun> {
  const staff = await requireStaff();
  const built = build(form);
  if (!built.ok) return refused(built.error);

  if (isProduction()) {
    if (!isDryRun(built.args)) return refused("This run changes real records or sends email: confirm it with a reason first.");
    const started = await startInProduction(staff, built.args, "dry run", { dry_run: true });
    return started;
  }

  if (!stripeKeyAllowed().ok) return refused("Stripe is not in test mode here, so the invoice job is disabled.");
  // The job needs DATABASE_URL's full access, which the admin roles are there to avoid.
  if (adminDbConfig().kind === "roles") {
    return refused("The invoice job runs on DATABASE_URL, so it is off while ADMIN_DATABASE_URL_READ is set.");
  }
  return runChildProcess(built.args);
}

/**
 * A production run that is not a dry run: dangerous (./dangerous.ts), for the
 * step, month and organization as target. Not available outside production,
 * where the child process path needs no confirmation.
 */
export async function runInvoiceJobConfirmed(form: FormData, confirm: Confirmation): Promise<DangerousResult<JobRun>> {
  await requireStaff();
  if (!isProduction()) return { ok: true, value: refused("Confirmed runs start the Scaleway job, which is production only.") };
  const built = build(form);
  if (!built.ok) return { ok: true, value: refused(built.error) };
  if (isDryRun(built.args)) return { ok: true, value: refused("A dry run needs no confirmation.") };
  const settings = jobSettingsRefusal();
  if (settings) return { ok: true, value: settings };

  return dangerousAction(
    {
      action: "invoices.run",
      targetType: "invoice_run",
      targetId: runTarget(built.input),
      reason: confirm?.reason,
      stepUpToken: confirm?.stepUpToken,
      detail: { summary: runSummary(built.input), args: built.args },
    },
    (staff) => startInProduction(staff, built.args, "run", { dry_run: false }),
  );
}

const refused = (error: string): JobRun => ({ kind: "refused", error });

function build(form: FormData): { ok: true; input: JobInput; args: string[] } | { ok: false; error: string } {
  const input: JobInput = {
    step: String(form.get("step") ?? ""),
    month: String(form.get("month") ?? ""),
    entity: String(form.get("entity") ?? ""),
    dryRun: form.get("dryRun") === "on",
    openMonth: form.get("openMonth") === "on",
    ignoreUnknownAccounts: form.get("ignoreUnknownAccounts") === "on",
  };
  const built = jobArgs(input);
  return built.ok ? { ok: true, input, args: built.args } : built;
}

function jobSettingsRefusal(): JobRun | null {
  if (scalewayJobConfig()) return null;
  return refused(`Invoice runs start a Scaleway job, and these settings are missing: ${missingJobSettings().join(", ")}.`);
}

async function startInProduction(staff: Staff, args: string[], what: string, detail: Record<string, unknown>): Promise<JobRun> {
  const missing = jobSettingsRefusal();
  if (missing) return missing;
  const cfg = scalewayJobConfig()!;
  let runId: string;
  try {
    ({ runId } = await startJobRun(cfg, args));
  } catch (error) {
    // The message is Scaleway's own; the key never appears in it.
    return refused(`The job did not start (${error instanceof Error ? error.message : "unknown error"}).`);
  }
  try {
    await writePool().query(`INSERT INTO audit_log (action, actor_user_id, reason, detail) VALUES ($1, $2, $3, $4::jsonb)`, [
      RUN_STARTED_ACTION,
      staff.userId,
      `invoice job ${what} started`,
      JSON.stringify({ target_type: "invoice_run", target_id: runId, run_id: runId, args, actor_email: staff.email, ...detail }),
    ]);
  } catch (error) {
    // The job is running either way; only the page's link to it is lost.
    console.error("[admin] could not record the started invoice run", runId, error);
  }
  return { kind: "started", runId, dryRun: detail.dry_run === true };
}

function runChildProcess(jobArgv: string[]): Promise<JobRun> {
  const repoRoot = path.resolve(process.cwd(), "../..");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The job drives explicit transactions, which Neon's pooler does not keep.
    DATABASE_URL: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
    INVOICE_DB_ENV: process.env.INVOICE_DB_ENV || "test",
  };
  const args = ["run", "apps/invoice-job/src/main.ts", ...jobArgv];
  const started = Date.now();
  const stamp = () => `[${Math.round((Date.now() - started) / 1000)}s] `;

  return new Promise<JobRun>((resolve) => {
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      if (output.length > MAX_OUTPUT) return;
      const text = chunk.toString("utf8");
      output += text
        .split("\n")
        .map((line, i, all) => (i === all.length - 1 && line === "" ? "" : stamp() + line))
        .join("\n");
    };

    const child = spawn("bun", args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const finish = (code: number | null, extra = "") => {
      clearTimeout(timer);
      resolve({
        kind: "done",
        command: `bun ${args.join(" ")}`,
        code,
        timedOut,
        seconds: Math.round((Date.now() - started) / 1000),
        output: output + extra,
      });
    };
    child.on("error", (error) => finish(null, `${stamp()}could not start the job: ${error.message}\n`));
    child.on("close", (code) => finish(code));
  });
}

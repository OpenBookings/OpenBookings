"use server";

import { spawn } from "node:child_process";
import path from "node:path";
import { jobArgs } from "./invoice-job-args";
import { isStripeTestMode, requireSuperAdmin } from "./super-admin";

export type JobRun =
  | { kind: "done"; command: string; code: number | null; timedOut: boolean; seconds: number; output: string }
  | { kind: "refused"; error: string };

/** Long enough for a real month; a run that takes longer is stuck, and its output so far shows where. */
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 200_000;

/**
 * Runs one step of the invoice job (apps/invoice-job) as a child process
 * with this app's environment, and returns everything it printed, each line
 * stamped with the seconds since start. Test mode only, like the other real
 * actions here: the job itself also refuses a live key against a test
 * database and the reverse.
 */
export async function runInvoiceJob(_prev: JobRun | null, form: FormData): Promise<JobRun> {
  requireSuperAdmin();
  if (!isStripeTestMode()) return { kind: "refused", error: "Stripe is not in test mode here, so the invoice job is disabled." };

  const built = jobArgs({
    step: String(form.get("step") ?? ""),
    month: String(form.get("month") ?? ""),
    entity: String(form.get("entity") ?? ""),
    dryRun: form.get("dryRun") === "on",
  });
  if (!built.ok) return { kind: "refused", error: built.error };

  const repoRoot = path.resolve(process.cwd(), "../..");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The job drives explicit transactions, which Neon's pooler does not keep.
    DATABASE_URL: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
    INVOICE_DB_ENV: process.env.INVOICE_DB_ENV || "test",
  };
  const args = ["run", "apps/invoice-job/src/main.ts", ...built.args];
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

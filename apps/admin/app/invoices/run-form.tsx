"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import { DangerousDialog } from "@/components/dangerous-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runInvoiceJob, runInvoiceJobConfirmed, type JobRun } from "@/lib/invoice-job";
import { isDryRun, JOB_STEPS, jobArgs, runSummary, runTarget } from "@/lib/invoice-job-args";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

const outcome = (run: Extract<JobRun, { kind: "done" }>) =>
  run.timedOut
    ? `Stopped after ${run.seconds}s: it hung. The last line shows where.`
    : run.code === 0
      ? `Succeeded in ${run.seconds}s`
      : run.code === 2
        ? `Blocked (needs a human) after ${run.seconds}s`
        : `Failed (exit ${run.code}) after ${run.seconds}s`;

/** A run waiting for the confirm dialog: the form as submitted, what it will do, and what the step-up is bound to. */
type Pending = { data: FormData; summary: string; target: string };

/**
 * In production a run that is not a dry run asks for a reason and a step-up
 * first (the server refuses it otherwise); a dry run starts straight away.
 * Elsewhere every run starts straight away.
 */
export function RunForm({ defaultMonth, production }: { defaultMonth: string; production: boolean }) {
  const router = useRouter();
  const [run, action, pending] = useActionState<JobRun | null, FormData>(runInvoiceJob, null);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [confirmed, setConfirmed] = useState<JobRun | null>(null);
  const shown = confirmed ?? run;

  /** The form's values as the server reads them, to decide whether this run needs the dialog. */
  function needsConfirmation(data: FormData): Pending | null {
    const input = {
      step: String(data.get("step") ?? ""),
      month: String(data.get("month") ?? ""),
      entity: String(data.get("entity") ?? ""),
      dryRun: data.get("dryRun") === "on",
      openMonth: data.get("openMonth") === "on",
      ignoreUnknownAccounts: data.get("ignoreUnknownAccounts") === "on",
    };
    const built = jobArgs(input);
    // Invalid input goes to the server, which says what is wrong.
    if (!production || !built.ok || isDryRun(built.args)) return null;
    return { data, summary: runSummary(input), target: runTarget(input) };
  }

  return (
    <div className="space-y-4">
      {/* onSubmit, not `action`, so the chosen options survive the run instead of resetting. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setConfirmed(null);
          const needs = needsConfirmation(data);
          if (needs) setConfirming(needs);
          else startTransition(() => action(data));
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-sm">
          Step
          <select name="step" defaultValue="backfill" className={selectClass}>
            {JOB_STEPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Month (backfill: from)
          <Input name="month" type="month" defaultValue={defaultMonth} className="w-40" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Organization id (optional)
          <Input name="entity" placeholder="all hosts" className="w-64" />
        </label>
        <label className="flex items-center gap-2 text-sm h-9">
          <input type="checkbox" name="dryRun" defaultChecked />
          Dry run (backfill, draft)
        </label>
        {!production && (
          <>
            <label className="flex items-center gap-2 text-sm h-9">
              <input type="checkbox" name="openMonth" />
              Allow the current month (test only)
            </label>
            <label className="flex items-center gap-2 text-sm h-9">
              <input type="checkbox" name="ignoreUnknownAccounts" />
              Ignore unknown Stripe accounts (test only)
            </label>
          </>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Running…" : "Run"}
        </Button>
      </form>

      {confirming ? (
        <DangerousDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          action="invoices.run"
          targetId={confirming.target}
          summary={confirming.summary}
          onConfirm={async (reason, stepUpToken) => {
            const answer = await runInvoiceJobConfirmed(confirming.data, { reason, stepUpToken });
            if (!answer.ok) return answer.message;
            if (answer.value.kind === "refused") return answer.value.error;
            setConfirmed(answer.value);
            router.refresh();
            return null;
          }}
        />
      ) : null}

      {shown?.kind === "refused" && <p className="text-sm text-red-600">{shown.error}</p>}
      {shown?.kind === "started" && (
        <p className="text-sm font-medium">
          Started {shown.dryRun ? "a dry run" : "the job"} on Scaleway (run <span className="font-mono">{shown.runId}</span>). Its state
          is shown above and updates when the page reloads.
        </p>
      )}
      {shown?.kind === "done" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{outcome(shown)}</p>
          <p className="text-xs text-muted-foreground font-mono">{shown.command}</p>
          <pre className="max-h-[32rem] overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap">
            {shown.output || "(no output)"}
          </pre>
        </div>
      )}
    </div>
  );
}

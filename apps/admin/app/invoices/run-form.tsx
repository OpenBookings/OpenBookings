"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runInvoiceJob, type JobRun } from "@/lib/invoice-job";
import { JOB_STEPS } from "@/lib/invoice-job-args";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

const outcome = (run: Extract<JobRun, { kind: "done" }>) =>
  run.timedOut
    ? `Stopped after ${run.seconds}s: it hung. The last line shows where.`
    : run.code === 0
      ? `Succeeded in ${run.seconds}s`
      : run.code === 2
        ? `Blocked (needs a human) after ${run.seconds}s`
        : `Failed (exit ${run.code}) after ${run.seconds}s`;

export function RunForm({ defaultMonth }: { defaultMonth: string }) {
  const [run, action, pending] = useActionState<JobRun | null, FormData>(runInvoiceJob, null);

  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
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
        <Button type="submit" disabled={pending}>
          {pending ? "Running…" : "Run"}
        </Button>
      </form>

      {run?.kind === "refused" && <p className="text-sm text-red-600">{run.error}</p>}
      {run?.kind === "done" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{outcome(run)}</p>
          <p className="text-xs text-muted-foreground font-mono">{run.command}</p>
          <pre className="max-h-[32rem] overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap">
            {run.output || "(no output)"}
          </pre>
        </div>
      )}
    </div>
  );
}

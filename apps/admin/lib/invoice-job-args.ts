/**
 * Turns the Invoices page's form into the invoice job's command-line
 * arguments. Pure, so the rules live in one tested place: only known steps,
 * a YYYY-MM month, an organization id of safe characters, and `--dry-run`
 * only where the job accepts it (backfill and draft).
 */

export const JOB_STEPS = ["backfill", "draft", "issue", "store", "deliver"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ENTITY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DRY_RUN_STEPS: readonly JobStep[] = ["backfill", "draft"];

export type JobInput = { step: string; month: string; entity: string; dryRun: boolean; openMonth?: boolean };

export function jobArgs(input: JobInput): { ok: true; args: string[] } | { ok: false; error: string } {
  const step = input.step as JobStep;
  if (!JOB_STEPS.includes(step)) return { ok: false, error: `Unknown step "${input.step}"` };
  if (!MONTH_RE.test(input.month)) return { ok: false, error: "Month must look like 2026-10" };
  const entity = input.entity.trim();
  if (entity && !ENTITY_RE.test(entity)) return { ok: false, error: "Organization id has unexpected characters" };

  const args = [`--step=${step}`, step === "backfill" ? `--from=${input.month}` : `--period=${input.month}`];
  if (entity && step !== "backfill") args.push(`--entity=${entity}`);
  if (input.dryRun && DRY_RUN_STEPS.includes(step)) args.push("--dry-run");
  // Test mode only (the job refuses it with a live key): lets the current month run before it closes.
  if (input.openMonth) args.push("--open-month");
  return { ok: true, args };
}

/** The month before `now`'s month, as YYYY-MM on the Amsterdam calendar: the latest month the job can invoice. */
export function previousMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, "0")}`;
}

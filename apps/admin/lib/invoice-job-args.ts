/**
 * Turns the Invoices page's form into the invoice job's command-line
 * arguments. Pure, so the rules live in one tested place: only known steps,
 * a YYYY-MM month, an organization id of safe characters, and `--dry-run`
 * only where the job accepts it (backfill and draft).
 */

export const JOB_STEPS = ["backfill", "draft", "issue", "store", "deliver"] as const;
type JobStep = (typeof JOB_STEPS)[number];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ENTITY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DRY_RUN_STEPS: readonly JobStep[] = ["backfill", "draft"];

export type JobInput = {
  step: string;
  month: string;
  entity: string;
  dryRun: boolean;
  openMonth?: boolean;
  ignoreUnknownAccounts?: boolean;
};

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
  // Test mode only too: fees on throwaway test accounts are listed without blocking (backfill and draft reconcile).
  if (input.ignoreUnknownAccounts && DRY_RUN_STEPS.includes(step)) args.push("--ignore-unknown-accounts");
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

/** A dry run keeps nothing and sends nothing: only backfill and draft accept `--dry-run`. Every other run is real. */
export const isDryRun = (args: readonly string[]): boolean => args.includes("--dry-run");

/** What a step-up for this run is bound to: one step, one month, one organization (or all hosts). */
export function runTarget(input: Pick<JobInput, "step" | "month" | "entity">): string {
  const entity = input.entity.trim();
  return `${input.step}:${input.month}${entity ? `:${entity}` : ""}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** What a real run does, in words, for the confirm dialog. Derived from the same input the job's arguments are. */
export function runSummary(input: Pick<JobInput, "step" | "month" | "entity">): string {
  const who = input.entity.trim() ? `organization ${input.entity.trim()}` : "every host";
  const when = monthName(input.month);
  switch (input.step) {
    case "backfill":
      return `Reconcile every month from ${when} through last month against Stripe, keeping the result. A payment that has no booking is refunded through Stripe. Nothing is emailed to hosts.`;
    case "draft":
      return `Draft the ${when} commission invoices for ${who}, keeping them. A payment that has no booking is refunded through Stripe, and the run report is emailed to us. Hosts are not emailed yet.`;
    case "issue":
      return `Issue the ${when} commission invoices for ${who}: final numbers (gapless, not reversible) and PDFs stored. Hosts are not emailed until deliver.`;
    case "store":
      return `Render and upload the PDF and CSV of every issued ${when} commission invoice not stored yet.`;
    case "deliver":
      return `Send the ${when} commission invoices to ${who} by email, with the PDF and CSV attached. A sent invoice cannot be recalled.`;
    default:
      return `Run the invoice job step "${input.step}" for ${when}.`;
  }
}

/**
 * Where the Invoices page finds the Scaleway run to show: one audit row per
 * started run, written after Scaleway answered (the row runDangerous writes
 * before the action cannot hold the run id yet). The page reads the newest.
 * Here, not in the "use server" file, which may export only async functions.
 */
export const RUN_STARTED_ACTION = "admin.invoices.run.started";

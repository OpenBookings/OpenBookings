import { periodFor, periodOf, previousPeriod, type Period } from "@openbookings/billing/period";
import type { Step } from "@openbookings/billing/runs";

const STEPS: readonly Step[] = ["backfill", "draft", "issue", "store", "deliver", "report"];

const QUARTER = /^\d{4}Q[1-4]$/;

export const USAGE = `Usage: bun run src/main.ts --step=<step> [options]

  --step=draft     [--period=YYYY-MM] [--dry-run] [--entity=<org id>]
  --step=draft     --preview --entity=<org id> [--period=YYYY-MM]
  --step=issue     [--period=YYYY-MM] [--entity=<org id>]   (then stores the files)
  --step=store     [--period=YYYY-MM]
  --step=deliver   [--period=YYYY-MM]
  --step=report    --quarter=YYYYQn
  --step=backfill  --from=YYYY-MM [--dry-run]

--period defaults to last month (Europe/Amsterdam) and must be a month that is over.
--open-month (test mode only, any step but report) also allows the current month,
so the whole flow can be tried before a month closes.
--ignore-unknown-accounts (test mode only, draft and backfill) lists fees on
accounts no organization owns without blocking.`;

/** The command line could not be understood, or asks for something the step does not do. */
export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgsError";
  }
}

export type JobArgs = {
  step: Step;
  period: Period;
  /** First month of a backfill. */
  from?: Period;
  /** `YYYYQn`, for the report step. */
  quarter?: string;
  dryRun: boolean;
  /** One organization only. */
  entity?: string;
  /** Render the entity's draft to a local PDF instead of running the step. */
  preview: boolean;
  /** Test mode only: the current month counts as over (main refuses it in live mode). */
  openMonth: boolean;
  /** Test mode only: fees on accounts no organization owns don't block reconciliation (main refuses it in live mode). */
  ignoreUnknownAccounts: boolean;
};

/** Which flags each step accepts besides `--step`. */
const ALLOWED: Record<Step, readonly string[]> = {
  draft: ["period", "dry-run", "entity", "preview", "open-month", "ignore-unknown-accounts"],
  issue: ["period", "entity", "open-month"],
  store: ["period", "open-month"],
  deliver: ["period", "open-month"],
  report: ["quarter"],
  backfill: ["from", "dry-run", "open-month", "ignore-unknown-accounts"],
};

const VALUED = new Set(["step", "period", "from", "quarter", "entity"]);
const BOOLEAN = new Set(["dry-run", "preview", "open-month", "ignore-unknown-accounts"]);

function month(value: string, flag: string): Period {
  try {
    return periodFor(value);
  } catch {
    throw new ArgsError(`--${flag} must be YYYY-MM, got "${value}"`);
  }
}

/**
 * Reads the job's command line (`--key=value` and the `--dry-run` and
 * `--preview` switches). The period defaults to the Amsterdam month before
 * `now` and must be a month that is over; `--step=report` needs `--quarter`,
 * `--step=backfill` needs `--from` (a month that is over), and a preview is
 * of one `--entity`'s draft. A flag the step has no use for is refused rather
 * than ignored, so a typo cannot quietly run something else.
 */
export function parseArgs(argv: string[], now: Date): JobArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new ArgsError(`Unexpected argument "${arg}"`);
    const [, name, value] = match as unknown as [string, string, string | undefined];
    if (VALUED.has(name)) {
      if (!value) throw new ArgsError(`--${name} needs a value: --${name}=…`);
      if (values.has(name)) throw new ArgsError(`--${name} is given twice`);
      values.set(name, value);
    } else if (BOOLEAN.has(name)) {
      if (value !== undefined) throw new ArgsError(`--${name} takes no value`);
      flags.add(name);
    } else {
      throw new ArgsError(`Unknown option --${name}`);
    }
  }

  const step = values.get("step");
  if (!step) throw new ArgsError("--step is required");
  if (!STEPS.includes(step as Step)) throw new ArgsError(`Unknown step "${step}", expected one of ${STEPS.join(", ")}`);
  const allowed = ALLOWED[step as Step];
  for (const name of [...values.keys(), ...flags]) {
    if (name !== "step" && !allowed.includes(name)) throw new ArgsError(`--${name} cannot be used with --step=${step}`);
  }

  const current = periodOf(now);
  const openMonth = flags.has("open-month");
  const over = (p: Period, flag: string) => {
    const m = p.start.slice(0, 7);
    if (m > current || (m === current && !openMonth)) throw new ArgsError(`--${flag}=${m} is not over yet`);
    return p;
  };

  const periodValue = values.get("period");
  const args: JobArgs = {
    step: step as Step,
    period: periodValue ? over(month(periodValue, "period"), "period") : previousPeriod(now),
    dryRun: flags.has("dry-run"),
    preview: flags.has("preview"),
    openMonth,
    ignoreUnknownAccounts: flags.has("ignore-unknown-accounts"),
  };

  const entity = values.get("entity");
  if (entity) args.entity = entity;
  if (args.preview && !entity) throw new ArgsError("--preview needs --entity=<org id>");
  if (args.preview && args.dryRun) throw new ArgsError("--preview writes nothing; leave out --dry-run");

  if (step === "report") {
    const quarter = values.get("quarter");
    if (!quarter) throw new ArgsError("--step=report needs --quarter=YYYYQn");
    if (!QUARTER.test(quarter)) throw new ArgsError(`--quarter must be YYYYQn such as 2026Q4, got "${quarter}"`);
    args.quarter = quarter;
  }

  if (step === "backfill") {
    const from = values.get("from");
    if (!from) throw new ArgsError("--step=backfill needs --from=YYYY-MM");
    args.from = over(month(from, "from"), "from");
  }
  return args;
}

/** Every month from `from` through the month before `now` (Amsterdam), oldest first: what a backfill reconciles. With `openMonth`, through the current month. */
export function backfillMonths(from: Period, now: Date, openMonth = false): Period[] {
  const last = openMonth ? periodFor(periodOf(now)).start : previousPeriod(now).start;
  const out: Period[] = [];
  for (let p = from; p.start <= last; ) {
    out.push(p);
    const [year, m] = p.start.split("-").map(Number) as [number, number];
    p = periodFor(m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`);
  }
  return out;
}

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar date `now` falls on in Amsterdam, `YYYY-MM-DD`: the issue date. */
export function amsterdamDate(now: Date): string {
  return dateFormat.format(now);
}

/** The first day of a `YYYYQn` quarter, `YYYY-MM-01`: the period a report run is recorded under. */
export function quarterStart(quarter: string): string {
  const [year, q] = quarter.split("Q") as [string, string];
  return `${year}-${String((Number(q) - 1) * 3 + 1).padStart(2, "0")}-01`;
}

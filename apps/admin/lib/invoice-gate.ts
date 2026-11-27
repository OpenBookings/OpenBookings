import { isDryRun } from "./invoice-job-args";

/** Flags the job refuses with a live key (production): they exist for test mode only. */
const TEST_ONLY_FLAGS = ["--open-month", "--ignore-unknown-accounts"];

/**
 * Whether production may start these job arguments here, as a refusal message
 * or null. `dry` is the direct path (dry runs only); `confirmed` is the
 * dialog's path (real runs only). Checked before any step-up is spent, so a
 * run the job would refuse anyway costs no confirmation.
 */
export function productionRunRefusal(args: readonly string[], path: "dry" | "confirmed"): string | null {
  if (args.some((a) => TEST_ONLY_FLAGS.includes(a))) {
    return "Allowing the current month and ignoring unknown Stripe accounts are test-only options: the live job refuses them.";
  }
  const dry = isDryRun(args);
  if (path === "dry" && !dry) return "This run changes real records or sends email: confirm it with a reason first.";
  if (path === "confirmed" && dry) return "A dry run needs no confirmation.";
  return null;
}

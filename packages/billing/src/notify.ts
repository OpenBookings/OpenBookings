import { formatEuro } from "./money";
import type { DraftReport } from "./steps/types";

export type RunReportDeps = {
  mail: (m: { to: string; subject: string; text: string }) => Promise<void>;
  /** Posts a short summary; skipped when not configured. */
  slack?: (text: string) => Promise<void>;
  to: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1] ?? period} ${y}`;
}

function list(title: string, items: string[]): string[] {
  return items.length ? [`${title} (${items.length})`, ...items.map((i) => `  - ${i}`), ""] : [];
}

function summaryLine(r: DraftReport): string {
  const blocked = r.reconcile.status === "blocked";
  return blocked
    ? `OpenBookings invoices — ${r.dryRun ? "dry run" : "draft run"} ${monthLabel(r.period)}: reconciliation BLOCKED`
    : `OpenBookings invoices — ${r.dryRun ? "dry run" : "draft run"} ${monthLabel(r.period)}: ${r.drafts.length} drafts, ${r.blocked.length} blocked`;
}

/** The plain-text body of the run report, written to read on a phone. */
export function renderRunReport(r: DraftReport): string {
  const rc = r.reconcile;
  const out: string[] = [];
  if (r.dryRun) out.push("DRY RUN: nothing was written or moved.", "");
  out.push(`Period: ${monthLabel(r.period)}`, `Reconciliation: ${rc.status.toUpperCase()}`, "");

  out.push(
    ...list("Unknown accounts", rc.unknownAccounts),
    ...list("Unsettled fees", rc.unsettled.map((u) => `${u.feeId} (payment ${u.paymentIntentId})`)),
    ...list("Missing billing profiles", rc.missingProfiles.map((m) => `${m.feeId} (org ${m.organizationId})`)),
    ...list("Missing in Stripe", rc.missingInStripe),
    ...list("Amount mismatches", rc.amountMismatches.map((m) => `${m.id}: Stripe ${m.stripe}, ledger ${m.ledger}`)),
    ...list("Not yet returned", rc.notYetReturned),
  );

  const returnedGross = rc.returned.reduce((s, x) => s + BigInt(x.gross), 0n);
  out.push(`Returned payments: ${rc.returned.length}, total ${formatEuro(returnedGross)}`);
  for (const x of rc.returned) out.push(`  - ${x.feeId} ${formatEuro(BigInt(x.gross))}`);
  out.push("");

  out.push(`Drafts: ${r.drafts.length}`);
  const byTreatment = new Map<string, { count: number; gross: bigint; net: bigint; vat: bigint }>();
  for (const d of r.drafts) {
    const t = byTreatment.get(d.vatTreatment) ?? { count: 0, gross: 0n, net: 0n, vat: 0n };
    t.count += 1;
    t.gross += d.grossTotal;
    t.net += d.netTotal;
    t.vat += d.vatTotal;
    byTreatment.set(d.vatTreatment, t);
  }
  for (const [name, t] of byTreatment) {
    out.push(`  ${name}: ${t.count} docs, gross ${formatEuro(t.gross)}, net ${formatEuro(t.net)}, VAT ${formatEuro(t.vat)}`);
  }
  out.push("");

  if (r.blocked.length) {
    out.push(`Blocked hosts (${r.blocked.length})`);
    for (const b of r.blocked) {
      const missing = b.missing?.length ? ` [missing: ${b.missing.join(", ")}]` : "";
      out.push(`  - ${b.entityId}: ${b.reasons.join(", ")}${missing}`);
    }
    out.push("");
  }

  const diffs = r.drafts.filter((d) => d.vatRoundingDiff !== 0n);
  if (diffs.length) {
    out.push("VAT rounding differences");
    for (const d of diffs) out.push(`  - ${d.entityId}: ${formatEuro(d.vatRoundingDiff)}`);
    out.push("");
  }
  if (r.skippedIssued.length) out.push(...list("Already issued (skipped)", r.skippedIssued));
  return out.join("\n").trimEnd() + "\n";
}

/** Emails the run report to `deps.to` and, when configured, posts a 3-5 line summary to Slack. */
export async function sendRunReport(report: DraftReport, deps: RunReportDeps): Promise<void> {
  const subject = summaryLine(report);
  await deps.mail({ to: deps.to, subject, text: renderRunReport(report) });
  if (deps.slack) {
    const rc = report.reconcile;
    const lines = [
      subject,
      `Reconciliation: ${rc.status}${rc.status === "blocked" ? ` (${rc.unknownAccounts.length + rc.unsettled.length + rc.missingProfiles.length + rc.missingInStripe.length + rc.amountMismatches.length + rc.notYetReturned.length} issues)` : ""}`,
      `Drafts: ${report.drafts.length}, blocked hosts: ${report.blocked.length}`,
    ];
    if (report.dryRun) lines.push("Dry run: nothing was written.");
    await deps.slack(lines.join("\n"));
  }
}

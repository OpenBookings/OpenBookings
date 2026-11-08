import type { Queryable } from "@openbookings/db";
import { periodFor, type Period } from "../period";
import { getBillingProfile, missingProfileFields, type BillingProfile } from "../profiles";
import { countryNameOf, type PartySnapshot } from "../render/document";
import { lastReconcileStatus } from "../runs";
import { sellerFromEnv } from "../seller";
import { vatTreatmentFor, type VatTreatment } from "../vat";
import { savepointTransaction, type TransactionRunner } from "./reconcile";

/** A draft's counts no longer match the entries it would link: the month changed after drafting. */
export class IssueMismatchError extends Error {
  constructor(
    readonly invoiceId: string,
    readonly expected: number,
    readonly affected: number,
  ) {
    super(`Invoice ${invoiceId} would link ${affected} entries but its draft counts ${expected}`);
    this.name = "IssueMismatchError";
  }
}

/** Issuing the period is not allowed: reconciliation did not succeed (spec, guards). */
export class IssueRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssueRefusedError";
  }
}

/** The number series of an issue date (`YYYY-MM-DD`): one per calendar year, `OB-2026`. */
export function seriesFor(issuedOn: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) throw new RangeError(`Invalid issue date "${issuedOn}", expected YYYY-MM-DD`);
  return `OB-${issuedOn.slice(0, 4)}`;
}

/** `OB-2026` and 1 -> `OB-2026-0001`; past 9999 the number simply grows (`OB-2026-10000`). */
export function invoiceNumber(series: string, sequenceNumber: number): string {
  return `${series}-${String(sequenceNumber).padStart(4, "0")}`;
}

/**
 * The buyer as an invoice prints it, from a complete billing profile: street
 * lines, then "postcode city", the country's English name, the VAT id, KvK
 * number and billing email.
 */
export function buyerFromProfile(p: BillingProfile): PartySnapshot {
  const text = (value: string | null) => value?.trim() || null;
  return {
    legalName: text(p.legalName) ?? "",
    addressLines: [text(p.addressLine1), text(p.addressLine2), `${text(p.postalCode) ?? ""} ${text(p.city) ?? ""}`.trim()].filter(
      (line): line is string => !!line,
    ),
    countryName: countryNameOf(text(p.countryCode) ?? ""),
    vatId: text(p.vatId) ?? "",
    kvk: text(p.kvkNumber),
    email: text(p.billingEmail),
  };
}

/**
 * Whether the host's billing profile still supports the draft's VAT treatment:
 * the treatment its country gives now is the draft's, and a reverse-charge
 * host's VAT id is VIES-valid. A country outside the EU never does.
 */
export function profileMatchesDraft(p: BillingProfile, draftTreatment: VatTreatment): boolean {
  let treatment: VatTreatment;
  try {
    treatment = vatTreatmentFor(p.countryCode ?? "");
  } catch {
    return false;
  }
  if (treatment !== draftTreatment) return false;
  return treatment === "NL_DOMESTIC" || p.vatIdValid === true;
}

type DraftRow = { status: string; billing_entity_id: string; period_start: string; fee_count: number; refund_count: number };

/**
 * Issues one draft (spec, the job, step 5): locks the invoice, takes the next
 * number of the issue date's series (`OB-{yyyy}`, gapless, from
 * `invoice_sequences` with the row locked; never a Postgres SEQUENCE), stamps
 * the number, `issued_on` and the seller and buyer snapshots on it, and links
 * the month's un-invoiced booked entries of its host to it for good. If the
 * entries linked are not exactly the draft's `fee_count + refund_count`, the
 * draft is stale: everything is undone, no number is used, and
 * `IssueMismatchError` is thrown.
 *
 * Runs in a savepoint, so `db` must be a connection inside a transaction (on
 * a bare pool it throws before doing anything); the number is only taken for
 * good when that transaction commits, and other issues of the same series
 * wait for it. An invoice that is no longer a draft is left alone and
 * reported as `{ skipped: 'not_draft' }`.
 */
export async function issueInvoice(
  db: Queryable,
  invoiceId: string,
  input: { today: string; seller: PartySnapshot; buyer: PartySnapshot },
): Promise<{ number: string } | { skipped: "not_draft" }> {
  const series = seriesFor(input.today);
  return savepointTransaction(db)(async (tx) => {
    const found = await tx.query(
      `SELECT status, billing_entity_id, period_start::text AS period_start, fee_count, refund_count
         FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId],
    );
    const draft = found.rows[0] as DraftRow | undefined;
    if (!draft) throw new Error(`Invoice ${invoiceId} not found`);
    if (draft.status !== "draft") return { skipped: "not_draft" as const };

    await tx.query(`INSERT INTO invoice_sequences (series) VALUES ($1) ON CONFLICT (series) DO NOTHING`, [series]);
    const locked = await tx.query(`SELECT next_value FROM invoice_sequences WHERE series = $1 FOR UPDATE`, [series]);
    const sequenceNumber = (locked.rows[0] as { next_value: number }).next_value;
    await tx.query(`UPDATE invoice_sequences SET next_value = next_value + 1 WHERE series = $1`, [series]);
    const number = invoiceNumber(series, sequenceNumber);

    await tx.query(
      `UPDATE invoices
          SET status = 'issued', series = $2, sequence_number = $3, number = $4, issued_on = $5,
              seller = $6::jsonb, buyer = $7::jsonb
        WHERE id = $1 AND status = 'draft'`,
      [invoiceId, series, sequenceNumber, number, input.today, JSON.stringify(input.seller), JSON.stringify(input.buyer)],
    );

    // Exactly the entries the draft step added up for this host and month.
    const period = periodFor(draft.period_start.slice(0, 7));
    const linked = await tx.query(
      `UPDATE commission_entries SET invoice_id = $1
        WHERE billing_entity_id = $2 AND disposition = 'booked' AND invoice_id IS NULL
          AND occurred_at >= $3 AND occurred_at < $4
        RETURNING id`,
      [invoiceId, draft.billing_entity_id, period.from, period.to],
    );
    const expected = draft.fee_count + draft.refund_count;
    if (linked.rows.length !== expected) throw new IssueMismatchError(invoiceId, expected, linked.rows.length);
    return { number };
  });
}

export type IssueDeps = {
  /** Where the invoices live. */
  db: Queryable;
  /** Each draft is issued in its own transaction: `poolTransaction(pool)` in the job. */
  inTransaction: TransactionRunner;
  /** Holds the `SELLER_…` variables. */
  env: Record<string, string | undefined>;
  /** Live mode refuses to issue without the seller's details; test mode uses placeholders. */
  mode: "live" | "test";
  /** The issue date, `YYYY-MM-DD` in Europe/Amsterdam. */
  today: string;
  /** Issue this one organization's draft only (`--entity`). */
  entity?: string;
};

/** A draft the issue step left a draft, and why. */
export type IssueSkip = {
  entityId: string;
  reason: "draft_stale" | "missing_fields" | "not_draft";
  message: string;
};

/** What an issue run did. */
export type IssueReport = {
  /** `YYYY-MM` */
  period: string;
  issued: { entityId: string; invoiceId: string; number: string }[];
  skipped: IssueSkip[];
};

function refusal(period: string, status: "blocked" | "failed" | null): string {
  if (status === "blocked") return `Reconciliation for ${period} is blocked — resolve it and rerun the draft step first`;
  if (status === "failed") return `The last draft run for ${period} failed — rerun the draft step first`;
  return `No completed draft run for ${period} — run the draft step first`;
}

/**
 * The issue step of the monthly job (spec, the job, step 5, and guards).
 * Refuses the whole run, issuing nothing, when the seller's details are
 * incomplete in live mode (`SellerConfigError`) or when the period's latest
 * draft run did not reconcile successfully (`IssueRefusedError`). Otherwise
 * issues every draft of the period in `billing_entity_id` order, each in its
 * own transaction, with the buyer taken from the host's billing profile as it
 * is now. A host is skipped without using a number, and the others are still
 * issued, when its profile is no longer complete, when it no longer supports
 * the draft's VAT treatment (`profileMatchesDraft`: country changed, left the
 * EU, or a reverse-charge VAT id no longer VIES-valid), or when its draft no
 * longer matches its month's entries (a new entry since drafting). `entity` limits the
 * run to one host. Rerunning issues nothing twice: issued documents are no
 * longer drafts.
 */
export async function runIssue(period: Period, deps: IssueDeps): Promise<IssueReport> {
  const label = period.start.slice(0, 7);
  const seller = sellerFromEnv(deps.env, deps.mode);
  seriesFor(deps.today);
  const reconciled = await lastReconcileStatus(deps.db, period.start);
  if (reconciled !== "succeeded") throw new IssueRefusedError(refusal(label, reconciled));

  const { rows } = await deps.db.query(
    `SELECT id, billing_entity_id, vat_treatment FROM invoices
      WHERE period_start = $1 AND status = 'draft' AND ($2::text IS NULL OR billing_entity_id = $2)
      ORDER BY billing_entity_id`,
    [period.start, deps.entity ?? null],
  );
  const report: IssueReport = { period: label, issued: [], skipped: [] };
  const drafts = rows as { id: string; billing_entity_id: string; vat_treatment: VatTreatment }[];
  for (const { id, billing_entity_id: entityId, vat_treatment: treatment } of drafts) {
    let outcome: Awaited<ReturnType<typeof issueInvoice>> | { missing: string[] } | { changed: true };
    try {
      outcome = await deps.inTransaction(async (tx) => {
        const profile = await getBillingProfile(tx, entityId);
        const missing = missingProfileFields(profile);
        if (!profile || missing.length) return { missing };
        if (!profileMatchesDraft(profile, treatment)) return { changed: true as const };
        return issueInvoice(tx, id, { today: deps.today, seller, buyer: buyerFromProfile(profile) });
      });
    } catch (error) {
      if (!(error instanceof IssueMismatchError)) throw error;
      report.skipped.push({ entityId, reason: "draft_stale", message: "Draft is stale — rerun the draft step for this period" });
      continue;
    }
    if ("number" in outcome) {
      report.issued.push({ entityId, invoiceId: id, number: outcome.number });
    } else if ("changed" in outcome) {
      report.skipped.push({
        entityId,
        reason: "draft_stale",
        message: "Billing details changed since the draft — rerun the draft step for this period",
      });
    } else if ("missing" in outcome) {
      report.skipped.push({ entityId, reason: "missing_fields", message: `Billing profile is missing: ${outcome.missing.join(", ")}` });
    } else {
      report.skipped.push({ entityId, reason: "not_draft", message: "Already issued by another run" });
    }
  }
  return report;
}

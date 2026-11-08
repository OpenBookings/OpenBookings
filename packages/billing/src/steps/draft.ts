import type { Queryable } from "@openbookings/db";
import type { LedgerDeps } from "../ledger";
import type { Period } from "../period";
import { splitInclusive, vatRateBp, type VatTreatment } from "../vat";
import type { checkVatId, ViesDeps } from "../vies";
import { checkEligibility } from "./eligibility";
import { reconcile, type StripeLedgerSource, type TransactionRunner } from "./reconcile";
import type { DraftReport, DraftSummary } from "./types";

/** What one host's document for the month adds up to, as the `invoices` row stores it. */
export type DraftTotals = {
  feeCount: number;
  feeBaseTotal: bigint;
  feeGrossTotal: bigint;
  refundCount: number;
  refundBaseTotal: bigint;
  refundGrossTotal: bigint;
  grossTotal: bigint;
  netTotal: bigint;
  vatTotal: bigint;
  vatCollected: bigint;
  vatRoundingDiff: bigint;
  docType: "invoice" | "credit_note";
  vatTreatment: VatTreatment;
  vatRateBp: bigint;
};

/** One ledger entry as the draft adds it up; refunds are negative. */
export type DraftEntry = { kind: "fee" | "fee_refund"; base: bigint; gross: bigint; vat: bigint };

/**
 * Adds up a host's booked entries of the month into the document's totals
 * (spec decision 1, the job step 4). The commission is VAT-inclusive, so the
 * gross is what Stripe took and the VAT is split out of the month's total
 * once: NL `net = roundHalfUp(gross × 10000 / 12100)`, `vat = gross − net`;
 * reverse charge `net = gross`, `vat = 0`. `vatCollected` is the VAT split
 * out per entry and `vatRoundingDiff` what the month's split differs from it.
 * A month that nets negative is a credit note; zero stays an invoice.
 */
export function draftTotals(rows: DraftEntry[], treatment: VatTreatment): DraftTotals {
  const sum = (kind: DraftEntry["kind"], pick: (r: DraftEntry) => bigint) =>
    rows.filter((r) => r.kind === kind).reduce((total, r) => total + pick(r), 0n);
  const feeGrossTotal = sum("fee", (r) => r.gross);
  const refundGrossTotal = sum("fee_refund", (r) => r.gross);
  const grossTotal = feeGrossTotal + refundGrossTotal;
  const rateBp = vatRateBp(treatment);
  const { net, vat } = splitInclusive(grossTotal, rateBp);
  const vatCollected = rows.reduce((total, r) => total + r.vat, 0n);
  return {
    feeCount: rows.filter((r) => r.kind === "fee").length,
    feeBaseTotal: sum("fee", (r) => r.base),
    feeGrossTotal,
    refundCount: rows.filter((r) => r.kind === "fee_refund").length,
    refundBaseTotal: sum("fee_refund", (r) => r.base),
    refundGrossTotal,
    grossTotal,
    netTotal: net,
    vatTotal: vat,
    vatCollected,
    vatRoundingDiff: vat - vatCollected,
    docType: grossTotal < 0n ? "credit_note" : "invoice",
    vatTreatment: treatment,
    vatRateBp: rateBp,
  };
}

export type DraftDeps = {
  /** Where the ledger and the invoices live. */
  db: Queryable;
  stripe: StripeLedgerSource;
  ledger: LedgerDeps;
  /** Transactions on `db`, as reconciliation needs them; the drafts are written in one too. */
  inTransaction: TransactionRunner;
  vies: typeof checkVatId;
  viesDeps: ViesDeps;
  now: () => Date;
  /** Draft for this one organization only (`--entity`). */
  entity?: string;
  /** Reconcile as a dry run and work out every draft, but write no invoice and store no VIES answer. */
  dryRun: boolean;
  /** The `invoice_runs` row of this run, which every draft it writes points to. */
  runId: string;
  /** Passed to reconcile: test mode only, fees on unknown accounts don't block. */
  ignoreUnknownAccounts?: boolean;
};

type Prepared = { entityId: string; totals: DraftTotals; refersTo: string[] };

/**
 * The draft step of the monthly job (spec, the job, steps 2–4). Reconciles
 * the month first; when that is blocked nothing is drafted and existing drafts
 * stay. Otherwise every host with at least one un-invoiced booked entry in the
 * month (spec decision 10: returned entries never count, so a month of only
 * returned payments gets no document) is checked for eligibility, and each
 * eligible host gets one draft: its entries added up (`draftTotals`) and the
 * numbers of the invoices whose fees its refunds refund. A rerun replaces the
 * draft in place; a host whose document for the month is already issued is
 * left alone and listed in `skippedIssued`. Drafts of the month for hosts that
 * are now blocked or have nothing to invoice are deleted, so no stale draft
 * can be issued. `entity` limits all of this to one host. A dry run reports
 * the same but writes no invoice (an existing draft's id is reported, else
 * `dry-run:{entityId}`); entries a dry-run reconcile would backfill are not in
 * its totals.
 */
export async function runDraft(period: Period, deps: DraftDeps): Promise<DraftReport> {
  const { db, dryRun } = deps;
  const reconciled = await reconcile(period, {
    db,
    stripe: deps.stripe,
    ledger: deps.ledger,
    dryRun,
    inTransaction: deps.inTransaction,
    ignoreUnknownAccounts: deps.ignoreUnknownAccounts,
  });
  const report: DraftReport = {
    period: period.start.slice(0, 7),
    dryRun,
    reconcile: reconciled,
    drafts: [],
    blocked: [],
    skippedIssued: [],
  };
  if (reconciled.status === "blocked") return report;

  const entity = deps.entity ?? null;
  const existing = await documentsOfPeriod(db, period, entity);
  const candidates = (await candidatesOf(db, period, entity)).filter((entityId) => {
    const doc = existing.get(entityId);
    if (doc && doc.status !== "draft") {
      report.skippedIssued.push(entityId);
      return false;
    }
    return true;
  });

  const { eligible, blocked } = await checkEligibility(candidates, period, {
    db,
    vies: deps.vies,
    viesDeps: deps.viesDeps,
    now: deps.now,
    dryRun,
  });
  report.blocked = blocked;

  if (dryRun) {
    for (const entityId of eligible) {
      const p = await prepare(db, period, entityId);
      report.drafts.push(summary(p, existing.get(entityId)?.id ?? `dry-run:${entityId}`));
    }
    return report;
  }

  await deps.inTransaction(async (tx) => {
    const drafted: string[] = [];
    for (const entityId of eligible) {
      const p = await prepare(tx, period, entityId);
      const invoiceId = await upsertDraft(tx, period, deps.runId, p);
      if (invoiceId) {
        drafted.push(entityId);
        report.drafts.push(summary(p, invoiceId));
      } else {
        report.skippedIssued.push(entityId);
      }
    }
    await tx.query(
      `DELETE FROM invoices
        WHERE period_start = $1 AND status = 'draft'
          AND ($2::text IS NULL OR billing_entity_id = $2)
          AND NOT (billing_entity_id = ANY($3::text[]))`,
      [period.start, entity, drafted],
    );
  });
  return report;
}

/** Hosts with at least one un-invoiced booked entry in the month. */
async function candidatesOf(db: Queryable, period: Period, entity: string | null): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT billing_entity_id AS id
       FROM commission_entries
      WHERE disposition = 'booked' AND invoice_id IS NULL
        AND occurred_at >= $1 AND occurred_at < $2
        AND ($3::text IS NULL OR billing_entity_id = $3)
      ORDER BY billing_entity_id`,
    [period.from, period.to, entity],
  );
  return (rows as { id: string }[]).map((r) => r.id);
}

/** The documents already made for the month, by host. */
async function documentsOfPeriod(db: Queryable, period: Period, entity: string | null) {
  const { rows } = await db.query(
    `SELECT billing_entity_id, id, status FROM invoices
      WHERE period_start = $1 AND ($2::text IS NULL OR billing_entity_id = $2)`,
    [period.start, entity],
  );
  return new Map((rows as { billing_entity_id: string; id: string; status: string }[]).map((r) => [r.billing_entity_id, r]));
}

/** A host's totals for the month and the invoice numbers its refunds refer to. */
async function prepare(db: Queryable, period: Period, entityId: string): Promise<Prepared> {
  const { rows } = await db.query(
    `SELECT kind, base_amount::text AS base, gross_amount::text AS gross, vat_amount::text AS vat, vat_treatment
       FROM commission_entries
      WHERE billing_entity_id = $1 AND disposition = 'booked' AND invoice_id IS NULL
        AND occurred_at >= $2 AND occurred_at < $3
      ORDER BY occurred_at, id`,
    [entityId, period.from, period.to],
  );
  const entries = rows as { kind: DraftEntry["kind"]; base: string; gross: string; vat: string; vat_treatment: VatTreatment }[];
  const treatments = new Set(entries.map((e) => e.vat_treatment));
  const [treatment] = treatments;
  if (treatments.size !== 1 || !treatment) {
    throw new Error(`Cannot draft ${entityId}: its entries for ${period.start} carry ${treatments.size} VAT treatments`);
  }
  const totals = draftTotals(
    entries.map((e) => ({ kind: e.kind, base: BigInt(e.base), gross: BigInt(e.gross), vat: BigInt(e.vat) })),
    treatment,
  );

  // The refunded fees' invoices: a refund of a fee not invoiced yet refers to nothing.
  const refs = await db.query(
    `SELECT DISTINCT i.number, i.series, i.sequence_number
       FROM commission_entries r
       JOIN commission_entries f ON f.id = r.refunds_entry_id
       JOIN invoices i ON i.id = f.invoice_id
      WHERE r.billing_entity_id = $1 AND r.kind = 'fee_refund' AND r.disposition = 'booked' AND r.invoice_id IS NULL
        AND r.occurred_at >= $2 AND r.occurred_at < $3
        AND i.number IS NOT NULL
      ORDER BY i.series, i.sequence_number`,
    [entityId, period.from, period.to],
  );
  return { entityId, totals, refersTo: (refs.rows as { number: string }[]).map((r) => r.number) };
}

/** Writes the host's draft, replacing an earlier draft; null when its document for the month is no longer a draft. */
async function upsertDraft(db: Queryable, period: Period, runId: string, p: Prepared): Promise<string | null> {
  const t = p.totals;
  const { rows } = await db.query(
    `INSERT INTO invoices
       (run_id, billing_entity_id, period_start, period_end, doc_type, status, vat_treatment, vat_rate_bp,
        fee_count, fee_base_total, fee_gross_total, refund_count, refund_base_total, refund_gross_total,
        refers_to_invoice_numbers, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12, $13, $14::text[], $15, $16, $17, $18, $19)
     ON CONFLICT (billing_entity_id, period_start) DO UPDATE SET
       run_id = EXCLUDED.run_id,
       period_end = EXCLUDED.period_end,
       doc_type = EXCLUDED.doc_type,
       vat_treatment = EXCLUDED.vat_treatment,
       vat_rate_bp = EXCLUDED.vat_rate_bp,
       fee_count = EXCLUDED.fee_count,
       fee_base_total = EXCLUDED.fee_base_total,
       fee_gross_total = EXCLUDED.fee_gross_total,
       refund_count = EXCLUDED.refund_count,
       refund_base_total = EXCLUDED.refund_base_total,
       refund_gross_total = EXCLUDED.refund_gross_total,
       refers_to_invoice_numbers = EXCLUDED.refers_to_invoice_numbers,
       net_total = EXCLUDED.net_total,
       vat_total = EXCLUDED.vat_total,
       gross_total = EXCLUDED.gross_total,
       vat_collected = EXCLUDED.vat_collected,
       vat_rounding_diff = EXCLUDED.vat_rounding_diff
     WHERE invoices.status = 'draft'
     RETURNING id`,
    [
      runId,
      p.entityId,
      period.start,
      period.end,
      t.docType,
      t.vatTreatment,
      Number(t.vatRateBp),
      t.feeCount,
      t.feeBaseTotal.toString(),
      t.feeGrossTotal.toString(),
      t.refundCount,
      t.refundBaseTotal.toString(),
      t.refundGrossTotal.toString(),
      p.refersTo,
      t.netTotal.toString(),
      t.vatTotal.toString(),
      t.grossTotal.toString(),
      t.vatCollected.toString(),
      t.vatRoundingDiff.toString(),
    ],
  );
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

function summary(p: Prepared, invoiceId: string): DraftSummary {
  const t = p.totals;
  return {
    entityId: p.entityId,
    invoiceId,
    docType: t.docType,
    vatTreatment: t.vatTreatment,
    grossTotal: t.grossTotal,
    netTotal: t.netTotal,
    vatTotal: t.vatTotal,
    vatRoundingDiff: t.vatRoundingDiff,
    feeCount: t.feeCount,
    refundCount: t.refundCount,
  };
}

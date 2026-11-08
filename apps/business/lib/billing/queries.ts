import { query, type Queryable } from "@openbookings/db";
import { periodFor, periodOf, type Period } from "@openbookings/billing/period";
import { getBillingProfile, missingProfileFields } from "@openbookings/billing/profiles";
import { draftTotals, type DraftTotals } from "@openbookings/billing/steps/draft";
import { vatTreatmentFor, type VatTreatment } from "@openbookings/billing/vat";
import { propertyReadiness, readinessCopy, type ReadinessItem } from "@openbookings/billing/readiness";
import { refundNote, type SpecRow } from "@openbookings/billing/render/document";

/**
 * What the Billing page may read: one organization, and a way to run SQL.
 * Every query below filters on `organizationId` itself, so an invoice id that
 * comes from a URL is only ever found inside the caller's own organization.
 */
export type BillingScope = { organizationId: string; db: Queryable };

/** The scope of a session's organization (the result of `getOrgScopedDb`). */
export function billingScope(scoped: { organizationId: string }): BillingScope {
  return {
    organizationId: scoped.organizationId,
    db: { query: async (text, values) => ({ rows: await query(text, values) }) },
  };
}

/** One issued commission invoice or credit note, as the Billing list shows it. */
export type InvoiceListRow = {
  id: string;
  number: string;
  docType: "invoice" | "credit_note";
  status: "issued" | "sent";
  /** First and last day of the month it covers, `YYYY-MM-DD`. */
  periodStart: string;
  periodEnd: string;
  issuedOn: string;
  netTotal: bigint;
  vatTotal: bigint;
  grossTotal: bigint;
  hasPdf: boolean;
  hasCsv: boolean;
};

type InvoiceDbRow = {
  id: string;
  number: string;
  doc_type: InvoiceListRow["docType"];
  status: InvoiceListRow["status"];
  period_start: string;
  period_end: string;
  issued_on: string;
  net_total: string;
  vat_total: string;
  gross_total: string;
  has_pdf: boolean;
  has_csv: boolean;
};

/**
 * The organization's issued and sent invoices and credit notes, newest month
 * first. Drafts are internal and never listed.
 */
export async function listInvoices(scope: BillingScope): Promise<InvoiceListRow[]> {
  const { rows } = await scope.db.query(
    `SELECT id, number, doc_type, status, period_start::text AS period_start, period_end::text AS period_end,
            issued_on::text AS issued_on, net_total::text AS net_total, vat_total::text AS vat_total,
            gross_total::text AS gross_total, pdf_key IS NOT NULL AS has_pdf, csv_key IS NOT NULL AS has_csv
       FROM invoices
      WHERE billing_entity_id = $1 AND status IN ('issued', 'sent') AND number IS NOT NULL
      ORDER BY period_start DESC, sequence_number DESC`,
    [scope.organizationId],
  );
  return (rows as InvoiceDbRow[]).map((r) => ({
    id: r.id,
    number: r.number,
    docType: r.doc_type,
    status: r.status,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    issuedOn: r.issued_on,
    netTotal: BigInt(r.net_total),
    vatTotal: BigInt(r.vat_total),
    grossTotal: BigInt(r.gross_total),
    hasPdf: r.has_pdf,
    hasCsv: r.has_csv,
  }));
}

export type InvoiceFile = "pdf" | "csv";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Where an invoice's file is stored and what to call the download, or `null`
 * when the invoice does not exist, belongs to another organization, is still
 * a draft, or has no stored file yet. The three cases look the same on purpose.
 */
export async function findInvoiceFile(
  scope: BillingScope,
  invoiceId: string,
  file: InvoiceFile,
): Promise<{ key: string; filename: string } | null> {
  if (!UUID.test(invoiceId)) return null;
  const { rows } = await scope.db.query(
    `SELECT number, pdf_key, csv_key FROM invoices
      WHERE id = $2 AND billing_entity_id = $1 AND status IN ('issued', 'sent') AND number IS NOT NULL`,
    [scope.organizationId, invoiceId],
  );
  const row = rows[0] as { number: string; pdf_key: string | null; csv_key: string | null } | undefined;
  const key = file === "pdf" ? row?.pdf_key : row?.csv_key;
  if (!row || !key) return null;
  return { key, filename: file === "pdf" ? `${row.number}.pdf` : `${row.number}-specification.csv` };
}

export type UpcomingInvoice = {
  period: Period;
  /** The month's un-invoiced booked fees and fee refunds, oldest first. Never a guest's name or contact. */
  rows: SpecRow[];
  /** What the next invoice will add up to, worked out by the same code the monthly job uses. `null` when there is nothing yet. */
  totals: DraftTotals | null;
  treatment: { kind: VatTreatment; label: string } | null;
  /** Plain-words reasons the invoice could not be issued as things stand. */
  blockers: string[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-20T10:00Z` -> `20 Oct 2026`, on the Amsterdam calendar. */
function formatDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return `${get("day")} ${MONTHS[get("month") - 1]} ${get("year")}`;
}

type EntryDbRow = {
  kind: "fee" | "fee_refund";
  booking_ref: string | null;
  paid_on: string;
  stay_start: string | null;
  stay_end: string | null;
  base: string;
  gross: string;
  vat: string;
  vat_treatment: VatTreatment;
  stripe_payment_ref: string | null;
  orig_gross: string | null;
  orig_number: string | null;
};

/**
 * The upcoming invoice (spec decision 12): the current Amsterdam month's
 * booked, not yet invoiced fees and refunds, added up with the very function
 * the monthly job drafts with, so the preview equals the real draft. Returned
 * payments are never invoiced and never shown. `blockers` lists what would
 * stop the invoice being issued: incomplete billing details, a VAT number that
 * is not verified, or a country outside the EU.
 */
export async function upcomingInvoice(scope: BillingScope, now: Date): Promise<UpcomingInvoice> {
  const period = periodFor(periodOf(now));
  const { rows: found } = await scope.db.query(
    `SELECT e.kind, e.booking_ref,
            (e.occurred_at AT TIME ZONE 'Europe/Amsterdam')::date::text AS paid_on,
            e.stay_start::text AS stay_start, e.stay_end::text AS stay_end,
            e.base_amount::text AS base, e.gross_amount::text AS gross, e.vat_amount::text AS vat,
            e.vat_treatment, e.stripe_payment_ref,
            f.gross_amount::text AS orig_gross, fi.number AS orig_number
       FROM commission_entries e
       LEFT JOIN commission_entries f ON f.id = e.refunds_entry_id
       LEFT JOIN invoices fi ON fi.id = f.invoice_id
      WHERE e.billing_entity_id = $1 AND e.disposition = 'booked' AND e.invoice_id IS NULL
        AND e.occurred_at >= $2 AND e.occurred_at < $3
      ORDER BY e.occurred_at, e.booking_ref, e.id`,
    [scope.organizationId, period.from, period.to],
  );
  const entries = found as EntryDbRow[];

  const rows: SpecRow[] = entries.map((e) => {
    const row: SpecRow = {
      kind: e.kind,
      bookingRef: e.booking_ref ?? "",
      paidOn: e.paid_on,
      stayStart: e.stay_start ?? "",
      stayEnd: e.stay_end ?? "",
      base: BigInt(e.base),
      gross: BigInt(e.gross),
      stripePaymentRef: e.stripe_payment_ref ?? "",
      fromInvoice: e.orig_number,
    };
    if (e.kind === "fee_refund") row.refundNote = refundNote(row.gross, BigInt(e.orig_gross ?? 0), e.orig_number);
    return row;
  });

  const profile = await getBillingProfile(scope.db, scope.organizationId);
  const blockers: string[] = [];
  let kind: VatTreatment | null = null;

  if (missingProfileFields(profile).length > 0) {
    blockers.push("Your billing details are incomplete. Fill in every field below.");
  } else if (profile?.countryCode) {
    try {
      kind = vatTreatmentFor(profile.countryCode);
    } catch {
      blockers.push("Your billing country must be an EU member state.");
    }
  }
  if (kind === "EU_REVERSE_CHARGE") {
    if (profile?.vatIdValid === false) {
      blockers.push("Your VAT number was checked and is not valid. Correct it below.");
    } else if (profile?.vatIdValid !== true) {
      blockers.push("Your VAT number is not verified yet. Use Check again below.");
    }
  }

  let treatment: UpcomingInvoice["treatment"] = null;
  if (kind === "NL_DOMESTIC") {
    treatment = { kind, label: "21% Dutch VAT is included in the commission" };
  } else if (kind === "EU_REVERSE_CHARGE" && profile) {
    const verified = profile.vatIdValid === true && profile.vatIdCheckedAt;
    treatment = {
      kind,
      label: verified
        ? `Reverse charge: VAT number ${profile.vatId} verified on ${formatDate(profile.vatIdCheckedAt!)}`
        : `Reverse charge: VAT number ${profile.vatId} not verified yet`,
    };
  }

  // The job takes the treatment from the entries; they agree with the profile unless it changed mid-month.
  const entryTreatments = new Set(entries.map((e) => e.vat_treatment));
  const totalsTreatment = entryTreatments.size === 1 ? [...entryTreatments][0] : null;
  const totals =
    entries.length > 0 && totalsTreatment
      ? draftTotals(
          entries.map((e) => ({ kind: e.kind, base: BigInt(e.base), gross: BigInt(e.gross), vat: BigInt(e.vat) })),
          totalsTreatment,
        )
      : null;
  if (entries.length > 0 && !totalsTreatment) {
    blockers.push("This month's fees were booked under different VAT treatments. We will sort this out before issuing.");
  }

  return { period, rows, totals, treatment, blockers };
}

export type PropertyChecklist = {
  propertyId: string;
  name: string;
  /** What is still missing, in the order hosts should do it, with the shared wording. */
  missing: { item: ReadinessItem; text: string }[];
};

/**
 * Every property of the organization with what it still lacks before it can
 * be published or booked (spec decision 9). Uses the same check the publish
 * and checkout gates use, and the same wording.
 */
export async function organizationReadiness(scope: BillingScope): Promise<PropertyChecklist[]> {
  const { rows } = await scope.db.query(
    `SELECT id::text AS id, name FROM properties WHERE organization_id = $1 ORDER BY name, id`,
    [scope.organizationId],
  );
  const out: PropertyChecklist[] = [];
  for (const p of rows as { id: string; name: string }[]) {
    const { missing } = await propertyReadiness(scope.db, p.id);
    out.push({ propertyId: p.id, name: p.name, missing: missing.map((item) => ({ item, text: readinessCopy(item) })) });
  }
  return out;
}

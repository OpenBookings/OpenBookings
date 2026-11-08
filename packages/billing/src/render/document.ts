import type { Queryable } from "@openbookings/db";
import { periodFor } from "../period";
import { draftTotals } from "../steps/draft";
import type { VatTreatment } from "../vat";

/** A seller or buyer as it is printed on the document, frozen when the invoice is issued. */
export type PartySnapshot = {
  legalName: string;
  /** Street lines first, then "postcode city". The country is printed after the last line. */
  addressLines: string[];
  /** English name, e.g. "Netherlands". */
  countryName: string;
  /** With the country prefix, e.g. `NL123456789B01`. */
  vatId: string;
  kvk: string | null;
  email: string | null;
};

/** One booking's line in the specification: a commission fee, or a refund of one (negative amounts). */
export type SpecRow = {
  kind: "fee" | "fee_refund";
  bookingRef: string;
  /** The Amsterdam calendar date of the payment or refund, `YYYY-MM-DD`. */
  paidOn: string;
  stayStart: string;
  stayEnd: string;
  /** Accommodation value in cents. */
  base: bigint;
  /** Commission in cents, VAT included. */
  gross: bigint;
  stripePaymentRef: string;
  /** Number of the invoice that carried the refunded fee, when it is on an issued invoice. */
  fromInvoice: string | null;
  /** Refund rows only: `Cancelled · 50% refund · from OB-2026-0031`. */
  refundNote?: string;
};

/** Everything a commission invoice or credit note shows, and nothing about guests. */
export type InvoiceDocument = {
  docType: "invoice" | "credit_note";
  /** `null` while the document is a draft. */
  number: string | null;
  issuedOn: string | null;
  period: { start: string; end: string };
  seller: PartySnapshot;
  buyer: PartySnapshot;
  vatTreatment: VatTreatment;
  /** The commission rate in percent (`4.5`) when every booking carries the same one, else `null`. */
  commissionRatePercent: string | null;
  lines: {
    fee: { count: number; base: bigint; gross: bigint };
    refund: { count: number; base: bigint; gross: bigint; refersTo: string[] } | null;
  };
  totals: { net: bigint; vat: bigint; gross: bigint };
  rows: SpecRow[];
};

const countryNames = new Intl.DisplayNames("en-GB", { type: "region" });

/** The English name of an ISO 3166-1 country code (`NL` -> `Netherlands`); the code itself when unknown. */
export function countryNameOf(code: string): string {
  try {
    return countryNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) throw new RangeError(`Invalid date "${date}", expected YYYY-MM-DD`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** `2026-10-02` -> `2 Oct`. */
export function formatDay(date: string): string {
  const { m, d } = ymd(date);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** A stay as the specification prints it: `12–14 Dec`, across months `30 Oct–2 Nov`. */
export function formatStay(start: string, end: string): string {
  const a = ymd(start);
  const b = ymd(end);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_SHORT[b.m - 1]}`;
  return `${formatDay(start)}–${formatDay(end)}`;
}

/** `2026-11-01` -> `1 November 2026`. */
export function formatLongDate(date: string): string {
  const { y, m, d } = ymd(date);
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** `2026-10-01` -> `October 2026`. */
export function formatMonth(date: string): string {
  const { y, m } = ymd(date);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** The service period: `1–31 October 2026`, or the two full dates when it is not within one month. */
export function formatPeriod(start: string, end: string): string {
  const a = ymd(start);
  const b = ymd(end);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_LONG[b.m - 1]} ${b.y}`;
  return `${formatLongDate(start)} – ${formatLongDate(end)}`;
}

/**
 * The note under a refund row: `Cancelled · 50% refund · from OB-2026-0031`.
 * The percentage is how much of the original fee this refund returns (whole
 * percent, `full refund` at 100%); the origin is left out when the fee is not
 * on an issued invoice.
 */
export function refundNote(refundGross: bigint, originalGross: bigint, fromInvoice: string | null): string {
  const abs = refundGross < 0n ? -refundGross : refundGross;
  const orig = originalGross < 0n ? -originalGross : originalGross;
  let part = "refund";
  if (orig > 0n) {
    const pct = (abs * 100n * 2n + orig) / (orig * 2n);
    part = pct === 100n ? "full refund" : `${pct}% refund`;
  }
  return ["Cancelled", part, ...(fromInvoice ? [`from ${fromInvoice}`] : [])].join(" · ");
}

type Row = {
  id: string;
  kind: "fee" | "fee_refund";
  booking_ref: string;
  paid_on: string;
  stay_start: string;
  stay_end: string;
  base: string;
  gross: string;
  stripe_payment_ref: string | null;
  orig_gross: string | null;
  orig_invoice_id: string | null;
  orig_number: string | null;
  rate: string | null;
};

const ENTRY_COLUMNS = `
  e.id, e.kind, e.booking_ref,
  (e.occurred_at AT TIME ZONE 'Europe/Amsterdam')::date::text AS paid_on,
  e.stay_start::text AS stay_start, e.stay_end::text AS stay_end,
  e.base_amount::text AS base, e.gross_amount::text AS gross, e.stripe_payment_ref,
  f.gross_amount::text AS orig_gross, f.invoice_id AS orig_invoice_id, fi.number AS orig_number,
  b.commission_rate::text AS rate
  FROM commission_entries e
  LEFT JOIN commission_entries f ON f.id = e.refunds_entry_id
  LEFT JOIN invoices fi ON fi.id = f.invoice_id
  LEFT JOIN bookings b ON b.id = e.booking_id`;

type InvoiceRow = {
  id: string;
  billing_entity_id: string;
  doc_type: "invoice" | "credit_note";
  status: "draft" | "issued" | "sent";
  number: string | null;
  issued_on: string | null;
  period_start: string;
  period_end: string;
  seller: unknown;
  buyer: unknown;
  vat_treatment: VatTreatment;
  fee_count: number;
  fee_base_total: string;
  fee_gross_total: string;
  refund_count: number;
  refund_base_total: string;
  refund_gross_total: string;
  refers_to_invoice_numbers: string[];
  net_total: string;
  vat_total: string;
  gross_total: string;
};

function party(value: unknown, which: string): PartySnapshot {
  const p = value as Partial<PartySnapshot> | null;
  if (!p || typeof p.legalName !== "string" || !Array.isArray(p.addressLines)) {
    throw new Error(`Invoice has no usable ${which} snapshot`);
  }
  return {
    legalName: p.legalName,
    addressLines: p.addressLines,
    countryName: p.countryName ?? "",
    vatId: p.vatId ?? "",
    kvk: p.kvk ?? null,
    email: p.email ?? null,
  };
}

const collator = new Intl.Collator("en", { numeric: true });

function percent(rate: string): string {
  return String(Math.round(Number(rate) * 100 * 1000) / 1000);
}

/**
 * Reads an invoice or credit note into the view model the PDF and CSV render.
 * An issued or sent invoice comes from its own row (the seller and buyer
 * snapshots, the totals) and the ledger entries linked to it, and from
 * nothing live: a host changing its profile later cannot change the document.
 * A draft has neither snapshots nor linked entries yet, so its entries are
 * the month's un-invoiced booked ones of the host (the draft step's own
 * selection), added up again here, and the parties are passed in `opts`.
 */
export async function loadInvoiceDocument(
  db: Queryable,
  invoiceId: string,
  opts?: { seller?: PartySnapshot; buyer?: PartySnapshot },
): Promise<InvoiceDocument> {
  const found = await db.query(
    `SELECT id, billing_entity_id, doc_type, status, number, issued_on::text AS issued_on,
            period_start::text AS period_start, period_end::text AS period_end, seller, buyer, vat_treatment,
            fee_count, fee_base_total::text AS fee_base_total, fee_gross_total::text AS fee_gross_total,
            refund_count, refund_base_total::text AS refund_base_total, refund_gross_total::text AS refund_gross_total,
            refers_to_invoice_numbers, net_total::text AS net_total, vat_total::text AS vat_total,
            gross_total::text AS gross_total
       FROM invoices WHERE id = $1`,
    [invoiceId],
  );
  const inv = found.rows[0] as InvoiceRow | undefined;
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);

  const draft = inv.status === "draft";
  let seller: PartySnapshot;
  let buyer: PartySnapshot;
  let entries: Row[];
  if (draft) {
    if (!opts?.seller || !opts.buyer) throw new Error(`Draft ${invoiceId} needs the seller and buyer passed in`);
    seller = opts.seller;
    buyer = opts.buyer;
    const period = periodFor(inv.period_start.slice(0, 7));
    entries = (
      await db.query(
        `SELECT ${ENTRY_COLUMNS}
          WHERE e.billing_entity_id = $1 AND e.disposition = 'booked' AND e.invoice_id IS NULL
            AND e.occurred_at >= $2 AND e.occurred_at < $3
          ORDER BY e.occurred_at, e.booking_ref, e.id`,
        [inv.billing_entity_id, period.from, period.to],
      )
    ).rows as Row[];
  } else {
    seller = party(inv.seller, "seller");
    buyer = party(inv.buyer, "buyer");
    entries = (
      await db.query(
        `SELECT ${ENTRY_COLUMNS}
          WHERE e.invoice_id = $1
          ORDER BY e.occurred_at, e.booking_ref, e.id`,
        [invoiceId],
      )
    ).rows as Row[];
  }

  const rows: SpecRow[] = entries.map((e) => {
    // A fee on this very invoice is not "from" another one.
    const from = e.orig_number && e.orig_invoice_id !== inv.id ? e.orig_number : null;
    const row: SpecRow = {
      kind: e.kind,
      bookingRef: e.booking_ref,
      paidOn: e.paid_on,
      stayStart: e.stay_start,
      stayEnd: e.stay_end,
      base: BigInt(e.base),
      gross: BigInt(e.gross),
      stripePaymentRef: e.stripe_payment_ref ?? "",
      fromInvoice: from,
    };
    if (e.kind === "fee_refund") row.refundNote = refundNote(row.gross, BigInt(e.orig_gross ?? 0), from);
    return row;
  });

  const rates = new Set(entries.map((e) => e.rate));
  const [only] = rates;
  const commissionRatePercent = rates.size === 1 && only ? percent(only) : null;

  if (draft) {
    const totals = draftTotals(
      rows.map((r) => ({ kind: r.kind, base: r.base, gross: r.gross, vat: 0n })),
      inv.vat_treatment,
    );
    const refersTo = [...new Set(rows.flatMap((r) => (r.kind === "fee_refund" && r.fromInvoice ? [r.fromInvoice] : [])))].sort(
      collator.compare,
    );
    return {
      docType: totals.docType,
      number: null,
      issuedOn: null,
      period: { start: inv.period_start, end: inv.period_end },
      seller,
      buyer,
      vatTreatment: inv.vat_treatment,
      commissionRatePercent,
      lines: {
        fee: { count: totals.feeCount, base: totals.feeBaseTotal, gross: totals.feeGrossTotal },
        refund:
          totals.refundCount > 0
            ? { count: totals.refundCount, base: totals.refundBaseTotal, gross: totals.refundGrossTotal, refersTo }
            : null,
      },
      totals: { net: totals.netTotal, vat: totals.vatTotal, gross: totals.grossTotal },
      rows,
    };
  }

  return {
    docType: inv.doc_type,
    number: inv.number,
    issuedOn: inv.issued_on,
    period: { start: inv.period_start, end: inv.period_end },
    seller,
    buyer,
    vatTreatment: inv.vat_treatment,
    commissionRatePercent,
    lines: {
      fee: { count: inv.fee_count, base: BigInt(inv.fee_base_total), gross: BigInt(inv.fee_gross_total) },
      refund:
        inv.refund_count > 0
          ? {
              count: inv.refund_count,
              base: BigInt(inv.refund_base_total),
              gross: BigInt(inv.refund_gross_total),
              refersTo: inv.refers_to_invoice_numbers,
            }
          : null,
    },
    totals: { net: BigInt(inv.net_total), vat: BigInt(inv.vat_total), gross: BigInt(inv.gross_total) },
    rows,
  };
}

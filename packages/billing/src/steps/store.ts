import { createHash } from "node:crypto";
import type { Queryable } from "@openbookings/db";
import type { Period } from "../period";
import { loadInvoiceDocument, type InvoiceDocument } from "../render/document";
import { renderCsv } from "../render/csv";
import { renderPdf } from "../render/pdf";

/**
 * Where issued invoices are kept. The real one is R2 (`../storage/r2`); the
 * steps only see this shape, so they never load the AWS SDK.
 */
export type ObjectStore = {
  /** The object's stored `sha256` (hex) metadata, or `null` for the object itself missing. */
  head(key: string): Promise<{ sha256: string | null } | null>;
  put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** A time-limited download link that names the file `filename`. */
  presign(key: string, ttlSeconds: number, filename: string): Promise<string>;
};

/** An object is already stored under an invoice's key with different content: stop and alert, never overwrite. */
export class StoredObjectConflictError extends Error {
  constructor(
    readonly key: string,
    readonly expectedSha256: string,
    readonly foundSha256: string | null,
  ) {
    super(`Object ${key} already exists with sha256 ${foundSha256 ?? "(none)"}, expected ${expectedSha256}`);
    this.name = "StoredObjectConflictError";
  }
}

export type StoreDeps = {
  store: ObjectStore;
  /** How the files are produced; the real renderers by default. */
  render?: {
    pdf(doc: InvoiceDocument): Promise<Uint8Array>;
    csv(doc: InvoiceDocument): Promise<string> | string;
  };
};

const defaultRender: NonNullable<StoreDeps["render"]> = { pdf: (doc) => renderPdf(doc), csv: renderCsv };

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type InvoiceRow = { status: string; number: string | null; issued_on: string | null; pdf_key: string | null; csv_key: string | null };

/** The R2 key of an invoice's PDF: `invoices/2026/OB-2026-0042.pdf`. */
export const pdfKeyFor = (number: string, issuedOn: string) => `invoices/${issuedOn.slice(0, 4)}/${number}.pdf`;
/** The R2 key of an invoice's specification: `invoices/2026/OB-2026-0042-specification.csv`. */
export const csvKeyFor = (number: string, issuedOn: string) => `invoices/${issuedOn.slice(0, 4)}/${number}-specification.csv`;

/**
 * Stores the PDF and the CSV of one issued or sent invoice, each only when
 * its key is still missing, and records key and sha256 on the invoice. The
 * files are rendered from the stored snapshots, then the object's HEAD
 * decides: absent means upload, the same sha256 means it is already there
 * (a run that died between upload and recording), a different one throws
 * `StoredObjectConflictError` and nothing is overwritten. The PDF is recorded
 * before the CSV is looked at, so one may exist already. Returns
 * `already_stored` when nothing was missing; nothing is rendered then.
 */
export async function storeInvoice(db: Queryable, invoiceId: string, deps: StoreDeps): Promise<"stored" | "already_stored"> {
  const render = deps.render ?? defaultRender;
  const found = await db.query(`SELECT status, number, issued_on::text AS issued_on, pdf_key, csv_key FROM invoices WHERE id = $1`, [invoiceId]);
  const inv = found.rows[0] as InvoiceRow | undefined;
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  if (inv.status === "draft" || !inv.number || !inv.issued_on) throw new Error(`Invoice ${invoiceId} is a draft and cannot be stored`);
  if (inv.pdf_key && inv.csv_key) return "already_stored";

  const { number, issued_on: issuedOn } = inv;
  const doc = await loadInvoiceDocument(db, invoiceId);

  const keep = async (key: string, bytes: Uint8Array, contentType: string): Promise<string> => {
    const sha256 = sha256Of(bytes);
    const existing = await deps.store.head(key);
    if (!existing) await deps.store.put(key, bytes, contentType, sha256);
    else if (existing.sha256 !== sha256) throw new StoredObjectConflictError(key, sha256, existing.sha256);
    return sha256;
  };

  if (!inv.pdf_key) {
    const key = pdfKeyFor(number, issuedOn);
    const sha256 = await keep(key, await render.pdf(doc), "application/pdf");
    await db.query(`UPDATE invoices SET pdf_key = $2, pdf_sha256 = $3 WHERE id = $1 AND pdf_key IS NULL`, [invoiceId, key, sha256]);
  }
  if (!inv.csv_key) {
    const key = csvKeyFor(number, issuedOn);
    const bytes = new TextEncoder().encode(await render.csv(doc));
    const sha256 = await keep(key, bytes, "text/csv; charset=utf-8");
    await db.query(`UPDATE invoices SET csv_key = $2, csv_sha256 = $3 WHERE id = $1 AND csv_key IS NULL`, [invoiceId, key, sha256]);
  }
  return "stored";
}

/** What a store run did, by invoice number. */
export type StoreReport = { stored: string[]; alreadyStored: string[]; conflicts: string[] };

/**
 * The store step of the monthly job (spec, the job, step 6): stores every
 * issued or sent invoice of the period that is missing a file. A conflict
 * stops the run at once and is reported in `conflicts` for the caller to
 * alert on; invoices already stored by earlier runs are not touched.
 */
export async function runStore(period: Period, deps: StoreDeps & { db: Queryable }): Promise<StoreReport> {
  const { rows } = await deps.db.query(
    `SELECT id, number FROM invoices
      WHERE period_start = $1 AND status IN ('issued', 'sent') AND (pdf_key IS NULL OR csv_key IS NULL)
      ORDER BY number`,
    [period.start],
  );
  const report: StoreReport = { stored: [], alreadyStored: [], conflicts: [] };
  for (const { id, number } of rows as { id: string; number: string }[]) {
    try {
      const outcome = await storeInvoice(deps.db, id, deps);
      (outcome === "stored" ? report.stored : report.alreadyStored).push(number);
    } catch (error) {
      if (!(error instanceof StoredObjectConflictError)) throw error;
      report.conflicts.push(number);
      break;
    }
  }
  return report;
}

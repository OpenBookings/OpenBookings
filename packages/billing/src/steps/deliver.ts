import type { Queryable } from "@openbookings/db";
import type { Period } from "../period";
import { formatMonth } from "../render/document";
import type { ObjectStore } from "./store";

/** What is handed to the mail provider for one invoice; attachments are base64. */
export type InvoiceMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; base64: string; contentType: string }[];
  /** The invoice id: sending the same invoice twice is one email. */
  idempotencyKey: string;
};

/** Sends one invoice email and returns the provider's message id. The real one is `lettermintInvoiceMailer`. */
export type InvoiceMailer = (m: InvoiceMail) => Promise<{ messageId: string }>;

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * The wording of the email for one invoice or credit note. It says what the
 * document is for, that the commission was already collected per booking
 * through Stripe so there is nothing to pay, and where the files also live.
 * Nothing about guests is in it.
 */
export function invoiceEmail(input: { number: string; docType: "invoice" | "credit_note"; periodStart: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const month = formatMonth(input.periodStart);
  const credit = input.docType === "credit_note";
  const noun = credit ? "credit note" : "invoice";
  const subject = `Your OpenBookings commission ${noun} ${input.number} (${month})`;
  const lines = credit
    ? [
        `Attached is credit note ${input.number} for OpenBookings' commission on ${month}.`,
        "It corrects commission that was already collected per booking through Stripe and has been refunded to you in the same way, so there is nothing to pay.",
      ]
    : [
        `Attached is invoice ${input.number} for OpenBookings' commission on ${month}.`,
        "This commission was already collected per booking through Stripe, so there is nothing to pay.",
      ];
  const closing = [
    `The PDF and a per-booking specification (CSV) are attached. You can also find them in OpenBookings Business under Finance → Billing.`,
  ];
  const text = [...lines, ...closing, "OpenBookings"].join("\n\n");
  const html = `<p>${[...lines, ...closing].map(escapeHtml).join("</p>\n<p>")}</p>\n<p>OpenBookings</p>`;
  return { subject, html, text };
}

/** What a deliver run did, by invoice number. */
export type DeliverReport = {
  sent: string[];
  failed: { number: string; message: string }[];
  skipped: { number: string; reason: "no_recipient" }[];
};

type Row = {
  id: string;
  number: string;
  doc_type: "invoice" | "credit_note";
  period_start: string;
  pdf_key: string;
  csv_key: string;
  email: string | null;
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * The deliver step of the monthly job (spec, the job, step 7): emails every
 * issued invoice of the period that is stored (both keys set) and not sent
 * yet, to the billing email frozen on it, with the PDF and the specification
 * read back from the store, never rendered again. The invoice id is the
 * idempotency key, so a run that died after sending cannot send twice. Only
 * after the provider accepted the mail does the invoice become `sent`, with
 * `sent_at` and the message id, in one update. A failed send leaves the
 * invoice `issued` for the next run and the others still go out; an invoice
 * with no billing email is skipped.
 */
export async function runDeliver(period: Period, deps: { db: Queryable; store: ObjectStore; mail: InvoiceMailer }): Promise<DeliverReport> {
  const { rows } = await deps.db.query(
    `SELECT id, number, doc_type, period_start::text AS period_start, pdf_key, csv_key, buyer->>'email' AS email
       FROM invoices
      WHERE period_start = $1 AND status = 'issued' AND sent_at IS NULL AND pdf_key IS NOT NULL AND csv_key IS NOT NULL
      ORDER BY number`,
    [period.start],
  );
  const report: DeliverReport = { sent: [], failed: [], skipped: [] };
  for (const inv of rows as Row[]) {
    const to = inv.email?.trim();
    if (!to) {
      report.skipped.push({ number: inv.number, reason: "no_recipient" });
      continue;
    }
    try {
      const [pdf, csv] = await Promise.all([deps.store.get(inv.pdf_key), deps.store.get(inv.csv_key)]);
      const { messageId } = await deps.mail({
        to,
        ...invoiceEmail({ number: inv.number, docType: inv.doc_type, periodStart: inv.period_start }),
        attachments: [
          { filename: `${inv.number}.pdf`, base64: toBase64(pdf), contentType: "application/pdf" },
          { filename: `${inv.number}-specification.csv`, base64: toBase64(csv), contentType: "text/csv" },
        ],
        idempotencyKey: inv.id,
      });
      await deps.db.query(
        `UPDATE invoices SET status = 'sent', sent_at = now(), email_message_id = $2 WHERE id = $1 AND status = 'issued'`,
        [inv.id, messageId],
      );
      report.sent.push(inv.number);
    } catch (error) {
      report.failed.push({ number: inv.number, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

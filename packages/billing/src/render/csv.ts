import type { InvoiceDocument } from "./document";

const HEADER = [
  "booking",
  "kind",
  "paid_on",
  "stay_start",
  "stay_end",
  "accommodation_value",
  "commission",
  "stripe_payment",
  "refers_to_invoice",
];

/** Signed cents as a plain decimal: `10.80`, `-4.05`. */
export function decimal(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Quotes a field when it holds the separator, a quote or a line break, and
 * puts a `'` before text a spreadsheet would read as a formula (a leading
 * `=`, `+`, `-`, `@`, tab or CR). Host-entered text such as a billing legal
 * name ends up in the staff reports, so it must stay data. Plain numbers like
 * `-4.05` are left alone.
 */
export function field(value: string): string {
  const safe = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The specification as CSV: one line per booking row, `;`-separated, UTF-8
 * without a BOM, `\n` line ends, amounts as decimals with a `.` and the
 * Stripe payment id in full. There is no guest data in the view model, so
 * none can be in the file.
 */
export function renderCsv(doc: InvoiceDocument): string {
  const lines = doc.rows.map((r) =>
    [
      r.bookingRef,
      r.kind,
      r.paidOn,
      r.stayStart,
      r.stayEnd,
      decimal(r.base),
      decimal(r.gross),
      r.stripePaymentRef,
      r.fromInvoice ?? "",
    ]
      .map(field)
      .join(";"),
  );
  return [HEADER.join(";"), ...lines].map((l) => `${l}\n`).join("");
}

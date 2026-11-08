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
function decimal(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Quotes a field only when it holds the separator, a quote or a line break. */
function field(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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

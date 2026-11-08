/**
 * In-memory documents for the render tests and the sample script: the two
 * canvas examples (NL invoice with refunds, BE reverse-charge invoice) in the
 * VAT-inclusive numbers of spec decision 1, and a generator for long ones.
 */
import { refundNote, type InvoiceDocument, type PartySnapshot, type SpecRow } from "./document";

export const SELLER: PartySnapshot = {
  legalName: "OpenBookings B.V.",
  addressLines: ["Keizersgracht 100", "1015 AA Amsterdam"],
  countryName: "Netherlands",
  vatId: "NL864321987B01",
  kvk: "93456781",
  email: "billing@openbookings.co",
};

const NL_BUYER: PartySnapshot = {
  legalName: "B&B De Linde",
  addressLines: ["Lindelaan 4", "3581 AB Utrecht"],
  countryName: "Netherlands",
  vatId: "NL001234567B01",
  kvk: null,
  email: null,
};

const BE_BUYER: PartySnapshot = {
  legalName: "Gastenkamers Het Hof",
  addressLines: ["Kortrijksesteenweg 12", "9000 Gent"],
  countryName: "Belgium",
  vatId: "BE0123456789",
  kvk: null,
  email: null,
};

const cents = (euros: string): bigint => {
  const negative = euros.startsWith("-");
  const [whole = "0", frac = ""] = euros.replace("-", "").split(".");
  const value = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  return negative ? -value : value;
};

/** A fee row; `ref` and `payment` as the ledger stores them. */
function fee(ref: string, paidOn: string, stay: [string, string], base: string, gross: string, payment: string): SpecRow {
  return {
    kind: "fee",
    bookingRef: ref,
    paidOn,
    stayStart: stay[0],
    stayEnd: stay[1],
    base: cents(base),
    gross: cents(gross),
    stripePaymentRef: payment,
    fromInvoice: null,
  };
}

/** A refund row of a fee of `originalGross` that sat on invoice `from`. */
function refund(ref: string, paidOn: string, stay: [string, string], base: string, gross: string, originalGross: string, payment: string, from: string): SpecRow {
  const g = cents(gross);
  return {
    kind: "fee_refund",
    bookingRef: ref,
    paidOn,
    stayStart: stay[0],
    stayEnd: stay[1],
    base: cents(base),
    gross: g,
    stripePaymentRef: payment,
    fromInvoice: from,
    refundNote: refundNote(g, cents(originalGross), from),
  };
}

/** The canvas's NL invoice OB-2026-0042: 10 bookings, 2 refunds, €120.69 of commission. */
export function nlInvoice(): InvoiceDocument {
  const rows: SpecRow[] = [
    fee("7K3M9A1B", "2026-10-02", ["2026-12-12", "2026-12-14"], "240.00", "10.80", "ch_3QaXXXXXXk81F"),
    fee("4HT2P0CD", "2026-10-04", ["2026-10-10", "2026-10-11"], "118.00", "5.31", "ch_3QbXXXXXXT2mc"),
    fee("8RW5N7EF", "2026-10-07", ["2026-10-24", "2026-10-26"], "356.00", "16.02", "ch_3QdXXXXXX9wLx"),
    fee("3JD6V2GH", "2026-10-09", ["2026-11-14", "2026-11-15"], "192.00", "8.64", "ch_3QeXXXXXXHs4P"),
    fee("6FA2K9IJ", "2026-10-12", ["2026-12-27", "2026-12-30"], "480.00", "21.60", "ch_3QgXXXXXXa7Vn"),
    refund("2XQ4T3KL", "2026-10-18", ["2026-10-20", "2026-10-21"], "-90.00", "-4.05", "4.05", "ch_3PZXXXXXXc2Rd", "OB-2026-0031"),
    fee("5CU8H4MN", "2026-10-19", ["2026-11-01", "2026-11-02"], "136.00", "6.12", "ch_3QjXXXXXX8eQb"),
    fee("9LB3S5OP", "2026-10-21", ["2026-11-07", "2026-11-09"], "268.00", "12.06", "ch_3QkXXXXXXWn6t"),
    refund("9MP7D6QR", "2026-10-25", ["2026-11-02", "2026-11-05"], "-110.00", "-4.95", "9.90", "ch_3PXXXXXXXf9Jm", "OB-2026-0031"),
    fee("1TN4G7ST", "2026-10-26", ["2026-10-30", "2026-10-31"], "154.00", "6.93", "ch_3QmXXXXXXr3Ka"),
    fee("7VE9C8UV", "2026-10-28", ["2027-02-18", "2027-02-22"], "712.00", "32.04", "ch_3QnXXXXXXLb5s"),
    fee("4YK2R9WX", "2026-10-30", ["2026-11-06", "2026-11-08"], "226.00", "10.17", "ch_3QpXXXXXXu1Ze"),
  ];
  return {
    docType: "invoice",
    number: "OB-2026-0042",
    issuedOn: "2026-11-01",
    period: { start: "2026-10-01", end: "2026-10-31" },
    seller: SELLER,
    buyer: NL_BUYER,
    vatTreatment: "NL_DOMESTIC",
    commissionRatePercent: "4.5",
    lines: {
      fee: { count: 10, base: cents("2882.00"), gross: cents("129.69") },
      refund: { count: 2, base: cents("-200.00"), gross: cents("-9.00"), refersTo: ["OB-2026-0031"] },
    },
    totals: { net: cents("99.74"), vat: cents("20.95"), gross: cents("120.69") },
    rows,
  };
}

/** The canvas's BE invoice OB-2026-0043: 6 bookings, reverse charge, €69.30. */
export function beInvoice(): InvoiceDocument {
  const rows: SpecRow[] = [
    fee("1AB2C3DE", "2026-10-03", ["2026-10-09", "2026-10-11"], "240.00", "10.80", "ch_3QqXXXXXXa1Bc"),
    fee("2BC3D4EF", "2026-10-08", ["2026-10-15", "2026-10-18"], "260.00", "11.70", "ch_3QrXXXXXXb2Cd"),
    fee("3CD4E5FG", "2026-10-13", ["2026-10-30", "2026-11-02"], "300.00", "13.50", "ch_3QsXXXXXXc3De"),
    fee("4DE5F6GH", "2026-10-17", ["2026-11-05", "2026-11-06"], "180.00", "8.10", "ch_3QtXXXXXXd4Ef"),
    fee("5EF6G7HI", "2026-10-22", ["2026-11-12", "2026-11-15"], "320.00", "14.40", "ch_3QuXXXXXXe5Fg"),
    fee("6FG7H8IJ", "2026-10-29", ["2026-12-01", "2026-12-03"], "240.00", "10.80", "ch_3QvXXXXXXf6Gh"),
  ];
  return {
    docType: "invoice",
    number: "OB-2026-0043",
    issuedOn: "2026-11-01",
    period: { start: "2026-10-01", end: "2026-10-31" },
    seller: SELLER,
    buyer: BE_BUYER,
    vatTreatment: "EU_REVERSE_CHARGE",
    commissionRatePercent: "4.5",
    lines: { fee: { count: 6, base: cents("1540.00"), gross: cents("69.30") }, refund: null },
    totals: { net: cents("69.30"), vat: 0n, gross: cents("69.30") },
    rows,
  };
}

/** An NL invoice with `count` identical-looking fee rows, for pagination. */
export function longInvoice(count: number): InvoiceDocument {
  const rows = Array.from({ length: count }, (_, i) =>
    fee(
      `B${String(i).padStart(7, "0")}`,
      `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
      ["2026-11-10", "2026-11-12"],
      "100.00",
      "4.50",
      `ch_3Q${String(i).padStart(4, "0")}XXXXk${String(i).padStart(3, "0")}`,
    ),
  );
  const gross = BigInt(count) * 450n;
  const net = (gross * 10000n * 2n + 12100n) / (12100n * 2n);
  return {
    ...nlInvoice(),
    commissionRatePercent: "4.5",
    lines: { fee: { count, base: BigInt(count) * 10000n, gross }, refund: null },
    totals: { net, vat: gross - net, gross },
    rows,
  };
}

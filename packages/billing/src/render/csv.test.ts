import { expect, test } from "bun:test";
import { renderCsv } from "./csv";
import { beInvoice, nlInvoice } from "./fixtures";
import type { InvoiceDocument } from "./document";

const twoRows = (): InvoiceDocument => {
  const doc = nlInvoice();
  const fee = doc.rows[0]!;
  const partial = doc.rows[8]!;
  return { ...doc, rows: [fee, partial] };
};

test("csv has the exact header and a fee and a partial refund row", () => {
  expect(renderCsv(twoRows())).toBe(
    [
      "booking;kind;paid_on;stay_start;stay_end;accommodation_value;commission;stripe_payment;refers_to_invoice",
      "7K3M9A1B;fee;2026-10-02;2026-12-12;2026-12-14;240.00;10.80;ch_3QaXXXXXXk81F;",
      "9MP7D6QR;fee_refund;2026-10-25;2026-11-02;2026-11-05;-110.00;-4.95;ch_3PXXXXXXXf9Jm;OB-2026-0031",
      "",
    ].join("\n"),
  );
});

test("csv is UTF-8 without a BOM, with \\n line ends and no carriage returns", () => {
  const csv = renderCsv(nlInvoice());
  expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  expect(csv).not.toContain("\r");
  expect(csv.endsWith("\n")).toBe(true);
  expect(csv.split("\n")).toHaveLength(1 + 12 + 1);
});

test("csv has no guest data", () => {
  const header = renderCsv(beInvoice()).split("\n")[0]!;
  expect(header).not.toMatch(/guest|name|email|phone|address/i);
});

test("csv quotes a field that holds the separator", () => {
  const doc = beInvoice();
  const csv = renderCsv({ ...doc, rows: [{ ...doc.rows[0]!, stripePaymentRef: 'a;"b' }] });
  expect(csv.split("\n")[1]).toContain('"a;""b"');
});

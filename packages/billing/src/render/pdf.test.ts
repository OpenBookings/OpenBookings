import { expect, test } from "bun:test";
import { beInvoice, longInvoice, nlInvoice } from "./fixtures";
import { renderPdf } from "./pdf";
import { pdfPageCount, pdfPageTexts } from "./pdf-text";

const render = (doc = nlInvoice(), opts?: Parameters<typeof renderPdf>[1]) => renderPdf(doc, { ...opts, compress: false });

test("an NL invoice with 40 rows renders to 3 pages", async () => {
  expect(pdfPageCount(await render(longInvoice(40)))).toBe(3);
});

test("the canvas example renders to 2 pages", async () => {
  expect(pdfPageCount(await render())).toBe(2);
});

test("page 1 shows the number, the VAT split and the total", async () => {
  const [first] = pdfPageTexts(await render());
  expect(first).toContain("OB-2026-0042");
  expect(first).toContain("VAT 21%");
  expect(first).toContain("Subtotal");
  expect(first).toContain("€99.74");
  expect(first).toContain("€20.95");
  expect(first).toContain("€120.69");
  expect(first).toContain("Commission on bookings, October 2026");
  expect(first).toContain("4.5% of €2,882.00 accommodation value");
  expect(first).toContain("Commission refunded on cancellations");
  expect(first).toContain("−€9.00");
  expect(first).toContain("relates to invoice OB-2026-0031");
  expect(first).toContain("1–31 October 2026");
  expect(first.replace(/\s+/g, " ")).toContain("Accommodation value is the price of the stay including VAT, excluding tourist tax.");
  expect(first).toContain("Page 1 of 2");
});

test("a reverse-charge invoice shows Article 196 and no refund line", async () => {
  const [first] = pdfPageTexts(await render(beInvoice()));
  expect(first).toContain("VAT reverse charged");
  expect(first).toContain("Article 196 of Directive 2006/112/EC");
  expect(first).toContain("€0.00");
  expect(first).not.toContain("Commission refunded on cancellations");
  expect(first).not.toContain("VAT 21%");
});

test("a credit note is titled Credit note", async () => {
  const [first] = pdfPageTexts(await render({ ...nlInvoice(), docType: "credit_note" }));
  expect(first).toContain("Credit note");
  expect(first).not.toMatch(/^Invoice$/m);
});

test("the specification lists every booking with a shortened Stripe payment and refund notes", async () => {
  const [, spec] = pdfPageTexts(await render());
  expect(spec).toContain("Specification per booking");
  expect(spec).toContain("7K3M9A1B");
  expect(spec).toContain("2 Oct");
  expect(spec).toContain("12–14 Dec");
  expect(spec).toContain("ch_3Qa…k81F");
  expect(spec).not.toContain("ch_3QaXXXXXXk81F");
  expect(spec).toContain("Cancelled · full refund · from OB-2026-0031");
  expect(spec).toContain("Cancelled · 50% refund · from OB-2026-0031");
  expect(spec).toContain("−€4.05");
  expect(spec).toContain("Bookings (10)");
  expect(spec).toContain("Refunds (2)");
  expect(spec).toContain("Total commission");
  expect(spec).toContain("€129.69");
  expect(spec).toContain("Page 2 of 2");
});

test("a draft carries a DRAFT watermark on every page and shows DRAFT as its number", async () => {
  const draft = { ...nlInvoice(), number: null, issuedOn: null };
  const pages = pdfPageTexts(await render(draft, { watermark: "DRAFT" }));
  expect(pages).toHaveLength(2);
  for (const page of pages) expect(page).toContain("DRAFT");
  expect(pages[0]).not.toContain("OB-2026-0042");
});

test("an issued invoice without the watermark has no DRAFT on any page", async () => {
  for (const page of pdfPageTexts(await render())) expect(page).not.toContain("DRAFT");
});

test("the same document renders to the same bytes", async () => {
  const a = await renderPdf(nlInvoice());
  const b = await renderPdf(nlInvoice());
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  expect(Buffer.from(await render()).equals(Buffer.from(await render()))).toBe(true);
});

test("the PDF has no guest data fields to print", async () => {
  const pdf = Buffer.from(await render()).toString("latin1");
  expect(pdf).not.toMatch(/guest/i);
});

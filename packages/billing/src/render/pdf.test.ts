import { expect, test } from "bun:test";
import { beInvoice, longInvoice, nlInvoice } from "./fixtures";
import { renderPdf } from "./pdf";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { pdfPageCount, pdfPageTexts, pdfTextRuns } from "./pdf-text";

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

const fontFile = (name: string) => fileURLToPath(new URL(`../../assets/fonts/${name}`, import.meta.url));
/** Width in pt of `s` in Inter at `px` css pixels. */
const widthPt = (s: string, px: number, file = "Inter-Regular.ttf") => {
  const measure = new PDFDocument();
  return measure.font(fontFile(file)).fontSize(px * 0.75).widthOfString(s);
};

const LONG_NAME = "Stichting Exploitatie Hotel De Gouden Leeuw en Landgoed Het Oude Veerhuis B.V.";
const LONG_STREET = "Prins Bernhardlaan-Zuid 1234 bis, Gebouw C, Unit 5, Bedrijventerrein De Vaart";

test("a long legal name and address wrap inside the Billed-to column and are not cut off", async () => {
  const doc = nlInvoice();
  const buyer = { ...doc.buyer, legalName: LONG_NAME, addressLines: [LONG_STREET, "3581 AB Utrecht"] };
  const runs = pdfTextRuns(await render({ ...doc, buyer })).filter((r) => r.page === 0);
  const start = runs.findIndex((r) => r.text === "BILLED TO");
  const end = runs.findIndex((r) => r.text === "FROM");
  const billed = runs.slice(start + 1, end);
  const colWidthPt = ((666 - 32) / 2) * 0.75;
  const fromX = (64 + 317 + 32) * 0.75;
  for (const r of billed) {
    expect(r.x + widthPt(r.text.trimEnd(), 13)).toBeLessThanOrEqual(fromX - 1);
    expect(widthPt(r.text.trimEnd(), 13)).toBeLessThanOrEqual(colWidthPt + 0.01);
  }
  const joined = billed.map((r) => r.text.trim()).join(" ");
  expect(joined).toContain(LONG_NAME);
  expect(joined).toContain(LONG_STREET);
  expect(joined).toContain("3581 AB Utrecht, Netherlands");
  expect(billed.filter((r) => LONG_NAME.includes(r.text.trim())).length).toBeGreaterThan(1);
});

test("a long host name on the specification header stays right of the title", async () => {
  const doc = nlInvoice();
  const buyer = { ...doc.buyer, legalName: LONG_NAME };
  const runs = pdfTextRuns(await render({ ...doc, buyer })).filter((r) => r.page === 1);
  const title = runs.find((r) => r.text === "Specification per booking")!;
  const titleRight = title.x + widthPt(title.text, 26, "Inter-SemiBold.ttf");
  const host = runs.findIndex((r) => r.text === "Host");
  const period = runs.findIndex((r) => r.text === "Period");
  const lines = runs.slice(host + 1, period);
  expect(lines.length).toBeGreaterThan(1);
  for (const r of lines) {
    expect(r.x).toBeGreaterThan(titleRight);
    expect(r.x + widthPt(r.text.trimEnd(), 12)).toBeLessThanOrEqual(730 * 0.75 + 0.5);
  }
  expect(lines.map((r) => r.text.trim()).join(" ")).toContain(LONG_NAME);
});

test("a long seller name wraps in the header block and long documents stay deterministic", async () => {
  const doc = nlInvoice();
  const long = { ...doc, seller: { ...doc.seller, legalName: LONG_NAME } };
  const a = await renderPdf(long);
  const b = await renderPdf(long);
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  expect(pdfPageCount(a)).toBe(2);
});

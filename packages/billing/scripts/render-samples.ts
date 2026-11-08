/**
 * Renders the design canvas's two example invoices (NL with refunds, BE
 * reverse charge) and a DRAFT preview to a directory, to compare by eye.
 *
 * Run: bun packages/billing/scripts/render-samples.ts [out-dir]
 * in spirit: do not commit what lands there.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderCsv } from "../src/render/csv";
import { beInvoice, nlInvoice } from "../src/render/fixtures";
import { renderPdf } from "../src/render/pdf";

const out = process.argv[2] ?? fileURLToPath(new URL("./out", import.meta.url));
await mkdir(out, { recursive: true });

const samples = [
  ["invoice-nl", nlInvoice(), undefined],
  ["invoice-be", beInvoice(), undefined],
  ["invoice-nl-draft", { ...nlInvoice(), number: null, issuedOn: null }, "DRAFT"],
] as const;

for (const [name, doc, watermark] of samples) {
  await writeFile(`${out}/${name}.pdf`, await renderPdf(doc, { watermark }));
  if (!watermark) await writeFile(`${out}/${name}-specification.csv`, renderCsv(doc));
  console.log(`${out}/${name}.pdf`);
}

/**
 * Test helper: the text of each page of a PDF written by pdfkit with
 * `compress: false`. pdfkit embeds TrueType fonts as two-byte glyph codes,
 * so the text is recovered through each font's ToUnicode map. Not a general
 * PDF reader.
 */
type ObjectMap = Map<number, string>;

function objectsOf(pdf: string): ObjectMap {
  const objects: ObjectMap = new Map();
  for (const m of pdf.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) objects.set(Number(m[1]), m[2]!);
  return objects;
}

function refOf(body: string, key: string): number | null {
  const m = new RegExp(`/${key} (\\d+) 0 R`).exec(body);
  return m ? Number(m[1]) : null;
}

function streamOf(body: string): string {
  const start = body.indexOf("stream");
  const end = body.lastIndexOf("endstream");
  return start < 0 ? "" : body.slice(start + 6, end);
}

function toUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const text = (hex: string) => String.fromCharCode(...(hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1]!, 16), text(m[2]!));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:\[([^\]]*)\]|<([0-9a-fA-F]+)>)/g)) {
      const from = parseInt(m[1]!, 16);
      const to = parseInt(m[2]!, 16);
      if (m[3] !== undefined) {
        [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].forEach((t, i) => map.set(from + i, text(t[1]!)));
      } else {
        const first = parseInt(m[4]!, 16);
        for (let code = from; code <= to; code++) map.set(code, String.fromCharCode(first + code - from));
      }
    }
  }
  return map;
}

/** One run of text: its page (0-based), the text, the left edge and the baseline in pt (y from the page bottom). */
export type TextRun = { page: number; text: string; x: number; y: number };

/** The text of every page, one string per page, runs separated by a newline. */
export function pdfPageTexts(bytes: Uint8Array): string[] {
  const runs = pdfTextRuns(bytes);
  const count = pdfPageCount(bytes);
  return Array.from({ length: count }, (_, i) => runs.filter((r) => r.page === i).map((r) => r.text).join("\n"));
}

/** Every text run with its position, in drawing order. */
export function pdfTextRuns(bytes: Uint8Array): TextRun[] {
  const pdf = Buffer.from(bytes).toString("latin1");
  const objects = objectsOf(pdf);
  const all: TextRun[] = [];
  const pageOrder: number[] = [];
  for (const [, body] of objects) {
    if (!/\/Type \/Page\b(?!s)/.test(body)) continue;
    const contents = refOf(body, "Contents");
    const resources = refOf(body, "Resources");
    const resourceBody = resources ? objects.get(resources)! : body;
    const fonts = new Map<string, Map<number, string>>();
    const fontDict = /\/Font <<([^>]*)>>/.exec(resourceBody)?.[1] ?? "";
    for (const f of fontDict.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const type0 = objects.get(Number(f[2]))!;
      const uni = refOf(type0, "ToUnicode");
      if (uni) fonts.set(f[1]!, toUnicode(streamOf(objects.get(uni)!)));
    }
    const content = streamOf(objects.get(contents!)!);
    let current = new Map<number, string>();
    const decode = (hex: string) => (hex.match(/.{4}/g) ?? []).map((h) => current.get(parseInt(h, 16)) ?? "").join("");
    const page = all.length === 0 && pageOrder.length === 0 ? 0 : pageOrder.length;
    pageOrder.push(page);
    let pos = { x: 0, y: 0 };
    const add = (t: string) => all.push({ page, text: t, ...pos });
    for (const m of content.matchAll(/1 0 0 -?1 ([\d.-]+) ([\d.-]+) Tm|\/(F\d+) [\d.]+ Tf|\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
      if (m[1] !== undefined) pos = { x: Number(m[1]), y: Number(m[2]) };
      else if (m[3]) current = fonts.get(m[3]) ?? new Map();
      else if (m[4] !== undefined) add([...m[4].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => decode(h[1]!)).join(""));
      else if (m[5]) add(decode(m[5]));
    }
  }
  return all;
}

/** How many pages the PDF has. */
export function pdfPageCount(bytes: Uint8Array): number {
  return (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}

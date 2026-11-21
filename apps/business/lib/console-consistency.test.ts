import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Guards for the console refresh approved on 2026-11-21 (DESIGN_SYSTEM §3.3):
 * colour comes from tokens, state from the state palette, shapes from the
 * radius scale, and controls from components/ui. Each rule here once had
 * dozens of hand-rolled exceptions; this keeps them from growing back.
 */
const ROOTS = ["app/(dashboard)", "components/dashboard", "components/support"];

/** The logo artwork draws its own colours; it is a picture, not UI. */
const ARTWORK = new Set([path.join("components", "dashboard", "ob-globe.tsx")]);

async function consoleFiles(): Promise<{ file: string; source: string }[]> {
  const out: { file: string; source: string }[] = [];
  for (const root of ROOTS) {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
      const file = path.join(entry.parentPath, entry.name);
      if (ARTWORK.has(file)) continue;
      out.push({ file, source: await readFile(file, "utf8") });
    }
  }
  return out;
}

function offenders(files: { file: string; source: string }[], pattern: RegExp): string[] {
  return files.filter(({ source }) => pattern.test(source)).map(({ file }) => file);
}

describe("console consistency", () => {
  test("no hard-coded hex colours in class names", async () => {
    expect(offenders(await consoleFiles(), /\[#[0-9a-fA-F]{3,8}\]/)).toEqual([]);
  });

  test("no raw Tailwind palette colours; state comes from the state palette", async () => {
    const palette =
      /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|accent)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;
    expect(offenders(await consoleFiles(), palette)).toEqual([]);
  });

  test("radii come from the scale, never arbitrary pixels", async () => {
    expect(offenders(await consoleFiles(), /\brounded(?:-[trbl]{1,2})?-\[\d+px\]/)).toEqual([]);
  });

  test("no indigo: the old --accent-N scale is not used in feature code", async () => {
    expect(offenders(await consoleFiles(), /--accent-(?:3|7|9|11)\b/)).toEqual([]);
  });

  test("native selects and radios go through components/ui", async () => {
    const files = await consoleFiles();
    expect(offenders(files, /<select[\s>]/)).toEqual([]);
    expect(offenders(files, /type="radio"/)).toEqual([]);
  });

  // Decided 2026-11-21: no purple in the interface chrome. Lilac means
  // "price changed by a rule" and appears only on the rates and pricing screens.
  test("lilac is only used for price adjustments", async () => {
    const lilac = /state-adjusted|spectrum-lilac|--ari-adjusted/;
    const allowed = /listings[\\/](?:rates-availability|pricing-rules)[\\/]/;
    const outside = offenders(await consoleFiles(), lilac).filter((file) => !allowed.test(file));
    expect(outside).toEqual([]);
  });
});

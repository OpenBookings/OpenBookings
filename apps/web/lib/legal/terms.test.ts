import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCurrentVersion, getDocument, LEGAL_LOCALES } from "./documents";

const CURRENT = "2026-11-16";
const DIR = join(import.meta.dir, "../../content/legal/terms");
const read = (locale: string) => readFileSync(join(DIR, CURRENT, `${locale}.mdx`), "utf8");
const sectionIds = (source: string) =>
  [...source.matchAll(/<Section id="([^"]+)"/g)].map((m) => m[1]);

describe("terms of service registry", () => {
  const doc = getDocument("terms")!;

  test("is registered with the newest version current", () => {
    expect(doc).toBeDefined();
    expect(getCurrentVersion(doc).version).toBe(CURRENT);
  });

  test("only English is marked translated", () => {
    const { locales } = getCurrentVersion(doc);
    expect(locales.en?.status).toBe("translated");
    expect(locales.nl?.status).toBe("draft");
    expect(locales.fr?.status).toBe("draft");
  });
});

describe("current terms of service content", () => {
  const englishIds = sectionIds(read("en"));

  test("has all 17 numbered sections", () => {
    expect(englishIds).toHaveLength(17);
  });

  for (const locale of LEGAL_LOCALES) {
    const source = read(locale);

    test(`${locale}: keeps the same section ids as English`, () => {
      expect(sectionIds(source)).toEqual(englishIds);
    });

    test(`${locale}: every in-page link points at a real section`, () => {
      const anchors = [...source.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
      expect(anchors.length).toBeGreaterThan(0);
      for (const anchor of anchors) expect(englishIds).toContain(anchor);
    });

    test(`${locale}: links to the privacy policy in the same language`, () => {
      const privacyLinks = [...source.matchAll(/\]\((\/legal\/[^)]+)\)/g)].map((m) => m[1]);
      expect(privacyLinks.length).toBeGreaterThan(0);
      for (const href of privacyLinks) expect(href).toBe(`/legal/${locale}/privacy`);
    });

    test(`${locale}: names the AGPL, not the MPL`, () => {
      expect(source).toContain("AGPL-3.0-only");
      expect(source).not.toMatch(/Mozilla/);
    });

    test(`${locale}: describes reviews instead of saying they aren't available`, () => {
      expect(source).toMatch(/\*\*10\.7 (Reviews|Beoordelingen|Avis)\.\*\*/);
      expect(source).toMatch(/30 (days|dagen|jours)/);
    });

    test(`${locale}: does not promise account deletion "at any time"`, () => {
      // apps/web/lib/account/deletion.ts blocks deletion during an upcoming stay.
      const clause = source.split("\n").find((l) => l.startsWith("**3.5**"))!;
      expect(clause).not.toMatch(/at any time|op elk moment|à tout moment/);
    });

    test(`${locale}: carries no internal drafting notes`, () => {
      expect(source).not.toContain("🔧");
      expect(source).not.toMatch(/\[(CONFIRM|DATE|SUPPORT EMAIL|REPORT EMAIL)/);
    });
  }
});
